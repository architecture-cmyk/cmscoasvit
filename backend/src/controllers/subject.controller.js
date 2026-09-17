import { z } from 'zod';
import { Router } from 'express';
import { supabase } from '../supabase.js';
import {
  validateBody, validateQuery, uuidSchema, nameSchema, paginationQuery, positiveNumber, optionalUuid,
} from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { parsePagination } from '../utils/response.js';
import { notFound, conflict, unprocessable, assertFound } from '../utils/errors.js';
import { fromDbError } from '../utils/errors.js';
import { applyScope } from '../services/scope.js';
import { logAudit } from '../services/audit.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, requireRoles } from '../middleware/rbac.js';

export const subjectRouter = Router();
subjectRouter.use(authenticate);

const subjectSchema = z.object({
  department_id: uuidSchema,
  course_id: optionalUuid,
  semester_id: optionalUuid,
  code: nameSchema,
  name: nameSchema,
  lecture_hours: positiveNumber('Lecture hours must be non-negative'),
  tutorial_hours: positiveNumber('Tutorial hours must be non-negative'),
  practical_hours: positiveNumber('Practical hours must be non-negative'),
  is_lab: z.boolean().optional(),
  credits: positiveNumber('Credits must be non-negative').optional(),
  is_active: z.boolean().optional(),
});

const patchedSchema = subjectSchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: 'At least one field is required',
});

async function validateContext(body, existing = {}) {
  const courseId = body.course_id ?? existing.course_id;
  const semesterId = body.semester_id ?? existing.semester_id;
  const departmentId = body.department_id ?? existing.department_id;

  if (departmentId && courseId) {
    const { data: course, error } = await supabase.from('courses').select('id, department_id').eq('id', courseId).maybeSingle();
    if (error || !course) throw unprocessable('Linked course does not exist');
    if (course.department_id !== departmentId) {
      throw unprocessable('Subject department must match the course department');
    }
  }
  if (semesterId) {
    const { data: sem } = await supabase.from('semesters').select('id').eq('id', semesterId).maybeSingle();
    if (!sem) throw unprocessable('Linked semester does not exist');
  }
}

const listSelect = '*, course:courses(id, name), semester:semesters(id, name), department:departments(id, code, name), credits:subject_credits(credits)';

subjectRouter.get('/', requireRoles('admin', 'hod', 'faculty'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('subjects').select(listSelect, { count: 'exact' }).order('code', { ascending: true });
    qb = await applyScope(qb, req.user, 'subjects');

    if (req.query.department_id) qb = qb.eq('department_id', req.query.department_id);
    if (req.query.course_id) qb = qb.eq('course_id', req.query.course_id);
    if (req.query.semester_id) qb = qb.eq('semester_id', req.query.semester_id);
    if (req.query.is_active) qb = qb.eq('is_active', req.query.is_active === 'true');
    if (req.query.q) qb = qb.or(`code.ilike.%${req.query.q}%,name.ilike.%${req.query.q}%`);

    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const total = count || 0;
    return ok(res, data || [], 'Listed subjects', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});

subjectRouter.get('/:id', requireRoles('admin', 'hod', 'faculty'), async (req, res, next) => {
  try {
    const qb = await applyScope(supabase.from('subjects').select(listSelect).eq('id', req.params.id), req.user, 'subjects');
    const { data, error } = await qb.maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Subject not found');
    return ok(res, data);
  } catch (err) {
    return next(fromDbError(err));
  }
});

subjectRouter.post('/', requireAdmin, validateBody(subjectSchema), async (req, res, next) => {
  try {
    await validateContext(req.body);
    const dup = await supabase.from('subjects').select('id').eq('code', req.body.code).maybeSingle();
    if (dup.data) throw conflict('Subject code already exists');

    const { code, name, department_id, course_id, semester_id, lecture_hours, tutorial_hours, practical_hours, is_lab, is_active, credits } = req.body;

    const weekly_required_hours =
      Number(lecture_hours ?? 0) + Number(tutorial_hours ?? 0) + Number(practical_hours ?? 0);

    const { data, error } = await supabase
      .from('subjects')
      .insert({
        code, name, department_id, course_id, semester_id, is_lab: is_lab ?? false,
        lecture_hours, tutorial_hours, practical_hours, weekly_required_hours,
        is_active: is_active ?? true,
      })
      .select()
      .single();
    if (error) throw error;

    if (credits != null) {
      const { error: ce } = await supabase.from('subject_credits').insert({ subject_id: data.id, credits });
      if (ce) throw ce;
    }

    await logAudit({
      user_id: req.user.id, action: 'subject_created', entity_type: 'subjects', entity_id: data.id,
      metadata: { code: data.code, name: data.name }, ip: req.ip,
    });
    return created(res, data, 'Subject created');
  } catch (err) {
    return next(fromDbError(err));
  }
});

subjectRouter.patch('/:id', requireAdmin, validateBody(patchedSchema), async (req, res, next) => {
  try {
    const existing = await supabase.from('subjects').select('*').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('Subject not found');

    await validateContext(req.body, existing.data);

    if (req.body.code && req.body.code !== existing.data.code) {
      const dup = await supabase.from('subjects').select('id').eq('code', req.body.code).neq('id', req.params.id).maybeSingle();
      if (dup.data) throw conflict('Subject code already exists');
    }

    const merged = { ...req.body };
    if (
      req.body.lecture_hours != null ||
      req.body.tutorial_hours != null ||
      req.body.practical_hours != null
    ) {
      merged.weekly_required_hours =
        Number(req.body.lecture_hours ?? existing.data.lecture_hours) +
        Number(req.body.tutorial_hours ?? existing.data.tutorial_hours) +
        Number(req.body.practical_hours ?? existing.data.practical_hours);
    }

    const { data, error } = await supabase.from('subjects').update(merged).eq('id', req.params.id).select().single();
    if (error) throw error;

    if (req.body.credits != null) {
      const { error: ce } = await supabase
        .from('subject_credits')
        .upsert({ subject_id: data.id, credits: req.body.credits }, { onConflict: 'subject_id' });
      if (ce) throw ce;
    }

    await logAudit({
      user_id: req.user.id, action: 'subject_updated', entity_type: 'subjects', entity_id: req.params.id,
      metadata: { changes: req.body }, ip: req.ip,
    });
    return ok(res, data, 'Subject updated');
  } catch (err) {
    return next(fromDbError(err));
  }
});

subjectRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const existing = await supabase.from('subjects').select('id, code, name').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('Subject not found');

    const { count: mappings } = await supabase
      .from('faculty_subjects').select('id', { count: 'exact', head: true }).eq('subject_id', req.params.id);
    const { count: timetables } = await supabase
      .from('timetable_entries').select('id', { count: 'exact', head: true })
      .in('faculty_subject_id', (await supabase.from('faculty_subjects').select('id').eq('subject_id', req.params.id)).data?.map((r) => r.id) || ['00000000-0000-0000-0000-000000000000']);

    if ((mappings || 0) > 0 || (timetables || 0) > 0) {
      await supabase.from('subjects').update({ is_active: false }).eq('id', req.params.id);
      await logAudit({
        user_id: req.user.id, action: 'subject_deactivated', entity_type: 'subjects', entity_id: req.params.id, ip: req.ip,
      });
      return ok(res, { id: req.params.id, is_active: false }, 'Subject is in use; deactivated instead of deleted');
    }

    await supabase.from('subject_credits').delete().eq('subject_id', req.params.id).catch(() => {});
    const { error } = await supabase.from('subjects').delete().eq('id', req.params.id);
    if (error) throw error;
    await logAudit({
      user_id: req.user.id, action: 'subject_deleted', entity_type: 'subjects', entity_id: req.params.id,
      metadata: { code: existing.data.code }, ip: req.ip,
    });
    return ok(res, { id: req.params.id }, 'Subject deleted');
  } catch (err) {
    return next(fromDbError(err));
  }
});

// ---------------------------------------------------------------------------
// Faculty <-> subject mapping
// ---------------------------------------------------------------------------
export const facultySubjectRouter = Router();
facultySubjectRouter.use(authenticate);

const mappingSchema = z.object({
  faculty_id: uuidSchema,
  subject_id: uuidSchema,
  division_id: uuidSchema,
  academic_year_id: uuidSchema,
  is_active: z.boolean().optional(),
});

const mappingListSelect = '*, faculty:faculty(id, name, employee_id), subject:subjects(code, name, is_lab), division:divisions(name, course:courses(name)), academic_year:academic_years(name)';

facultySubjectRouter.get('/', requireRoles('admin', 'hod', 'faculty'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('faculty_subjects').select(mappingListSelect, { count: 'exact' }).order('created_at', { ascending: false });
    qb = await applyScope(qb, req.user, 'faculty_subjects');

    if (req.query.faculty_id) qb = qb.eq('faculty_id', req.query.faculty_id);
    if (req.query.subject_id) qb = qb.eq('subject_id', req.query.subject_id);
    if (req.query.division_id) qb = qb.eq('division_id', req.query.division_id);
    if (req.query.academic_year_id) qb = qb.eq('academic_year_id', req.query.academic_year_id);

    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const total = count || 0;
    return ok(res, data || [], 'Listed faculty-subject mappings', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});

facultySubjectRouter.post('/', requireAdmin, validateBody(mappingSchema), async (req, res, next) => {
  try {
    const { faculty_id, subject_id, division_id, academic_year_id } = req.body;

    const [faculty, subject, division, acadYear] = await Promise.all([
      supabase.from('faculty').select('id, department_id, is_active').eq('id', faculty_id).maybeSingle(),
      supabase.from('subjects').select('id, department_id, course_id, semester_id, is_active').eq('id', subject_id).maybeSingle(),
      supabase.from('divisions').select('id, course_id, semester_id, academic_year_id').eq('id', division_id).maybeSingle(),
      supabase.from('academic_years').select('id, is_active').eq('id', academic_year_id).maybeSingle(),
    ]);

    if (!faculty.data) throw notFound('Faculty not found');
    if (!subject.data) throw notFound('Subject not found');
    if (!division.data) throw notFound('Division not found');
    if (!acadYear.data) throw notFound('Academic year not found');
    assertFound(faculty.data.is_active, 'Inactive faculty cannot be assigned');
    assertFound(subject.data.is_active, 'Inactive subject cannot be assigned');
    if (division.data.academic_year_id !== academic_year_id) {
      throw unprocessable('Division does not belong to the selected academic year');
    }
    if (division.data.course_id !== subject.data.course_id) {
      throw unprocessable('Subject cannot be assigned to a division from a different course');
    }
    if (subject.data.semester_id && division.data.semester_id !== subject.data.semester_id) {
      throw unprocessable('Subject semester does not match the division semester');
    }
    if (subject.data.department_id !== faculty.data.department_id) {
      throw unprocessable('Faculty department and subject department must match');
    }

    const dup = await supabase
      .from('faculty_subjects')
      .select('id')
      .eq('faculty_id', faculty_id)
      .eq('subject_id', subject_id)
      .eq('division_id', division_id)
      .eq('academic_year_id', academic_year_id)
      .maybeSingle();
    if (dup.data) throw conflict('This faculty-subject-division mapping already exists');

    const { data, error } = await supabase
      .from('faculty_subjects')
      .insert({ faculty_id, subject_id, division_id, academic_year_id, is_active: true })
      .select()
      .single();
    if (error) throw error;
    await logAudit({
      user_id: req.user.id, action: 'mapping_created', entity_type: 'faculty_subjects', entity_id: data.id, ip: req.ip,
    });
    return created(res, data, 'Mapping created');
  } catch (err) {
    return next(fromDbError(err));
  }
});

facultySubjectRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { count: inUse } = await supabase
      .from('timetable_entries').select('id', { count: 'exact', head: true }).eq('faculty_subject_id', req.params.id);
    if ((inUse || 0) > 0) {
      await supabase.from('faculty_subjects').update({ is_active: false }).eq('id', req.params.id);
      return ok(res, { id: req.params.id, is_active: false }, 'Mapping is used by a timetable; deactivated instead of deleted');
    }
    const { error, data } = await supabase.from('faculty_subjects').delete().eq('id', req.params.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Mapping not found');
    await logAudit({
      user_id: req.user.id, action: 'mapping_deleted', entity_type: 'faculty_subjects', entity_id: req.params.id, ip: req.ip,
    });
    return ok(res, { id: req.params.id }, 'Mapping deleted');
  } catch (err) {
    return next(fromDbError(err));
  }
});