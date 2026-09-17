import { z } from 'zod';
import { supabase } from '../supabase.js';
import { validateBody, uuidSchema, emailSchema } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { logAudit } from '../services/audit.js';
import { authenticate } from '../middleware/auth.js';
import { Router } from 'express';

export const authRouter = Router();

const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().trim().min(1, 'Name is required').max(200),
  role: z.enum(['admin', 'hod', 'faculty']),
  department_id: uuidSchema.nullable().optional(),
  faculty_id: uuidSchema.nullable().optional(),
});

async function countUsers() {
  const { count, error } = await supabase.from('users').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

/**
 * POST /api/v1/auth/register
 * Creates a Supabase Auth user + role row.
 * Bootstrap: allowed without auth when the users table is empty (creates the first admin).
 * Otherwise admin-only.
 */
authRouter.post('/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    const userCount = await countUsers();

    let actingUser = null;
    if (userCount > 0) {
      // Require an authenticated admin.
      await new Promise((resolve) => authenticate(req, res, (err) => (err ? resolve(err) : resolve())));
      if (!req.user) return next(Object.assign(new Error('Admin authentication required'), { code: 'FORBIDDEN', status: 403 }));
      if (req.user.role !== 'admin') {
        return next(Object.assign(new Error('Only admins can create users'), { code: 'FORBIDDEN', status: 403 }));
      }
      actingUser = req.user;
    }

    const { email, password, name, role, department_id, faculty_id } = req.body;

    // Validate scoping references
    if (role === 'faculty' && !faculty_id) {
      return next(Object.assign(new Error('faculty_id is required for faculty role'), { code: 'VALIDATION_ERROR', status: 400 }));
    }
    if (role === 'hod' && !department_id) {
      return next(Object.assign(new Error('department_id is required for hod role'), { code: 'VALIDATION_ERROR', status: 400 }));
    }

    if (role === 'faculty') {
      const { data: fac, error: fe } = await supabase.from('faculty').select('*').eq('id', faculty_id).maybeSingle();
      if (fe || !fac) {
        return next(Object.assign(new Error('Linked faculty record does not exist'), { code: 'UNPROCESSABLE_ENTITY', status: 422 }));
      }
      if (fac.email !== email) {
        return next(Object.assign(new Error('Email must match the linked faculty email'), { code: 'VALIDATION_ERROR', status: 400 }));
      }
    }

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (createError) {
      if (/already registered/i.test(createError.message)) {
        return next(Object.assign(new Error('A user with this email already exists'), { code: 'CONFLICT', status: 409 }));
      }
      return next(createError);
    }

    let deptId = department_id || null;
    let facId = faculty_id || null;
    if (role === 'faculty' && facId) {
      const { data: fac } = await supabase.from('faculty').select('department_id').eq('id', facId).single();
      deptId = fac?.department_id ?? null;
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .insert({ id: created.user.id, role, department_id: deptId, faculty_id: facId })
      .select()
      .single();
    if (profileError) {
      // cleanup auth user on profile insert failure
      await supabase.auth.admin.deleteUser(created.user.id).catch(() => {});
      throw profileError;
    }

    await logAudit({
      user_id: actingUser?.id || profile.id,
      action: 'user_created',
      entity_type: 'users',
      entity_id: profile.id,
      metadata: { role },
      ip: req.ip,
    });

    return ok(res, { user: { id: profile.id, email, role, ...profile } }, 'User created successfully');
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/v1/auth/me
 */
authRouter.get('/me', authenticate, async (req, res, next) => {
  try {
    const { data: settings } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();

    let department = null;
    if (req.user.department_id) {
      const { data: d } = await supabase.from('departments').select('id, code, name').eq('id', req.user.department_id).maybeSingle();
      department = d;
    }
    let faculty = null;
    if (req.user.faculty_id) {
      const { data: f } = await supabase.from('faculty').select('*').eq('id', req.user.faculty_id).maybeSingle();
      faculty = f;
    }
    return ok(res, { ...req.user, department, faculty, settings });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/v1/auth/refresh  { refresh_token }
 */
authRouter.post('/refresh', validateBody(z.object({ refresh_token: z.string().min(1) })), async (req, res, next) => {
  try {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: req.body.refresh_token });
    if (error || !data.session) {
      return next(Object.assign(new Error('Invalid refresh token'), { code: 'UNAUTHORIZED', status: 401 }));
    }
    return ok(res, { access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  } catch (err) {
    return next(err);
  }
});