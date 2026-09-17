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
import { requireRoles } from '../middleware/rbac.js';

export const lessonPlanRouter = Router();
lessonPlanRouter.use(authenticate);

const selectLP = '*, academic_year:academic_years(name), semester:semesters(name), course:courses(name), division:divisions(name), faculty:faculty(id, name, employee_id), subject:subjects(code, name)';

const lpSchema = z.object({
  academic_year_id: uuidSchema,
  semester_id: uuidSchema,
  course_id: uuidSchema,
  division_id: uuidSchema,
  faculty_id: optionalUuid,
  subject_id: uuidSchema,
  unit: z.string().trim().min(1, 'Required').max(100),
  topic: z.string().trim().min(1, 'Required').max(300),
  lesson_number: z.coerce.number().int().min(1),
  planned_date: z.string().date('Must be a valid ISO date').nullable().optional(),
  period_number: z.coerce.number().int().min(1).nullable().optional(),
  start_time: timeSchema.nullable().optional(),
  end_time: timeSchema.nullable().optional(),
  teaching_method: z.string().trim().max(100).nullable().optional(),
  remarks: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected']).optional(),
});

const lpPatch = lpSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' });

lessonPlanRouter.get('/', requireRoles('admin', 'hod', 'faculty'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('lesson_plans').select(selectLP, { count: 'exact' }).order('planned_date', { ascending: false, nullsFirst: false });
    qb = await applyScope(qb, req.user, 'lesson_plans');
    if (req.query.academic_year_id) qb = qb.eq('academic_year_id', req.query.academic_year_id);
    if (req.query.semester_id) qb = qb.eq('semester_id', req.query.semester_id);
    if (req.query.course_id) qb = qb.eq('course_id', req.query.course_id);
    if (req.query.division_id) qb = qb.eq('division_id', req.query.division_id);
    if (req.query.subject_id) qb = qb.eq('subject_id', req.query.subject_id);
    if (req.query.faculty_id) qb = qb.eq('faculty_id', req.query.faculty_id);
    if (req.query.status) qb = qb.eq('status', req.query.status);
    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const total = count || 0;
    return ok(res, data || [], 'Listed lesson plans', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});

lessonPlanRouter.get('/:id', requireRoles('admin', 'hod', 'faculty'), async (req, res, next) => {
  try {
    const qb = await applyScope(supabase.from('lesson_plans').select(selectLP).eq('id', req.params.id), req.user, 'lesson_plans');
    const { data, error } = await qb.maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Lesson plan not found');
    return ok(res, data);
  } catch (err) {
    return next(fromDbError(err));
  }
});

lessonPlanRouter.post('/', requireRoles('admin', 'faculty'), validateBody(lpSchema), async (req, res, next) => {
  try {
    const body = { ...req.body };
    if (req.user.role === 'faculty') {
      body.faculty_id = req.user.faculty_id;
    }
    if (!body.faculty_id) throw unprocessable('faculty_id is required');
    if (req.user.role === 'faculty' && body.faculty_id !== req.user.faculty_id) {
      throw forbidden('Faculty may only create their own lesson plans');
    }

    // validate that the faculty actually teaches this subject in this division
    const { data: mapping } = await supabase
      .from('faculty_subjects')
      .select('id')
      .eq('faculty_id', body.faculty_id)
      .eq('subject_id', body.subject_id)
      .eq('division_id', body.division_id)
      .eq('academic_year_id', body.academic_year_id)
      .maybeSingle();
    if (!mapping) {
      throw unprocessable('Faculty is not mapped to this subject/division/academic year');
    }

    const { data, error } = await supabase.from('lesson_plans').insert({ ...body, created_by: req.user.id }).select().single();
    if (error) throw error;
    await logAudit({ user_id: req.user.id, action: 'lesson_plan_created', entity_type: 'lesson_plans', entity_id: data.id, ip: req.ip });
    return created(res, data, 'Lesson plan created');
  } catch (err) {
    return next(fromDbError(err));
  }
});

lessonPlanRouter.patch('/:id', requireRoles('admin', 'faculty'), validateBody(lpPatch), async (req, res, next) => {
  try {
    const existing = await supabase.from('lesson_plans').select('*').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('Lesson plan not found');

    if (req.user.role === 'faculty') {
      if (existing.data.faculty_id !== req.user.faculty_id) {
        throw forbidden('Faculty may only update their own lesson plans');
      }
      if (existing.data.status === 'approved') {
        throw forbidden('Approved lesson plans cannot be edited');
      }
    }

    const { data, error } = await supabase.from('lesson_plans').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    await logAudit({ user_id: req.user.id, action: 'lesson_plan_updated', entity_type: 'lesson_plans', entity_id: req.params.id, metadata: { changes: req.body }, ip: req.ip });
    return ok(res, data, 'Lesson plan updated');
  } catch (err) {
    return next(fromDbError(err));
  }
});

lessonPlanRouter.delete('/:id', requireRoles('admin', 'faculty'), async (req, res, next) => {
  try {
    const existing = await supabase.from('lesson_plans').select('id, faculty_id').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('Lesson plan not found');
    if (req.user.role === 'faculty' && existing.data.faculty_id !== req.user.faculty_id) {
      throw forbidden('Faculty may only delete their own lesson plans');
    }
    const { error } = await supabase.from('lesson_plans').delete().eq('id', req.params.id);
    if (error) throw error;
    await logAudit({ user_id: req.user.id, action: 'lesson_plan_deleted', entity_type: 'lesson_plans', entity_id: req.params.id, ip: req.ip });
    return ok(res, { id: req.params.id }, 'Lesson plan deleted');
  } catch (err) {
    return next(fromDbError(err));
  }
});