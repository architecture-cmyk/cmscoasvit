import { z } from 'zod';
import { Router } from 'express';
import { supabase } from '../supabase.js';
import {
  validateBody, validateQuery, uuidSchema, paginationQuery, optionalUuid, timeSchema,
} from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { parsePagination } from '../utils/response.js';
import { notFound, forbidden, unprocessable } from '../utils/errors.js';
import { fromDbError } from '../utils/errors.js';
import { applyScope } from '../services/scope.js';
import { logAudit } from '../services/audit.js';
import { authenticate } from '../middleware/auth.js';
import { requireRoles, requireAdmin } from '../middleware/rbac.js';

export const attendanceRouter = Router();
attendanceRouter.use(authenticate);

const selectAtt = '*, faculty:faculty(id, name, employee_id), subject:subjects(code, name), division:divisions(name), academic_year:academic_years(name)';

const attSchema = z.object({
  faculty_id: optionalUuid,
  subject_id: uuidSchema,
  division_id: optionalUuid,
  timetable_entry_id: optionalUuid,
  academic_year_id: uuidSchema,
  date: z.string().date('Must be a valid ISO date'),
  period_number: z.coerce.number().int().min(1).nullable().optional(),
  in_time: timeSchema.nullable().optional(),
  out_time: timeSchema.nullable().optional(),
  hours: z.coerce.number().min(0).max(24).optional(),
  status: z.enum(['present', 'absent', 'leave']),
  remarks: z.string().trim().max(1000).nullable().optional(),
});

const attPatch = attSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' });

attendanceRouter.get('/', requireRoles('admin', 'hod', 'faculty'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('attendance').select(selectAtt, { count: 'exact' }).order('date', { ascending: false });
    qb = await applyScope(qb, req.user, 'attendance');
    if (req.query.faculty_id) qb = qb.eq('faculty_id', req.query.faculty_id);
    if (req.query.subject_id) qb = qb.eq('subject_id', req.query.subject_id);
    if (req.query.division_id) qb = qb.eq('division_id', req.query.division_id);
    if (req.query.academic_year_id) qb = qb.eq('academic_year_id', req.query.academic_year_id);
    if (req.query.status) qb = qb.eq('status', req.query.status);
    if (req.query.from && req.query.to) {
      qb = qb.gte('date', req.query.from).lte('date', req.query.to);
    } else if (req.query.from) {
      qb = qb.gte('date', req.query.from);
    } else if (req.query.to) {
      qb = qb.lte('date', req.query.to);
    }
    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const total = count || 0;
    return ok(res, data || [], 'Listed attendance records', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});

attendanceRouter.post('/', requireRoles('admin', 'faculty'), validateBody(attSchema), async (req, res, next) => {
  try {
    const body = { ...req.body };
    if (req.user.role === 'faculty') {
      body.faculty_id = req.user.faculty_id;
    }
    if (!body.faculty_id) throw unprocessable('faculty_id is required');
    if (req.user.role === 'faculty' && body.faculty_id !== req.user.faculty_id) {
      throw forbidden('Faculty may only record their own attendance');
    }
    if (body.in_time && body.out_time && body.out_time <= body.in_time) {
      throw unprocessable('out_time must be later than in_time');
    }
    if (body.hours == null && body.in_time && body.out_time) {
      const [h1, m1] = body.in_time.split(':').map(Number);
      const [h2, m2] = body.out_time.split(':').map(Number);
      body.hours = Math.round(((h2 * 60 + m2 - (h1 * 60 + m1)) / 60) * 100) / 100;
    }
    const { data, error } = await supabase.from('attendance').insert({ ...body, created_by: req.user.id }).select().single();
    if (error) throw error;
    await logAudit({ user_id: req.user.id, action: 'attendance_created', entity_type: 'attendance', entity_id: data.id, ip: req.ip });
    return created(res, data, 'Attendance recorded');
  } catch (err) {
    return next(fromDbError(err));
  }
});

attendanceRouter.patch('/:id', requireRoles('admin', 'faculty'), validateBody(attPatch), async (req, res, next) => {
  try {
    const existing = await supabase.from('attendance').select('*').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('Attendance record not found');
    if (req.user.role === 'faculty' && existing.data.faculty_id !== req.user.faculty_id) {
      throw forbidden('Faculty may only update their own attendance records');
    }
    const { data, error } = await supabase.from('attendance').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    await logAudit({ user_id: req.user.id, action: 'attendance_updated', entity_type: 'attendance', entity_id: req.params.id, metadata: { changes: req.body }, ip: req.ip });
    return ok(res, data, 'Attendance updated');
  } catch (err) {
    return next(fromDbError(err));
  }
});

attendanceRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { data: existing } = await supabase.from('attendance').select('id').eq('id', req.params.id).maybeSingle();
    if (!existing) throw notFound('Attendance record not found');
    const { error } = await supabase.from('attendance').delete().eq('id', req.params.id);
    if (error) throw error;
    await logAudit({ user_id: req.user.id, action: 'attendance_deleted', entity_type: 'attendance', entity_id: req.params.id, ip: req.ip });
    return ok(res, { id: req.params.id }, 'Attendance record deleted');
  } catch (err) {
    return next(fromDbError(err));
  }
});