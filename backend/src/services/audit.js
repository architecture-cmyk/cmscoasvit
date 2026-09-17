import { supabase } from '../supabase.js';

// Append an audit log entry. Never throws (logging must not break a request).
export async function logAudit({
  user_id = null,
  action,
  entity_type,
  entity_id = null,
  previous_status = null,
  new_status = null,
  comment = null,
  metadata = null,
  ip = null,
}) {
  try {
    await supabase.from('audit_logs').insert({
      user_id,
      action,
      entity_type,
      entity_id,
      previous_status,
      new_status,
      comment,
      metadata,
      ip,
    });
  } catch (err) {
    console.error('audit log insert failed:', err.message);
  }
}

// Convenience for timetable workflow actions (also fires DB trigger for status changes).
export async function logTimetableAction(user, timetable, action, comment = null) {
  return logAudit({
    user_id: user?.id || null,
    action,
    entity_type: 'timetable',
    entity_id: timetable.id,
    previous_status: timetable.previous_status ?? null,
    new_status: timetable.status,
    comment,
    ip: user?.ip ?? null,
  });
}