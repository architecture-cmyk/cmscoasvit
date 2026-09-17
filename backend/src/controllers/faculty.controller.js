import { z } from 'zod';
import { Router } from 'express';
import { supabase } from '../supabase.js';
import { validateBody, validateQuery, uuidSchema, emailSchema, nameSchema, paginationQuery, positiveNumber } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { parsePagination } from '../utils/response.js';
import { notFound, conflict, unprocessable, badRequest } from '../utils/errors.js';
import { fromDbError } from '../utils/errors.js';
import { applyScope } from '../services/scope.js';
import { logAudit } from '../services/audit.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { requireRoles } from '../middleware/rbac.js';

export const facultyRouter = Router();
facultyRouter.use(authenticate);

const facultySchema = z.object({
  department_id: uuidSchema,
  employee_id: nameSchema,
  name: nameSchema,
  designation: z.string().trim().max(200).nullable().optional(),
  email: emailSchema,
  mobile: z.string().trim().max(30).optional(),
  maximum_weekly_load: positiveNumber('Maximum weekly load must be a non-negative number'),
  is_active: z.boolean().optional(),
});

const patchedSchema = facultySchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: 'At least one field is required',
});

facultyRouter.get('/', requireRoles('admin', 'hod', 'faculty'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('faculty').select('*', { count: 'exact' }).order('name', { ascending: true });
    qb = await applyScope(qb, req.user, 'faculty');

    if (req.query.department_id) qb = qb.eq('department_id', req.query.department_id);
    if (req.query.is_active) qb = qb.eq('is_active', req.query.is_active === 'true');
    if (req.query.q) qb = qb.or(`name.ilike.%${req.query.q}%,employee_id.ilike.%${req.query.q}%,email.ilike.%${req.query.q}%`);

    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const total = count || 0;
    return ok(res, data || [], 'Listed faculty', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});

facultyRouter.get('/:id', requireRoles('admin', 'hod', 'faculty'), async (req, res, next) => {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(req.params.id)) throw badRequest('Invalid faculty id');
    let qb = supabase.from('faculty').select('*').eq('id', req.params.id);
    const { data, error } = await (await applyScope(qb, req.user, 'faculty')).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Faculty not found');
    return ok(res, data);
  } catch (err) {
    return next(fromDbError(err));
  }
});

facultyRouter.post('/', requireAdmin, validateBody(facultySchema), async (req, res, next) => {
  try {
    const duplicate = await supabase
      .from('faculty')
      .select('id')
      .or(`employee_id.eq.${req.body.employee_id},email.eq.${req.body.email}`)
      .maybeSingle();
    if (duplicate.data) {
      throw conflict('Employee ID or email already in use');
    }
    const { data, error } = await supabase.from('faculty').insert(req.body).select().single();
    if (error) throw error;
    await logAudit({
      user_id: req.user.id, action: 'faculty_created', entity_type: 'faculty', entity_id: data.id,
      metadata: { name: data.name, employee_id: data.employee_id }, ip: req.ip,
    });
    return created(res, data, 'Faculty created');
  } catch (err) {
    return next(fromDbError(err));
  }
});

facultyRouter.patch('/:id', requireAdmin, validateBody(patchedSchema), async (req, res, next) => {
  try {
    const existing = await supabase.from('faculty').select('*').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('Faculty not found');

    if (req.body.employee_id || req.body.email) {
      const dup = await supabase
        .from('faculty')
        .select('id')
        .or(`employee_id.eq.${req.body.employee_id || existing.data.employee_id},email.eq.${req.body.email || existing.data.email}`)
        .neq('id', req.params.id)
        .maybeSingle();
      if (dup.data) throw conflict('Employee ID or email already in use');
    }

    const { data, error } = await supabase
      .from('faculty')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    await logAudit({
      user_id: req.user.id, action: 'faculty_updated', entity_type: 'faculty', entity_id: req.params.id,
      metadata: { changes: req.body }, ip: req.ip,
    });
    return ok(res, data, 'Faculty updated');
  } catch (err) {
    return next(fromDbError(err));
  }
});

facultyRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const existing = await supabase.from('faculty').select('id, employee_id, name').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('Faculty not found');

    const linkedUser = await supabase.from('users').select('id').eq('faculty_id', req.params.id).maybeSingle();
    const { count: entries } = await supabase
      .from('timetable_entries')
      .select('id', { count: 'exact', head: true })
      .eq('faculty_id', req.params.id);

    if (linkedUser.data || (entries || 0) > 0) {
      await supabase.from('faculty').update({ is_active: false }).eq('id', req.params.id);
      await logAudit({
        user_id: req.user.id, action: 'faculty_deactivated', entity_type: 'faculty', entity_id: req.params.id,
        metadata: { reason: 'linked to active user or timetable entries' }, ip: req.ip,
      });
      return ok(res, { id: req.params.id, is_active: false }, 'Faculty has related records; deactivated instead of deleted');
    }

    const { error } = await supabase.from('faculty').delete().eq('id', req.params.id);
    if (error) throw error;
    await logAudit({
      user_id: req.user.id, action: 'faculty_deleted', entity_type: 'faculty', entity_id: req.params.id,
      metadata: { name: existing.data.name }, ip: req.ip,
    });
    return ok(res, { id: req.params.id }, 'Faculty deleted');
  } catch (err) {
    return next(fromDbError(err));
  }
});