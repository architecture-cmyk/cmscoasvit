import { z } from 'zod';
import { Router } from 'express';
import { supabase } from '../supabase.js';
import { validateBody, validateQuery, uuidSchema, nameSchema, paginationQuery, optionalUuid } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { parsePagination } from '../utils/response.js';
import { notFound, conflict, unprocessable } from '../utils/errors.js';
import { fromDbError } from '../utils/errors.js';
import { applyScope } from '../services/scope.js';
import { logAudit } from '../services/audit.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, requireRoles } from '../middleware/rbac.js';

export const roomRouter = Router();
roomRouter.use(authenticate);

const roomSchema = z.object({
  room_number: nameSchema,
  room_name: nameSchema,
  room_type: z.enum(['classroom', 'laboratory', 'seminar_hall', 'workshop', 'other']),
  capacity: z.coerce.number().int('Must be an integer').min(1, 'Capacity must be positive'),
  department_id: optionalUuid,
  is_available: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

const roomPatch = roomSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'At least one field required' });

roomRouter.get('/', requireRoles('admin', 'hod', 'faculty'), validateQuery(paginationQuery), async (req, res, next) => {
  try {
    const { page, perPage, from } = parsePagination(req.query);
    let qb = supabase.from('rooms').select('*, department:departments(code, name)', { count: 'exact' }).order('room_number');
    qb = await applyScope(qb, req.user, 'rooms');
    if (req.query.department_id) qb = qb.eq('department_id', req.query.department_id);
    if (req.query.is_active) qb = qb.eq('is_active', req.query.is_active === 'true');
    if (req.query.q) qb = qb.or(`room_number.ilike.%${req.query.q}%,room_name.ilike.%${req.query.q}%`);
    if (req.query.room_type) qb = qb.eq('room_type', req.query.room_type);
    const { data, count, error } = await qb.range(from, from + perPage - 1);
    if (error) throw error;
    const total = count || 0;
    return ok(res, data || [], 'Listed rooms', {
      pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
    });
  } catch (err) {
    return next(fromDbError(err));
  }
});

roomRouter.get('/:id', requireRoles('admin', 'hod', 'faculty'), async (req, res, next) => {
  try {
    const qb = await applyScope(supabase.from('rooms').select('*, department:departments(code, name)').eq('id', req.params.id), req.user, 'rooms');
    const { data, error } = await qb.maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Room not found');
    return ok(res, data);
  } catch (err) {
    return next(fromDbError(err));
  }
});

roomRouter.post('/', requireAdmin, validateBody(roomSchema), async (req, res, next) => {
  try {
    const dup = await supabase.from('rooms').select('id').eq('room_number', req.body.room_number).maybeSingle();
    if (dup.data) throw conflict('Room number already exists');
    const { data, error } = await supabase.from('rooms').insert({ ...req.body, is_available: req.body.is_available ?? true, is_active: req.body.is_active ?? true }).select().single();
    if (error) throw error;
    await logAudit({ user_id: req.user.id, action: 'room_created', entity_type: 'rooms', entity_id: data.id, metadata: { room_number: data.room_number }, ip: req.ip });
    return created(res, data, 'Room created');
  } catch (err) {
    return next(fromDbError(err));
  }
});

roomRouter.patch('/:id', requireAdmin, validateBody(roomPatch), async (req, res, next) => {
  try {
    const existing = await supabase.from('rooms').select('*').eq('id', req.params.id).maybeSingle();
    if (!existing.data) throw notFound('Room not found');
    if (req.body.room_number && req.body.room_number !== existing.data.room_number) {
      const dup = await supabase.from('rooms').select('id').eq('room_number', req.body.room_number).neq('id', req.params.id).maybeSingle();
      if (dup.data) throw conflict('Room number already exists');
    }
    // Unavailable room cannot be used by new timetable entries (enforced at generation).
    const { data, error } = await supabase.from('rooms').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    await logAudit({ user_id: req.user.id, action: 'room_updated', entity_type: 'rooms', entity_id: req.params.id, metadata: { changes: req.body }, ip: req.ip });
    return ok(res, data, 'Room updated');
  } catch (err) {
    return next(fromDbError(err));
  }
});

roomRouter.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { count: entries } = await supabase.from('timetable_entries').select('id', { count: 'exact', head: true }).eq('room_id', req.params.id);
    if ((entries || 0) > 0) {
      await supabase.from('rooms').update({ is_active: false, is_available: false }).eq('id', req.params.id);
      return ok(res, { id: req.params.id, is_active: false }, 'Room is used by timetables; deactivated instead of deleted');
    }
    const { data: existing } = await supabase.from('rooms').select('id').eq('id', req.params.id).maybeSingle();
    if (!existing) throw notFound('Room not found');
    const { error } = await supabase.from('rooms').delete().eq('id', req.params.id);
    if (error) throw error;
    return ok(res, { id: req.params.id }, 'Room deleted');
  } catch (err) {
    return next(fromDbError(err));
  }
});