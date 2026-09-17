import { z } from 'zod';
import { Router } from 'express';
import { supabase } from '../supabase.js';
import {
  validateBody, validateQuery, uuidSchema, nameSchema, paginationQuery, optionalUuid, positiveNumber,
} from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { parsePagination } from '../utils/response.js';
import { notFound, conflict, unprocessable, assertFound } from '../utils/errors.js';
import { fromDbError } from '../utils/errors.js';
import { applyScope } from '../services/scope.js';
import { logAudit } from '../services/audit.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, requireRoles } from '../middleware/rbac.js';

// ---------------------------------------------------------------------------
// Academic years
// ---------------------------------------------------------------------------
export const academicYearRouter = Router();
academicYearRouter.use(authenticate);

const yearSchema = z.object({
  name: nameSchema,
  start_date: z.string().date('Must be a valid ISO date').nullable().optional(),
  end_date: z.string().date('Must be a valid ISO date').nullable().optional(),
  is_active: z.boolean().optional(),
});

const yearPatch = yearSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' });

academicYearRouter.get('/', requireRoles('admin', 'hod', 'faculty'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('academic_years').select('*', { count: 'exact' }).order('name', { ascending: false });
    qb = await applyScope(qb, req.user, 'academic_years');
    if (req.query.is_active) qb = qb.eq('is_active', req.query.is_active === 'true');
    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const total = count || 0;
    return ok(res, data || [], 'Listed academic years', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});

academicYearRouter.post('/', requireAdmin, validateBody(yearSchema), async (req, res, next) => {
  try {
    const dup = await supabase.from('academic_years').select('id').eq('name', req.body.name).maybeSingle();
    if (dup.data) throw conflict('Academic year name already exists');
    if (req.body.start_date && req.body.end_date && req.body.end_date < req.body.start_date) {
      throw unprocessable('end_date must be after start_date');
    }
    const { data, error } = await supabase.from('academic_years').insert({ ...req.body, is_active: req.body.is_active ?? false }).select().single();
    if (error) throw error;
    await logAudit({ user_id: req.user.id, action: 'academic_year_created', entity_type: 'academic_years', entity_id: data.id, ip: req.ip });
    return created(res, data, 'Academic year created');
  } catch (err) {
    return next(fromDbError(err));
  }
});

academicYearRouter.patch('/:id', requireAdmin, validateBody(yearPatch), async (req, res, next) => {
  try {
    const existing = await supabase.from('academic_years').select('*').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('Academic year not found');
    const { data, error } = await supabase.from('academic_years').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    await logAudit({ user_id: req.user.id, action: 'academic_year_updated', entity_type: 'academic_years', entity_id: req.params.id, metadata: { changes: req.body }, ip: req.ip });
    return ok(res, data, 'Academic year updated');
  } catch (err) {
    return next(fromDbError(err));
  }
});

academicYearRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { count: divisions } = await supabase.from('divisions').select('id', { count: 'exact', head: true }).eq('academic_year_id', req.params.id);
    const { count: timetables } = await supabase.from('timetable').select('id', { count: 'exact', head: true }).eq('academic_year_id', req.params.id);
    if ((divisions || 0) > 0 || (timetables || 0) > 0) {
      await supabase.from('academic_years').update({ is_active: false }).eq('id', req.params.id);
      return ok(res, { id: req.params.id, is_active: false }, 'Academic year is in use; deactivated instead of deleted');
    }
    const { data } = await supabase.from('academic_years').delete().eq('id', req.params.id).select('id').maybeSingle();
    if (!data) throw notFound('Academic year not found');
    return ok(res, { id: req.params.id }, 'Academic year deleted');
  } catch (err) {
    return next(fromDbError(err));
  }
});

// ---------------------------------------------------------------------------
// Semesters (per academic year)
// ---------------------------------------------------------------------------
export const semesterRouter = Router();
semesterRouter.use(authenticate);

const semesterSchema = z.object({
  academic_year_id: uuidSchema,
  name: nameSchema,
  semester_number: positiveNumber('Semester number must be positive').int('Must be integer').min(1),
  is_active: z.boolean().optional(),
});

semesterRouter.get('/', requireRoles('admin', 'hod', 'faculty'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('semesters').select('*, academic_year:academic_years(name)', { count: 'exact' }).order('semester_number');
    qb = await applyScope(qb, req.user, 'semesters');
    if (req.query.academic_year_id) qb = qb.eq('academic_year_id', req.query.academic_year_id);
    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const total = count || 0;
    return ok(res, data || [], 'Listed semesters', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});

semesterRouter.post('/', requireAdmin, validateBody(semesterSchema), async (req, res, next) => {
  try {
    const year = await supabase.from('academic_years').select('id').eq('id', req.body.academic_year_id).maybeSingle();
    if (!year.data) throw notFound('Academic year not found');
    const dup = await supabase.from('semesters').select('id').eq('academic_year_id', req.body.academic_year_id).eq('semester_number', req.body.semester_number).maybeSingle();
    if (dup.data) throw conflict('Semester already exists for this academic year');
    const { data, error } = await supabase.from('semesters').insert(req.body).select().single();
    if (error) throw error;
    return created(res, data, 'Semester created');
  } catch (err) {
    return next(fromDbError(err));
  }
});

semesterRouter.patch('/:id', requireAdmin, validateBody(semesterSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' })), async (req, res, next) => {
  try {
    const existing = await supabase.from('semesters').select('*').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('Semester not found');
    if (req.body.semester_number != null && req.body.semester_number !== existing.data.semester_number) {
      const dup = await supabase.from('semesters').select('id').eq('academic_year_id', existing.data.academic_year_id).eq('semester_number', req.body.semester_number).neq('id', req.params.id).maybeSingle();
      if (dup.data) throw conflict('Semester number already exists for this academic year');
    }
    const { data, error } = await supabase.from('semesters').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    return ok(res, data, 'Semester updated');
  } catch (err) {
    return next(fromDbError(err));
  }
});

semesterRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { count: divisions } = await supabase.from('divisions').select('id', { count: 'exact', head: true }).eq('semester_id', req.params.id);
    if ((divisions || 0) > 0) return ok(res, { id: req.params.id }, 'Semester is in use by divisions; cannot delete');
    const { data: existing } = await supabase.from('semesters').select('id').eq('id', req.params.id).maybeSingle();
    if (!existing) throw notFound('Semester not found');
    await supabase.from('semesters').delete().eq('id', req.params.id);
    return ok(res, { id: req.params.id }, 'Semester deleted');
  } catch (err) {
    return next(fromDbError(err));
  }
});

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------
export const courseRouter = Router();
courseRouter.use(authenticate);

const courseSchema = z.object({
  department_id: uuidSchema,
  name: nameSchema,
  is_active: z.boolean().optional(),
});

courseRouter.get('/', requireRoles('admin', 'hod', 'faculty'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('courses').select('*, department:departments(code, name)', { count: 'exact' }).order('name');
    qb = await applyScope(qb, req.user, 'courses');
    if (req.query.department_id) qb = qb.eq('department_id', req.query.department_id);
    if (req.query.is_active) qb = qb.eq('is_active', req.query.is_active === 'true');
    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const total = count || 0;
    return ok(res, data || [], 'Listed courses', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});

courseRouter.post('/', requireAdmin, validateBody(courseSchema), async (req, res, next) => {
  try {
    const dept = await supabase.from('departments').select('id').eq('id', req.body.department_id).maybeSingle();
    if (!dept.data) throw notFound('Department not found');
    const { data, error } = await supabase.from('courses').insert({ ...req.body, is_active: req.body.is_active ?? true }).select().single();
    if (error) throw error;
    await logAudit({ user_id: req.user.id, action: 'course_created', entity_type: 'courses', entity_id: data.id, ip: req.ip });
    return created(res, data, 'Course created');
  } catch (err) {
    return next(fromDbError(err));
  }
});

courseRouter.patch('/:id', requireAdmin, validateBody(courseSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' })), async (req, res, next) => {
  try {
    const existing = await supabase.from('courses').select('*').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('Course not found');
    const { data, error } = await supabase.from('courses').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    return ok(res, data, 'Course updated');
  } catch (err) {
    return next(fromDbError(err));
  }
});

courseRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { count: divisions } = await supabase.from('divisions').select('id', { count: 'exact', head: true }).eq('course_id', req.params.id);
    if ((divisions || 0) > 0) {
      await supabase.from('courses').update({ is_active: false }).eq('id', req.params.id);
      return ok(res, { id: req.params.id, is_active: false }, 'Course is in use; deactivated instead of deleted');
    }
    const { data: existing } = await supabase.from('courses').select('id').eq('id', req.params.id).maybeSingle();
    if (!existing) throw notFound('Course not found');
    await supabase.from('courses').delete().eq('id', req.params.id);
    return ok(res, { id: req.params.id }, 'Course deleted');
  } catch (err) {
    return next(fromDbError(err));
  }
});

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------
export const divisionRouter = Router();
divisionRouter.use(authenticate);

const divisionSchema = z.object({
  course_id: uuidSchema,
  academic_year_id: uuidSchema,
  semester_id: uuidSchema,
  name: nameSchema,
  strength: z.coerce.number().int('Must be an integer').min(1, 'Strength must be positive'),
  is_active: z.boolean().optional(),
});

divisionRouter.get('/', requireRoles('admin', 'hod', 'faculty'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('divisions')
      .select('*, course:courses(name, department:departments(code, name)), academic_year:academic_years(name), semester:semesters(name)', { count: 'exact' })
      .order('name');
    qb = await applyScope(qb, req.user, 'divisions');
    if (req.query.course_id) qb = qb.eq('course_id', req.query.course_id);
    if (req.query.academic_year_id) qb = qb.eq('academic_year_id', req.query.academic_year_id);
    if (req.query.semester_id) qb = qb.eq('semester_id', req.query.semester_id);
    if (req.query.is_active) qb = qb.eq('is_active', req.query.is_active === 'true');
    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const total = count || 0;
    return ok(res, data || [], 'Listed divisions', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});

divisionRouter.post('/', requireAdmin, validateBody(divisionSchema), async (req, res, next) => {
  try {
    const [course, year, semester] = await Promise.all([
      supabase.from('courses').select('id').eq('id', req.body.course_id).maybeSingle(),
      supabase.from('academic_years').select('id, is_active').eq('id', req.body.academic_year_id).maybeSingle(),
      supabase.from('semesters').select('id, academic_year_id').eq('id', req.body.semester_id).maybeSingle(),
    ]);
    if (!course.data) throw notFound('Course not found');
    if (!year.data) throw notFound('Academic year not found');
    if (!semester.data) throw notFound('Semester not found');
    if (semester.data.academic_year_id !== req.body.academic_year_id) {
      throw unprocessable('Semester does not belong to the selected academic year');
    }
    const dup = await supabase.from('divisions').select('id')
      .eq('course_id', req.body.course_id).eq('academic_year_id', req.body.academic_year_id)
      .eq('semester_id', req.body.semester_id).eq('name', req.body.name).maybeSingle();
    if (dup.data) throw conflict('Division already exists for this course/year/semester');
    const { data, error } = await supabase.from('divisions').insert({ ...req.body, is_active: req.body.is_active ?? true }).select().single();
    if (error) throw error;
    return created(res, data, 'Division created');
  } catch (err) {
    return next(fromDbError(err));
  }
});

divisionRouter.patch('/:id', requireAdmin, validateBody(divisionSchema.partial().omit({ course_id: true }).refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' })), async (req, res, next) => {
  try {
    const existing = await supabase.from('divisions').select('*').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('Division not found');
    const { data, error } = await supabase.from('divisions').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    return ok(res, data, 'Division updated');
  } catch (err) {
    return next(fromDbError(err));
  }
});

divisionRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { count: mappings } = await supabase.from('faculty_subjects').select('id', { count: 'exact', head: true }).eq('division_id', req.params.id);
    const { count: entries } = await supabase.from('timetable_entries').select('id', { count: 'exact', head: true }).eq('division_id', req.params.id);
    if ((mappings || 0) > 0 || (entries || 0) > 0) {
      await supabase.from('divisions').update({ is_active: false }).eq('id', req.params.id);
      return ok(res, { id: req.params.id, is_active: false }, 'Division is in use; deactivated instead of deleted');
    }
    const { data: existing } = await supabase.from('divisions').select('id').eq('id', req.params.id).maybeSingle();
    if (!existing) throw notFound('Division not found');
    await supabase.from('divisions').delete().eq('id', req.params.id);
    return ok(res, { id: req.params.id }, 'Division deleted');
  } catch (err) {
    return next(fromDbError(err));
  }
});