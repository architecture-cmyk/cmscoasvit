import { z } from 'zod';
import { Router } from 'express';
import { supabase } from '../supabase.js';
import { validateBody, validateQuery, uuidSchema, paginationQuery, timeSchema } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { parsePagination } from '../utils/response.js';
import { notFound, conflict, unprocessable } from '../utils/errors.js';
import { fromDbError } from '../utils/errors.js';
import { applyScope } from '../services/scope.js';
import { logAudit } from '../services/audit.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, requireRoles } from '../middleware/rbac.js';

// ---------------------------------------------------------------------------
// Working days
// ---------------------------------------------------------------------------
export const workingDayRouter = Router();
workingDayRouter.use(authenticate);

const daySchema = z.object({
  name: z.string().trim().min(1, 'Required').max(50),
  day_number: z.coerce.number().int('Must be an integer').min(1).max(7),
  is_active: z.boolean().optional(),
});

workingDayRouter.get('/', requireRoles('admin', 'hod', 'faculty'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('working_days').select('*', { count: 'exact' }).order('day_number');
    qb = await applyScope(qb, req.user, 'working_days');
    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const total = count || 0;
    return ok(res, data || [], 'Listed working days', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});

workingDayRouter.post('/', requireAdmin, validateBody(daySchema), async (req, res, next) => {
  try {
    const dup = await supabase.from('working_days').select('id').or(`name.eq.${req.body.name},day_number.eq.${req.body.day_number}`).maybeSingle();
    if (dup.data) throw conflict('Working day name or order already exists');
    const { data, error } = await supabase.from('working_days').insert({ ...req.body, is_active: req.body.is_active ?? true }).select().single();
    if (error) throw error;
    return created(res, data, 'Working day created');
  } catch (err) {
    return next(fromDbError(err));
  }
});

workingDayRouter.patch('/:id', requireAdmin, validateBody(daySchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' })), async (req, res, next) => {
  try {
    const existing = await supabase.from('working_days').select('*').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('Working day not found');
    const { data, error } = await supabase.from('working_days').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    if (req.body.is_active === false) {
      const { error: te } = await supabase.from('time_slots').update({ is_active: false }).eq('working_day_id', req.params.id);
      if (te) throw te;
    }
    return ok(res, data, 'Working day updated');
  } catch (err) {
    return next(fromDbError(err));
  }
});

workingDayRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { count: slots } = await supabase.from('time_slots').select('id', { count: 'exact', head: true }).eq('working_day_id', req.params.id);
    if ((slots || 0) > 0) {
      await supabase.from('working_days').update({ is_active: false }).eq('id', req.params.id);
      return ok(res, { id: req.params.id, is_active: false }, 'Working day has time slots; deactivated instead of deleted');
    }
    const { data: existing } = await supabase.from('working_days').select('id').eq('id', req.params.id).maybeSingle();
    if (!existing) throw notFound('Working day not found');
    await supabase.from('working_days').delete().eq('id', req.params.id);
    return ok(res, { id: req.params.id }, 'Working day deleted');
  } catch (err) {
    return next(fromDbError(err));
  }
});

// ---------------------------------------------------------------------------
// Time slots
// ---------------------------------------------------------------------------
export const timeSlotRouter = Router();
timeSlotRouter.use(authenticate);

const slotSchema = z.object({
  working_day_id: uuidSchema,
  period_number: z.coerce.number().int('Must be an integer').min(1),
  start_time: timeSchema,
  end_time: timeSchema,
  is_break: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

timeSlotRouter.get('/', requireRoles('admin', 'hod', 'faculty'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('time_slots').select('*, working_day:working_days(id, name, day_number)', { count: 'exact' }).order('period_number');
    qb = await applyScope(qb, req.user, 'time_slots');
    if (req.query.working_day_id) qb = qb.eq('working_day_id', req.query.working_day_id);
    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const total = count || 0;
    return ok(res, data || [], 'Listed time slots', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});

// Convenience: full weekly grid grouped by day (used by admin timing settings)
timeSlotRouter.get('/grid', requireRoles('admin', 'hod', 'faculty'), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('time_slots')
      .select('*, working_day:working_days(id, name, day_number)')
      .order('period_number');
    if (error) throw error;
    const days = await supabase.from('working_days').select('*').order('day_number');
    const grouped = (days.data || []).map((d) => ({
      ...d,
      slots: (data || []).filter((s) => s.working_day_id === d.id),
    }));
    return ok(res, grouped, 'Time slot grid');
  } catch (err) {
    return next(fromDbError(err));
  }
});

timeSlotRouter.post('/', requireAdmin, validateBody(slotSchema), async (req, res, next) => {
  try {
    if (req.body.end_time <= req.body.start_time) {
      throw unprocessable('end_time must be later than start_time');
    }
    const dup = await supabase.from('time_slots').select('id').eq('working_day_id', req.body.working_day_id).eq('period_number', req.body.period_number).maybeSingle();
    if (dup.data) throw conflict('A time slot already exists for this period on this day');
    const { data, error } = await supabase.from('time_slots').insert({ ...req.body, is_break: req.body.is_break ?? false, is_active: req.body.is_active ?? true }).select().single();
    if (error) throw error;
    return created(res, data, 'Time slot created');
  } catch (err) {
    return next(fromDbError(err));
  }
});

const slotPatch = slotSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' });
timeSlotRouter.patch('/:id', requireAdmin, validateBody(slotPatch), async (req, res, next) => {
  try {
    const existing = await supabase.from('time_slots').select('*').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('Time slot not found');
    if ((req.body.start_time && req.body.end_time && req.body.end_time <= req.body.start_time) ||
        (req.body.end_time && existing.data.start_time && req.body.end_time <= existing.data.start_time)) {
      throw unprocessable('end_time must be later than start_time');
    }
    const { data, error } = await supabase.from('time_slots').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    // Disabled slots cannot be used by new generations (validated by the generator).
    return ok(res, data, 'Time slot updated');
  } catch (err) {
    return next(fromDbError(err));
  }
});

timeSlotRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { count: entries } = await supabase.from('timetable_entries').select('id', { count: 'exact', head: true }).eq('time_slot_id', req.params.id);
    if ((entries || 0) > 0) {
      await supabase.from('time_slots').update({ is_active: false }).eq('id', req.params.id);
      return ok(res, { id: req.params.id, is_active: false }, 'Time slot is used by timetables; deactivated instead of deleted');
    }
    const { data: existing } = await supabase.from('time_slots').select('id').eq('id', req.params.id).maybeSingle();
    if (!existing) throw notFound('Time slot not found');
    const { error } = await supabase.from('time_slots').delete().eq('id', req.params.id);
    if (error) throw error;
    return ok(res, { id: req.params.id }, 'Time slot deleted');
  } catch (err) {
    return next(fromDbError(err));
  }
});

// ---------------------------------------------------------------------------
// Settings (institution / timing)
// ---------------------------------------------------------------------------
export const settingsRouter = Router();
settingsRouter.use(authenticate);

const settingsSchema = z.object({
  institution_name: z.string().trim().min(1, 'Required').max(200).optional(),
  address: z.string().trim().max(500).nullable().optional(),
  punch_in_time: timeSchema.optional(),
  punch_out_time: timeSchema.optional(),
  recess_start: timeSchema.optional(),
  recess_end: timeSchema.optional(),
});

settingsRouter.get('/', requireRoles('admin', 'hod', 'faculty'), async (_req, res, next) => {
  try {
    const { data, error } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    return ok(res, data);
  } catch (err) {
    return next(fromDbError(err));
  }
});

settingsRouter.patch('/', requireAdmin, validateBody(settingsSchema), async (req, res, next) => {
  try {
    if (req.body.recess_start && req.body.recess_end && req.body.recess_end <= req.body.recess_start) {
      throw unprocessable('Recess end must be later than recess start');
    }
    const { data, error } = await supabase.from('settings').update(req.body).eq('id', 1).select().single();
    if (error) throw error;
    await logAudit({ user_id: req.user.id, action: 'settings_updated', entity_type: 'settings', entity_id: '1', metadata: { changes: req.body }, ip: req.ip });
    return ok(res, data, 'Settings updated');
  } catch (err) {
    return next(fromDbError(err));
  }
});