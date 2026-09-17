import { supabase } from '../supabase.js';
import { AppError, notFound } from '../utils/errors.js';

const LAB_ROOM_TYPES = ['laboratory', 'workshop'];

/**
 * Validates a timetable against all hard constraints.
 * Returns { valid, conflicts } where conflicts is an array of descriptors.
 */
export async function validateTimetable(timetableId) {
  const { data: tt } = await supabase
    .from('timetable')
    .select('id, academic_year_id, semester_id, course_id, status')
    .eq('id', timetableId)
    .maybeSingle();
  if (!tt) throw notFound('Timetable not found');

  const { data: entries } = await supabase
    .from('timetable_entries')
    .select(
      `id, facility:faculty_subjects!inner(
        faculty_id, subject_id, division_id,
        faculty:faculty(id, maximum_weekly_load, is_active),
        subject:subjects(is_active, is_lab, lecture_hours, tutorial_hours, practical_hours)
      ),
      division:divisions(id, strength, is_active),
      room:rooms(id, room_type, capacity, is_available, is_active),
      time_slot:time_slots(id, working_day_id, is_break, is_active, start_time, end_time, working_day:working_days(id, is_active))
      `
    )
    .eq('timetable_id', timetableId);

  const rows = entries || [];
  const conflicts = [];
  const seenFaculty = new Map();
  const seenDivision = new Map();
  const seenRoom = new Map();
  const facultyHours = new Map();
  const subjectHours = new Map(); // division:subject -> {scheduled, required}

  const push = (type, meta) => conflicts.push({ type, ...meta });

  for (const e of rows) {
    const subject = e.facility?.subject;
    const faculty = e.facility?.faculty;
    const division = e.division;
    const room = e.room;
    const slot = e.time_slot;

    if (!faculty?.is_active) push('INACTIVE_FACULTY', { entry_id: e.id, faculty_id: e.facility?.faculty_id });
    if (!subject?.is_active) push('INACTIVE_SUBJECT', { entry_id: e.id, subject_id: e.facility?.subject_id });
    if (!division?.is_active) push('INACTIVE_DIVISION', { entry_id: e.id, division_id: e.division_id });
    if (!room?.is_active || !room?.is_available) push('UNAVAILABLE_ROOM', { entry_id: e.id, room_id: e.room_id });
    if (slot?.is_break || !slot?.is_active || !slot?.working_day?.is_active) {
      push('INVALID_TIME_SLOT', { entry_id: e.id, time_slot_id: e.time_slot_id });
    }

    if (room && division && room.capacity < division.strength) {
      push('INSUFFICIENT_ROOM_CAPACITY', { entry_id: e.id, room_id: room.id, capacity: room.capacity, strength: division.strength });
    }

    if (e.session_type === 'practical' && (!room || !LAB_ROOM_TYPES.includes(room.room_type))) {
      push('PRACTICAL_NOT_LAB', { entry_id: e.id, room_id: room?.id, room_type: room?.room_type });
    }
    if (e.session_type !== 'practical' && room && LAB_ROOM_TYPES.includes(room.room_type)) {
      push('LECTURE_IN_LAB', { entry_id: e.id, room_id: room.id });
    }

    // Overlaps
    const slotId = e.time_slot_id;
    const fKey = `${e.facility?.faculty_id}:${slotId}`;
    const dKey = `${e.division_id}:${slotId}`;
    const rKey = `${e.room_id}:${slotId}`;
    if (seenFaculty.has(fKey)) push('FACULTY_OVERLAP', { entry_id: e.id, faculty_id: e.facility?.faculty_id, time_slot_id: slotId });
    else seenFaculty.set(fKey, true);
    if (seenDivision.has(dKey)) push('DIVISION_OVERLAP', { entry_id: e.id, division_id: e.division_id, time_slot_id: slotId });
    else seenDivision.set(dKey, true);
    if (seenRoom.has(rKey)) push('ROOM_OVERLAP', { entry_id: e.id, room_id: e.room_id, time_slot_id: slotId });
    else seenRoom.set(rKey, true);

    // Load (hours)
    if (slot && faculty) {
      const [h1, m1] = slot.start_time.split(':').map(Number);
      const [h2, m2] = slot.end_time.split(':').map(Number);
      const hr = (h2 * 60 + m2 - (h1 * 60 + m1)) / 60;
      facultyHours.set(e.facility.faculty_id, (facultyHours.get(e.facility.faculty_id) || 0) + hr);
    }

    // Required subject hours
    const key = `${e.division_id}:${e.facility.subject_id}`;
    if (!subjectHours.has(key)) {
      subjectHours.set(key, {
        required: Number(subject?.lecture_hours || 0) + Number(subject?.tutorial_hours || 0) + Number(subject?.practical_hours || 0),
        scheduled: 0,
      });
    }
    subjectHours.get(key).scheduled += 1;
    void tt;
  }

  for (const [k, v] of subjectHours) {
    if (v.scheduled !== v.required && v.required >= 0) {
      const [division_id, subject_id] = k.split(':');
      push('SUBJECT_HOURS_UNMET', { division_id, subject_id, required: v.required, scheduled: v.scheduled });
    }
  }

  // Faculty load vs max
  const faculties = rows.map((e) => ({ id: e.facility?.faculty_id, max: e.facility?.faculty?.maximum_weekly_load }));
  const seenLoad = new Set();
  for (const f of faculties) {
    if (!f.id || seenLoad.has(f.id)) continue;
    seenLoad.add(f.id);
    const used = facultyHours.get(f.id) || 0;
    if (Number(f.max) > 0 && used > Number(f.max)) {
      push('FACULTY_LOAD_EXCEEDED', { faculty_id: f.id, used, maximum: f.max });
    }
  }

  return { valid: conflicts.length === 0, conflicts };
}