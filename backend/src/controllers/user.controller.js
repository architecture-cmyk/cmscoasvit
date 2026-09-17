import { z } from 'zod';
import { Router } from 'express';
import { supabase } from '../supabase.js';
import { validateBody, validateQuery, uuidSchema, emailSchema, paginationQuery } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { parsePagination } from '../utils/response.js';
import { notFound, conflict, unprocessable } from '../utils/errors.js';
import { fromDbError } from '../utils/errors.js';
import { logAudit } from '../services/audit.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, requireRoles } from '../middleware/rbac.js';

export const userRouter = Router();
userRouter.use(authenticate);

const selectUsers = '*, department:departments(code, name), faculty:faculty(id, name, employee_id)';

userRouter.get('/', requireRoles('admin', 'hod'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('users').select(selectUsers, { count: 'exact' }).order('created_at', { ascending: false });
    if (req.query.role) qb = qb.eq('role', req.query.role);
    if (req.user.role === 'hod') qb = qb.eq('department_id', req.user.department_id);
    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const total = count || 0;
    return ok(res, data || [], 'Listed users', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});

const provisionSchema = z.object({
  user_id: uuidSchema,
  role: z.enum(['admin', 'hod', 'faculty']),
  department_id: uuidSchema.nullable().optional(),
  faculty_id: uuidSchema.nullable().optional(),
});

userRouter.post('/provision', requireAdmin, validateBody(provisionSchema), async (req, res, next) => {
  try {
    const { user_id, role, department_id, faculty_id } = req.body;

    let deptId = department_id || null;
    let facId = faculty_id || null;

    if (role === 'faculty') {
      if (!facId) throw unprocessable('faculty_id is required for faculty role');
      const { data: fac } = await supabase.from('faculty').select('department_id').eq('id', facId).maybeSingle();
      if (!fac) throw notFound('Faculty record not found');
      deptId = fac.department_id;
    }
    if (role === 'hod') {
      if (!deptId) throw unprocessable('department_id is required for hod role');
    }

    const existing = await supabase.from('users').select('id, is_active, role').eq('id', user_id).maybeSingle();
    if (existing.data && existing.data.is_active) {
      throw conflict('User is already provisioned and active');
    }

    const { data, error } = await supabase
      .from('users')
      .upsert({ id: user_id, role, department_id: deptId, faculty_id: facId, is_active: true }, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw error;

    await logAudit({
      user_id: req.user.id, action: 'user_provisioned', entity_type: 'users', entity_id: user_id,
      metadata: { role, department_id: deptId, faculty_id: facId }, ip: req.ip,
    });
    return created(res, data, 'User provisioned');
  } catch (err) {
    return next(fromDbError(err));
  }
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'hod', 'faculty']).optional(),
  department_id: uuidSchema.nullable().optional(),
  faculty_id: uuidSchema.nullable().optional(),
  is_active: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' });

userRouter.patch('/:id', requireAdmin, validateBody(updateUserSchema), async (req, res, next) => {
  try {
    const existing = await supabase.from('users').select('*').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('User not found');

    const payload = { ...req.body };
    if (payload.role === 'admin') {
      payload.department_id = null;
      payload.faculty_id = null;
    }
    if (payload.role === 'faculty' && req.body.faculty_id) {
      const { data: fac } = await supabase.from('faculty').select('department_id').eq('id', req.body.faculty_id).maybeSingle();
      if (!fac) throw notFound('Faculty record not found');
      payload.department_id = fac.department_id;
    }

    const { data, error } = await supabase.from('users').update(payload).eq('id', req.params.id).select().single();
    if (error) throw error;
    await logAudit({
      user_id: req.user.id, action: 'user_updated', entity_type: 'users', entity_id: req.params.id,
      previous_status: existing.data.is_active ? 'active' : 'inactive',
      new_status: payload.is_active != null ? (payload.is_active ? 'active' : 'inactive') : null,
      metadata: { changes: payload }, ip: req.ip,
    });
    return ok(res, data, 'User updated');
  } catch (err) {
    return next(fromDbError(err));
  }
});

userRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      throw conflict('You cannot deactivate your own account');
    }
    const existing = await supabase.from('users').select('id').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('User not found');
    const { data, error } = await supabase.from('users').update({ is_active: false }).eq('id', req.params.id).select('id, role').single();
    if (error) throw error;
    await supabase.auth.admin.deleteUser(req.params.id).catch(() => {});
    await logAudit({ user_id: req.user.id, action: 'user_deactivated', entity_type: 'users', entity_id: req.params.id, ip: req.ip });
    return ok(res, data, 'User deactivated');
  } catch (err) {
    return next(fromDbError(err));
  }
});

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------
export const auditRouter = Router();
auditRouter.use(authenticate);

auditRouter.get('/', requireRoles('admin', 'hod'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('audit_logs').select('*, user:users(id, role)', { count: 'exact' }).order('created_at', { ascending: false });
    if (req.query.action) qb = qb.eq('action', req.query.action);
    if (req.query.status) qb = qb.eq('new_status', req.query.status);
    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const total = count || 0;
    return ok(res, data || [], 'Listed audit logs', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});