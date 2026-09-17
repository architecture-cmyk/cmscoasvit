import { z } from 'zod';
import { Router } from 'express';
import { supabase } from '../supabase.js';
import { validateBody, validateQuery, uuidSchema, paginationQuery } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { parsePagination } from '../utils/response.js';
import { notFound, conflict, forbidden, unprocessable, assertFound } from '../utils/errors.js';
import { fromDbError } from '../utils/errors.js';
import { applyScope } from '../services/scope.js';
import { logAudit } from '../services/audit.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, requireAdminOrHod, requireRoles, departmentScopeMatches } from '../middleware/rbac.js';
import { generateTimetable } from '../services/timetableGenerator.js';
import { validateTimetable } from '../services/timetableValidator.js';

export const timetableRouter = Router();
timetableRouter.use(authenticate);

const ttListSelect = '*, academic_year:academic_years(name), semester:semesters(name), course:courses(name), generated_by_user:users!generated_by(id, role), entries:timetable_entries(count)';

const generateSchema = z.object({
  academic_year_id: uuidSchema,
  semester_id: uuidSchema,
  course_id: uuidSchema,
  division_ids: z.array(uuidSchema).min(1, 'At least one division required'),
  working_day_ids: z.array(uuidSchema).min(1, 'At least one working day required'),
  time_slot_ids: z.array(uuidSchema).min(2, 'At least two time slots required'),
  replace_existing_draft: z.boolean().optional(),
  seed: z.number().int().optional().nullable(),
});

timetableRouter.get('/', requireRoles('admin', 'hod', 'faculty'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('timetable').select(ttListSelect, { count: 'exact' }).order('created_at', { ascending: false });
    qb = await applyScope(qb, req.user, 'timetable');
    if (req.query.academic_year_id) qb = qb.eq('academic_year_id', req.query.academic_year_id);
    if (req.query.semester_id) qb = qb.eq('semester_id', req.query.semester_id);
    if (req.query.course_id) qb = qb.eq('course_id', req.query.course_id);
    if (req.query.status) qb = qb.eq('status', req.query.status);
    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const normalized = (data || []).map((d) => ({
      ...d,
      entry_count: Array.isArray(d.entries) && d.entries[0] ? Number(d.entries[0].count) : 0,
    }));
    const total = count || 0;
    return ok(res, normalized, 'Listed timetables', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});

/**
 * POST /api/v1/timetables/generate
 */
timetableRouter.post('/generate', requireAdmin, validateBody(generateSchema), async (req, res, next) => {
  try {
    const result = await generateTimetable({
      ...req.body,
      generated_by: req.user.id,
    });
    return ok(res, result, 'Timetable generated as draft');
  } catch (err) {
    return next(fromDbError(err));
  }
});

async function loadTimetableFor(id) {
  const { data } = await supabase
    .from('timetable')
    .select('*, academic_year:academic_years(name), semester:semesters(name), course:courses(name, department_id), entries:timetable_entries(count)')
    .eq('id', id)
    .maybeSingle();
  return data;
}

timetableRouter.get('/:id', requireRoles('admin', 'hod', 'faculty'), async (req, res, next) => {
  try {
    const tt = await loadTimetableFor(req.params.id);
    if (!tt) throw notFound('Timetable not found');
    // scope check for non-admins
    if (req.user.role === 'hod' && !departmentScopeMatches(req.user, tt.course?.department_id)) {
      throw forbidden('You do not have access to this timetable');
    }
    tt.entry_count = Array.isArray(tt.entries) && tt.entries[0] ? Number(tt.entries[0].count) : 0;
    return ok(res, tt);
  } catch (err) {
    return next(fromDbError(err));
  }
});

/**
 * GET /api/v1/timetables/:id/entries
 */
timetableRouter.get('/:id/entries', requireRoles('admin', 'hod', 'faculty'), async (req, res, next) => {
  try {
    const tt = await loadTimetableFor(req.params.id);
    if (!tt) throw notFound('Timetable not found');
    if (req.user.role === 'hod' && !departmentScopeMatches(req.user, tt.course?.department_id)) {
      throw forbidden('You do not have access to this timetable');
    }
    let qb = supabase
      .from('timetable_entries')
      .select(
        `*, division:divisions(name), room:rooms(room_number, room_name, room_type),
         time_slot:time_slots(period_number, start_time, end_time, is_break, working_day:working_days(name, day_number)),
         faculty:faculty_subjects!inner(faculty_id, subject_id, faculty:faculty(id, name, employee_id), subject:subjects(code, name, is_lab))`
      )
      .eq('timetable_id', req.params.id);
    const { data, error } = await qb;
    if (error) throw error;
    const sorted = (data || []).sort((a, b) => {
      const d =
        (a.time_slot?.working_day?.day_number || 0) - (b.time_slot?.working_day?.day_number || 0);
      if (d !== 0) return d;
      return (a.time_slot?.period_number || 0) - (b.time_slot?.period_number || 0);
    });
    return ok(res, sorted, 'Timetable entries');
  } catch (err) {
    return next(fromDbError(err));
  }
});

/**
 * POST /api/v1/timetables/:id/validate
 */
timetableRouter.post('/:id/validate', requireAdminOrHod, async (req, res, next) => {
  try {
    const tt = await loadTimetableFor(req.params.id);
    if (!tt) throw notFound('Timetable not found');
    if (req.user.role === 'hod' && !departmentScopeMatches(req.user, tt.course?.department_id)) {
      throw forbidden('You do not have access to this timetable');
    }
    const result = await validateTimetable(req.params.id);
    if (!result.valid) {
      return res.status(409).json({
        success: false,
        error: { code: 'TIMETABLE_CONFLICT', message: 'Timetable contains unresolved conflicts', conflicts: result.conflicts },
      });
    }
    return ok(res, { timetable_id: req.params.id, valid: true, conflicts: [] }, 'Timetable is valid');
  } catch (err) {
    return next(fromDbError(err));
  }
});

async function guardedTransition(req, res, next, from, to, { allowed = ['admin', 'hod'], comment = null, set = {} }) {
  try {
    const tt = await loadTimetableFor(req.params.id);
    if (!tt) throw notFound('Timetable not found');
    if (!allowed.includes(req.user.role)) throw forbidden('You do not have permission for this action');
    if (req.user.role === 'hod' && !departmentScopeMatches(req.user, tt.course?.department_id)) {
      throw forbidden('You do not have access to this timetable');
    }
    if (tt.status !== from) {
      throw conflict(`Timetable must be "${from}" to perform this action (current: ${tt.status})`);
    }

    if (to === 'approved') {
      const result = await validateTimetable(req.params.id);
      if (!result.valid) {
        await logAudit({
          user_id: req.user.id, action: `${from}_to_${to}_blocked`, entity_type: 'timetable', entity_id: req.params.id,
          previous_status: from, new_status: from, comment: comment || 'validation failed', ip: req.ip,
        });
        return res.status(409).json({
          success: false,
          error: { code: 'TIMETABLE_CONFLICT', message: 'Timetable contains unresolved conflicts', conflicts: result.conflicts },
        });
      }
    }

    const payload = { status: to, previous_status: from, ...set };
    if (to === 'pending_approval') {
      payload.submitted_at = new Date().toISOString();
      payload.submitted_by = req.user.id;
    } else if (to === 'approved') {
      payload.approved_at = new Date().toISOString();
      payload.approved_by = req.user.id;
      payload.rejected_at = null;
      payload.rejection_comment = null;
    } else if (to === 'published') {
      payload.published_at = new Date().toISOString();
      payload.published_by = req.user.id;
    } else if (to === 'draft' && from === 'pending_approval') {
      payload.rejected_at = new Date().toISOString();
      payload.rejection_comment = comment;
    } else if (to === 'archived') {
      payload.archived_at = new Date().toISOString();
    }

    const { data, error } = await supabase.from('timetable').update(payload).eq('id', req.params.id).select().single();
    if (error) throw error;

    await logAudit({
      user_id: req.user.id, action: `timetable_${to}`, entity_type: 'timetable', entity_id: req.params.id,
      previous_status: tt.status, new_status: to, comment, ip: req.ip,
    });
    return ok(res, data, `Timetable ${to.replace('_', ' ')}`);
  } catch (err) {
    return next(fromDbError(err));
  }
}

timetableRouter.post('/:id/submit', requireAdmin, async (req, res, next) =>
  guardedTransition(req, res, next, 'draft', 'pending_approval', { allowed: ['admin'] }));

const rejectSchema = z.object({ comment: z.string().trim().min(1, 'A rejection comment is required').max(2000) });
timetableRouter.post('/:id/reject', requireAdminOrHod, validateBody(rejectSchema), async (req, res, next) =>
  guardedTransition(req, res, next, 'pending_approval', 'draft', { allowed: ['admin', 'hod'], comment: req.body.comment }));

timetableRouter.post('/:id/approve', requireAdminOrHod, async (req, res, next) =>
  guardedTransition(req, res, next, 'pending_approval', 'approved', { allowed: ['admin', 'hod'] }));

timetableRouter.post('/:id/publish', requireAdmin, async (req, res, next) =>
  guardedTransition(req, res, next, 'approved', 'published', { allowed: ['admin'] }));

timetableRouter.post('/:id/unpublish', requireAdmin, async (req, res, next) =>
  guardedTransition(req, res, next, 'published', 'approved', { allowed: ['admin'] }));

timetableRouter.post('/:id/archive', requireAdmin, async (req, res, next) =>
  guardedTransition(req, res, next, 'approved', 'archived', { allowed: ['admin'] }));

// Allow archiving a published timetable as well (admin only).
timetableRouter.post('/:id/unpublish-archive', requireAdmin, async (req, res, next) =>
  guardedTransition(req, res, next, 'published', 'archived', { allowed: ['admin'] }));

timetableRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const tt = await loadTimetableFor(req.params.id);
    if (!tt) throw notFound('Timetable not found');
    if (tt.status === 'published') {
      throw conflict('Published timetables are immutable. Unpublish it before deleting.');
    }
    const { error } = await supabase.from('timetable').delete().eq('id', req.params.id);
    if (error) throw error;
    await logAudit({
      user_id: req.user.id, action: 'timetable_deleted', entity_type: 'timetable', entity_id: req.params.id,
      previous_status: tt.status, new_status: null, ip: req.ip,
    });
    return ok(res, { id: req.params.id }, 'Timetable deleted');
  } catch (err) {
    return next(fromDbError(err));
  }
});