import { get } from 'svelte/store';
import { supabase } from './supabaseClient';
import { session, user } from './stores';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';

const LAB_ROOM_TYPES = ['laboratory', 'workshop'];

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------
export class AppError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

function fromSupabase(e) {
  if (!e) return e;
  if (e.code === '23505') {
    return new AppError(409, e.message || 'Duplicate record');
  }
  if (e.code === '23503') return new AppError(422, e.message || 'Record is referenced by other data');
  if (e.code === '23514') return new AppError(422, e.message || 'Data does not satisfy constraints');
  if (e.message === 'TIMETABLE_CONFLICT') {
    let conflicts = [];
    try {
      const parsed = JSON.parse(e.details || '[]');
      conflicts = Array.isArray(parsed) ? parsed : parsed.errors || [];
    } catch {
      /* ignore */
    }
    return new AppError(409, 'Timetable contains unresolved conflicts', { conflicts });
  }
  return new AppError(500, e.message || 'Request failed');
}

function throwOnError({ error }) {
  if (error) throw fromSupabase(error);
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export async function refreshProfile() {
  const s = get(session);
  if (!s?.user?.id) return null;

  const { data: profile, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', s.user.id)
    .maybeSingle();
  if (error || !profile) return null;

  const [settings, department, faculty] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
    profile.department_id
      ? supabase.from('departments').select('id, code, name').eq('id', profile.department_id).maybeSingle()
      : Promise.resolve({ data: null }),
    profile.faculty_id
      ? supabase.from('faculty').select('*').eq('id', profile.faculty_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    ...profile,
    settings: settings?.data || null,
    department: department?.data || null,
    faculty: faculty?.data || null,
  };
}

// ---------------------------------------------------------------------------
// Academic years
// ---------------------------------------------------------------------------
export async function listAcademicYears() {
  const { data, error } = await supabase
    .from('academic_years')
    .select('*')
    .order('name', { ascending: false });
  throwOnError({ error });
  return data || [];
}

export async function createAcademicYear(body) {
  const { error } = await supabase
    .from('academic_years')
    .insert({ ...body, is_active: body.is_active ?? false });
  throwOnError({ error });
}

export async function updateAcademicYear(id, body) {
  const { error } = await supabase.from('academic_years').update(body).eq('id', id);
  throwOnError({ error });
}

export async function deleteAcademicYear(id) {
  const { count: divisions } = await supabase
    .from('divisions')
    .select('id', { count: 'exact', head: true })
    .eq('academic_year_id', id);
  const { count: timetables } = await supabase
    .from('timetable')
    .select('id', { count: 'exact', head: true })
    .eq('academic_year_id', id);
  throwOnError({ error: divisions === null ? { message: 'Failed to check divisions' } : null });

  if ((divisions || 0) > 0 || (timetables || 0) > 0) {
    const { error } = await supabase.from('academic_years').update({ is_active: false }).eq('id', id);
    throwOnError({ error });
    return { id, is_active: false };
  }
  const { data, error } = await supabase.from('academic_years').delete().eq('id', id).select('id').maybeSingle();
  throwOnError({ error });
  return data;
}

// ---------------------------------------------------------------------------
// Options (select dropdowns)
// ---------------------------------------------------------------------------
export async function listOptions() {
  const [y, s, c, d, wd, ts] = await Promise.all([
    supabase.from('academic_years').select('*').order('name', { ascending: false }),
    supabase.from('semesters').select('*').order('name'),
    supabase.from('courses').select('*').order('name'),
    supabase.from('divisions').select('*').order('name'),
    supabase.from('working_days').select('*').order('day_number'),
    supabase.from('time_slots').select('*').order('period_number'),
  ]);
  throwOnError({ error: y.error || s.error || c.error || d.error || wd.error || ts.error });
  return {
    years: y.data || [],
    semesters: s.data || [],
    courses: c.data || [],
    divisions: d.data || [],
    workingDays: wd.data || [],
    timeSlots: ts.data || [],
  };
}

// ---------------------------------------------------------------------------
// Timetables (list / detail / entries)
// ---------------------------------------------------------------------------
const ttListSelect =
  '*, academic_year:academic_years(name), semester:semesters(name), course:courses(name), generated_by_user:users!generated_by(id, role), entries:timetable_entries(count)';

function normalizeEntryCount(timetables) {
  return (timetables || []).map((d) => ({
    ...d,
    entry_count: Array.isArray(d.entries) && d.entries[0] ? Number(d.entries[0].count) : 0,
  }));
}

export async function listTimetables(filters = {}) {
  let qb = supabase.from('timetable').select(ttListSelect).order('created_at', { ascending: false });
  if (filters.academic_year_id) qb = qb.eq('academic_year_id', filters.academic_year_id);
  if (filters.course_id) qb = qb.eq('course_id', filters.course_id);
  if (filters.semester_id) qb = qb.eq('semester_id', filters.semester_id);
  if (filters.status) qb = qb.eq('status', filters.status);
  const { data, error } = await qb;
  throwOnError({ error });
  return normalizeEntryCount(data);
}

export async function getTimetable(id) {
  const { data, error } = await supabase
    .from('timetable')
    .select(
      '*, academic_year:academic_years(name), semester:semesters(name), course:courses(name, department_id), entries:timetable_entries(count)'
    )
    .eq('id', id)
    .maybeSingle();
  throwOnError({ error });
  if (!data) throw new AppError(404, 'Timetable not found');
  data.entry_count = Array.isArray(data.entries) && data.entries[0] ? Number(data.entries[0].count) : 0;
  return data;
}

const ttEntriesSelect = `*,
  division:divisions(name),
  room:rooms(room_number, room_name, room_type),
  time_slot:time_slots(period_number, start_time, end_time, is_break, working_day:working_days(name, day_number)),
  faculty:faculty_subjects!inner(faculty_id, subject_id, faculty:faculty(id, name, employee_id), subject:subjects(code, name, is_lab))`;

export async function listTimetableEntries(id) {
  const { data, error } = await supabase
    .from('timetable_entries')
    .select(ttEntriesSelect)
    .eq('timetable_id', id);
  throwOnError({ error });
  return (data || []).sort((a, b) => {
    const d = (a.time_slot?.working_day?.day_number || 0) - (b.time_slot?.working_day?.day_number || 0);
    if (d !== 0) return d;
    return (a.time_slot?.period_number || 0) - (b.time_slot?.period_number || 0);
  });
}

export async function deleteTimetable(id) {
  const tt = await getTimetable(id);
  if (tt.status === 'published') {
    throw new AppError(409, 'Published timetables are immutable. Unpublish it before deleting.');
  }
  const { error } = await supabase.from('timetable').delete().eq('id', id);
  throwOnError({ error });
}

// ---------------------------------------------------------------------------
// Timetable state transitions (was backend guardedTransition)
// ---------------------------------------------------------------------------
const TRANSITIONS = {
  submit: { from: 'draft', to: 'pending_approval', allowed: ['admin'] },
  reject: { from: 'pending_approval', to: 'draft', allowed: ['admin', 'hod'] },
  approve: { from: 'pending_approval', to: 'approved', allowed: ['admin', 'hod'] },
  publish: { from: 'approved', to: 'published', allowed: ['admin'] },
  unpublish: { from: 'published', to: 'approved', allowed: ['admin'] },
  archive: { from: 'approved', to: 'archived', allowed: ['admin'] },
  'unpublish-archive': { from: 'published', to: 'archived', allowed: ['admin'] },
};

export async function transitionTimetable(id, action, comment = null) {
  const me = get(user);
  const spec = TRANSITIONS[action];
  if (!spec) throw new AppError(400, `Unknown action: ${action}`);
  if (!me || !spec.allowed.includes(me.role)) {
    throw new AppError(403, 'You do not have permission for this action');
  }

  const tt = await getTimetable(id);
  if (me.role === 'hod' && !deptScopeMatches(me, tt.course?.department_id)) {
    throw new AppError(403, 'You do not have access to this timetable');
  }
  if (tt.status !== spec.from) {
    throw new AppError(409, `Timetable must be "${spec.from}" to perform this action (current: ${tt.status})`);
  }

  if (spec.to === 'approved') {
    const result = await validateTimetable(id);
    if (!result.valid) {
      const err = new AppError(409, 'Timetable contains unresolved conflicts');
      err.conflicts = result.conflicts;
      throw err;
    }
  }

  const payload = { status: spec.to, previous_status: spec.from };
  if (spec.to === 'pending_approval') {
    payload.submitted_at = new Date().toISOString();
    payload.submitted_by = me.id;
  } else if (spec.to === 'approved') {
    payload.approved_at = new Date().toISOString();
    payload.approved_by = me.id;
    payload.rejected_at = null;
    payload.rejection_comment = null;
  } else if (spec.to === 'published') {
    payload.published_at = new Date().toISOString();
    payload.published_by = me.id;
  } else if (spec.to === 'draft' && spec.from === 'pending_approval') {
    payload.rejected_at = new Date().toISOString();
    payload.rejection_comment = comment;
  } else if (spec.to === 'archived') {
    payload.archived_at = new Date().toISOString();
  }

  const { data, error } = await supabase.from('timetable').update(payload).eq('id', id).select().single();
  throwOnError({ error });
  return data;
}

function deptScopeMatches(me, departmentId) {
  if (me.role === 'admin') return true;
  return me.department_id === departmentId;
}

// ---------------------------------------------------------------------------
// Validator (was backend timetableValidator)
// ---------------------------------------------------------------------------
export async function validateTimetable(timetableId) {
  const { data: entries, error } = await supabase
    .from('timetable_entries')
    .select(
      `id, session_type, division_id, room_id, time_slot_id,
       facility:faculty_subjects!inner(
         faculty_id, subject_id,
         faculty:faculty(id, maximum_weekly_load, is_active),
         subject:subjects(is_active, is_lab, lecture_hours, tutorial_hours, practical_hours)
       ),
       division:divisions(id, strength, is_active),
       room:rooms(id, room_type, capacity, is_available, is_active),
       time_slot:time_slots(id, working_day_id, is_break, is_active, start_time, end_time, working_day:working_days(id, is_active))`
    )
    .eq('timetable_id', timetableId);
  throwOnError({ error });

  const rows = entries || [];
  const conflicts = [];
  const seenFaculty = new Map();
  const seenDivision = new Map();
  const seenRoom = new Map();
  const facultyHours = new Map();
  const subjectHours = new Map();

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

    if (slot && faculty) {
      const [h1, m1] = slot.start_time.split(':').map(Number);
      const [h2, m2] = slot.end_time.split(':').map(Number);
      const hr = (h2 * 60 + m2 - (h1 * 60 + m1)) / 60;
      facultyHours.set(e.facility.faculty_id, (facultyHours.get(e.facility.faculty_id) || 0) + hr);
    }

    const key = `${e.division_id}:${e.facility.subject_id}`;
    if (!subjectHours.has(key)) {
      subjectHours.set(key, {
        required:
          Number(subject?.lecture_hours || 0) +
          Number(subject?.tutorial_hours || 0) +
          Number(subject?.practical_hours || 0),
        scheduled: 0,
      });
    }
    subjectHours.get(key).scheduled += 1;
  }

  for (const [k, v] of subjectHours) {
    if (v.scheduled !== v.required && v.required >= 0) {
      const [division_id, subject_id] = k.split(':');
      push('SUBJECT_HOURS_UNMET', { division_id, subject_id, required: v.required, scheduled: v.scheduled });
    }
  }

  const seenLoad = new Set();
  for (const e of rows) {
    const id = e.facility?.faculty_id;
    if (!id || seenLoad.has(id)) continue;
    seenLoad.add(id);
    const used = facultyHours.get(id) || 0;
    const max = Number(e.facility?.faculty?.maximum_weekly_load || 0);
    if (max > 0 && used > max) {
      push('FACULTY_LOAD_EXCEEDED', { faculty_id: id, used, maximum: max });
    }
  }

  return { valid: conflicts.length === 0, conflicts };
}

// ---------------------------------------------------------------------------
// Generator (was backend timetableGenerator)
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function durationHours(slot) {
  const [h1, m1] = slot.start_time.split(':').map(Number);
  const [h2, m2] = slot.end_time.split(':').map(Number);
  return Math.max(0.25, Math.round(((h2 * 60 + m2 - (h1 * 60 + m1)) / 60) * 100) / 100);
}

export async function generateTimetable({
  academic_year_id,
  semester_id,
  course_id,
  division_ids,
  working_day_ids,
  time_slot_ids,
  replace_existing_draft = false,
  seed = null,
}) {
  const me = get(user);
  if (!academic_year_id || !semester_id || !course_id || !division_ids?.length) {
    throw new AppError(422, 'academic_year_id, semester_id, course_id and division_ids are required');
  }
  if (!me) throw new AppError(401, 'Not authenticated');

  // 1. Only active academic year
  const { data: year } = await supabase.from('academic_years').select('id, is_active').eq('id', academic_year_id).maybeSingle();
  if (!year) throw new AppError(404, 'Academic year not found');
  if (!year.is_active) throw new AppError(422, 'Generation is only allowed for an active academic year');

  const periodFilter = { academic_year_id, semester_id, course_id };

  // 2. Handle existing timetables
  const { data: nonDraft } = await supabase
    .from('timetable')
    .select('id, status')
    .match(periodFilter)
    .in('status', ['pending_approval', 'approved', 'published'])
    .maybeSingle();
  if (nonDraft && replace_existing_draft) {
    throw new AppError(409, `Cannot replace the ${nonDraft.status} timetable. Unpublish it or create a new revision.`);
  }
  if (replace_existing_draft) {
    const { data: drafts } = await supabase.from('timetable').select('id').match(periodFilter).eq('status', 'draft');
    for (const d of drafts || []) {
      await supabase.from('timetable').delete().eq('id', d.id);
    }
  }

  // 3. Divisions
  const { data: divisions } = await supabase
    .from('divisions')
    .select('id, name, strength, is_active, course_id, semester_id, academic_year_id')
    .in('id', division_ids)
    .eq('course_id', course_id)
    .eq('semester_id', semester_id)
    .eq('academic_year_id', academic_year_id)
    .eq('is_active', true);
  if (!divisions || divisions.length === 0) {
    throw new AppError(422, 'No active divisions match the requested course/semester/academic year');
  }
  const divisionMap = new Map(divisions.map((d) => [d.id, d]));

  // 4. Faculty-subject mappings
  const { data: mappings, error: mappingError } = await supabase
    .from('faculty_subjects')
    .select(
      `id, faculty_id, subject_id, division_id, is_active,
       faculty:faculty(id, name, maximum_weekly_load, is_active, employee_id),
       subject:subjects(id, code, name, lecture_hours, tutorial_hours, practical_hours, is_lab, is_active)`
    )
    .eq('academic_year_id', academic_year_id)
    .in('division_id', divisions.map((d) => d.id))
    .eq('is_active', true);
  throwOnError({ error: mappingError });

  const usableMappings = (mappings || []).filter((m) => m.faculty && m.subject && m.faculty.is_active && m.subject.is_active);
  if (usableMappings.length === 0) {
    throw new AppError(422, 'No active faculty-subject mappings found for the selected divisions');
  }

  // 5. Time slots
  const { data: rawSlots, error: slotError } = await supabase
    .from('time_slots')
    .select('id, working_day_id, period_number, start_time, end_time, is_break, is_active, working_day:working_days(id, day_number, name, is_active)')
    .in('id', time_slot_ids || []);
  throwOnError({ error: slotError });
  if (!rawSlots || rawSlots.length === 0) {
    throw new AppError(422, 'No time slots match the request');
  }

  const slots = (rawSlots || [])
    .filter((s) => working_day_ids.includes(s.working_day_id))
    .filter((s) => s.is_active && s.working_day?.is_active)
    .filter((s) => !s.is_break)
    .map((s) => ({
      slotId: s.id,
      dayId: s.working_day_id,
      dayNumber: s.working_day.day_number,
      dayName: s.working_day.name,
      periodNumber: s.period_number,
      start_time: s.start_time,
      end_time: s.end_time,
      hours: durationHours(s),
    }))
    .sort((a, b) => a.dayNumber - b.dayNumber || a.periodNumber - b.periodNumber);

  if (slots.length < 2) {
    throw new AppError(422, 'Need at least two usable (non-break, active) time slots');
  }

  // 6. Rooms
  const { data: rooms } = await supabase
    .from('rooms')
    .select('id, room_number, room_type, capacity, is_available, is_active')
    .eq('is_active', true)
    .eq('is_available', true);
  const roomPool = rooms || [];
  const labRooms = roomPool.filter((r) => LAB_ROOM_TYPES.includes(r.room_type));
  const classRooms = roomPool.filter((r) => !LAB_ROOM_TYPES.includes(r.room_type));
  if (classRooms.length === 0) throw new AppError(422, 'No available classrooms for generation');

  // 7. Build requirements
  const requirements = [];
  for (const m of usableMappings) {
    const div = divisionMap.get(m.division_id);
    const subj = m.subject;
    const lecture = Math.floor(Number(subj.lecture_hours || 0));
    const tutorial = Math.floor(Number(subj.tutorial_hours || 0));
    let practical = Number(subj.practical_hours || 0);

    const base = {
      key: `${m.id}:${m.division_id}`,
      facultySubjectId: m.id,
      facultyId: m.faculty_id,
      subjectId: subj.id,
      subjectCode: subj.code,
      subjectName: subj.name,
      divisionId: m.division_id,
      divisionName: div?.name || '',
      roomType: subj.is_lab || practical > 0 ? 'lab' : 'class',
      maxLoad: Number(m.faculty.maximum_weekly_load || 0) || Infinity,
    };

    for (let i = 0; i < lecture; i++) requirements.push({ ...base, sessionType: 'lecture', block: 1 });
    for (let i = 0; i < tutorial; i++) requirements.push({ ...base, sessionType: 'tutorial', block: 1 });
    while (practical > 0) {
      const block = practical >= 2 ? 2 : 1;
      requirements.push({ ...base, sessionType: 'practical', block });
      practical -= block;
    }
  }

  // 8. Schedule
  const rng = mulberry32(seed == null ? (Date.now() % 2147483647) : seed);

  const slotsByDay = new Map();
  for (const s of slots) {
    if (!slotsByDay.has(s.dayId)) slotsByDay.set(s.dayId, []);
    slotsByDay.get(s.dayId).push(s);
  }
  const days = [...slotsByDay.keys()];

  const facultyBusy = new Map();
  const divisionBusy = new Map();
  const roomBusy = new Map();
  const facultyHours = new Map();
  const divisionDayCount = new Map();
  const subjectDayCount = new Map();

  const assigned = [];
  const unscheduled = [];

  function pickRoomFor(slotId, pool, maxCapacityNeeded) {
    const compatible = pool.filter((r) => r.capacity >= maxCapacityNeeded);
    compatible.sort(
      (a, b) => (roomBusy.get(a.id)?.size || 0) - (roomBusy.get(b.id)?.size || 0) || a.room_number.localeCompare(b.room_number)
    );
    for (const r of compatible) {
      if (!roomBusy.get(r.id)?.has(slotId)) return r;
    }
    return null;
  }

  function windowValid(window, req) {
    for (const s of window) {
      if (divisionBusy.get(req.divisionId)?.has(s.slotId)) return false;
      if (facultyBusy.get(req.facultyId)?.has(s.slotId)) return false;
    }
    const load = (facultyHours.get(req.facultyId) || 0) + window.reduce((a, s) => a + s.hours, 0);
    if (load > req.maxLoad + 1e-9) return false;
    return true;
  }

  function suggestRooms(window, req, div) {
    const pool = req.roomType === 'lab' ? labRooms : classRooms;
    if (pool.length === 0) return null;
    const selected = [];
    for (const s of window) {
      const room = pickRoomFor(s.slotId, pool, div.strength);
      if (!room) return null;
      selected.push(room);
    }
    return selected;
  }

  function scoreWindow(window, req) {
    const dayId = window[0].dayId;
    const classesToday = divisionDayCount.get(`${req.divisionId}:${dayId}`) || 0;
    const subjToday = subjectDayCount.get(`${req.divisionId}:${req.subjectId}:${dayId}`) || 0;
    return classesToday * 3 + subjToday * 10 + rng();
  }

  const orderBy = new Map();
  for (const m of usableMappings) {
    orderBy.set(
      m.id,
      Number(m.subject.lecture_hours) + Number(m.subject.tutorial_hours) + Number(m.subject.practical_hours)
    );
  }
  const workQueue = [...requirements].sort((a, b) => {
    if (orderBy.get(b.facultySubjectId) !== orderBy.get(a.facultySubjectId)) {
      return orderBy.get(b.facultySubjectId) - orderBy.get(a.facultySubjectId);
    }
    return a.key.localeCompare(b.key);
  });

  for (const req of workQueue) {
    const div = divisionMap.get(req.divisionId);
    if (!div) {
      unscheduled.push({ ...req, reason: 'DIVISION_NOT_FOUND' });
      continue;
    }

    let windows = [];
    for (const dayId of days) {
      const daySlots = slotsByDay.get(dayId);
      for (let i = 0; i + req.block <= daySlots.length; i++) {
        const w = daySlots.slice(i, i + req.block);
        const consecutive = w.every((s, k) => k === 0 || s.periodNumber === w[k - 1].periodNumber + 1);
        if (consecutive) windows.push(w);
      }
    }

    windows = shuffle(windows, rng)
      .map((w) => ({ w, score: scoreWindow(w, req) }))
      .sort((a, b) => a.score - b.score);

    let chosen = null;
    for (const { w } of windows) {
      if (!windowValid(w, req)) continue;
      const roomsPicked = suggestRooms(w, req, div);
      if (!roomsPicked) continue;
      chosen = { w, roomsPicked };
      break;
    }

    if (!chosen) {
      unscheduled.push({
        ...req,
        reason:
          facultyHours.get(req.facultyId) >= req.maxLoad
            ? 'FACULTY_LOAD_EXCEEDED'
            : req.roomType === 'lab' && labRooms.length === 0
              ? 'NO_LABORATORY_ROOM'
              : 'NO_AVAILABLE_SLOT',
      });
      continue;
    }

    const { w, roomsPicked } = chosen;
    w.forEach((s, idx) => {
      const room = roomsPicked[idx];
      assigned.push({
        faculty_subject_id: req.facultySubjectId,
        faculty_id: req.facultyId,
        division_id: req.divisionId,
        room_id: room.id,
        time_slot_id: s.slotId,
        session_type: req.sessionType,
      });
      if (!facultyBusy.has(req.facultyId)) facultyBusy.set(req.facultyId, new Set());
      facultyBusy.get(req.facultyId).add(s.slotId);
      if (!divisionBusy.has(req.divisionId)) divisionBusy.set(req.divisionId, new Set());
      divisionBusy.get(req.divisionId).add(s.slotId);
      if (!roomBusy.has(room.id)) roomBusy.set(room.id, new Set());
      roomBusy.get(room.id).add(s.slotId);
      facultyHours.set(req.facultyId, (facultyHours.get(req.facultyId) || 0) + s.hours);
      divisionDayCount.set(`${req.divisionId}:${s.dayId}`, (divisionDayCount.get(`${req.divisionId}:${s.dayId}`) || 0) + 1);
      subjectDayCount.set(
        `${req.divisionId}:${req.subjectId}:${s.dayId}`,
        (subjectDayCount.get(`${req.divisionId}:${req.subjectId}:${s.dayId}`) || 0) + 1
      );
    });
  }

  // 9. Persist draft + entries (atomic via RPC)
  const { data: tt, error: ttError } = await supabase
    .from('timetable')
    .insert({ academic_year_id, semester_id, course_id, generated_by: me.id, status: 'draft', generated_seed: seed })
    .select()
    .single();
  throwOnError({ error: ttError });

  if (assigned.length > 0) {
    const { error: rpcError } = await supabase.rpc('insert_timetable_entries', {
      p_timetable_id: tt.id,
      p_entries: assigned,
    });
    if (rpcError) {
      await supabase.from('timetable').delete().eq('id', tt.id).catch(() => {});
      throw fromSupabase(rpcError);
    }
  }

  return {
    timetable_id: tt.id,
    status: tt.status,
    scheduled_entries: assigned.length,
    division_count: divisions.length,
    unscheduled_requirements: unscheduled.map((u) => ({
      division_id: u.divisionId,
      division_name: u.divisionName,
      subject_id: u.subjectId,
      subject_code: u.subjectCode,
      session_type: u.sessionType,
      hours_block: u.block,
      reason: u.reason,
    })),
    conflicts: [],
  };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export async function countRows(table, filters = {}) {
  let qb = supabase.from(table).select('*', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filters)) {
    if (v) qb = qb.eq(k, v);
  }
  const { count, error } = await qb;
  throwOnError({ error });
  return count || 0;
}

export async function getFacultyWorkload(facultyId) {
  const { data, error } = await supabase
    .from('faculty_workload')
    .select('*, faculty:faculty(id, name, employee_id, maximum_weekly_load, designation), academic_year:academic_years(name), semester:semesters(name)')
    .eq('faculty_id', facultyId)
    .order('computed_at', { ascending: false });
  throwOnError({ error });
  const rows = (data || []).map((r) => ({
    ...r,
    overloaded: Number(r.faculty?.maximum_weekly_load) > 0 && Number(r.total_hours) > Number(r.faculty.maximum_weekly_load),
    load_percent:
      Number(r.faculty?.maximum_weekly_load) > 0
        ? Math.round((Number(r.total_hours) / Number(r.faculty.maximum_weekly_load)) * 100)
        : null,
  }));
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Export helpers (client-side PDF / Excel)
// ---------------------------------------------------------------------------
export async function loadExportBundle(id) {
  const [tt, entries] = await Promise.all([getTimetable(id), listTimetableEntries(id)]);
  const { data: allSlots } = await supabase
    .from('time_slots')
    .select('id, period_number, start_time, end_time, working_day:working_days(name, day_number)')
    .eq('is_break', false)
    .order('period_number');
  const { data: settings } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
  return { tt, entries, allSlots: allSlots || [], institution: settings?.institution_name || 'Education Institute' };
}

function buildGrid(entries) {
  const grid = new Map();
  for (const e of entries) {
    const day = e.time_slot?.working_day?.name;
    const pn = e.time_slot?.period_number;
    if (!day || !pn) continue;
    if (!grid.has(day)) grid.set(day, new Map());
    grid.get(day).set(pn, {
      subject: `${e.faculty?.subject?.code || ''} ${e.faculty?.subject?.name || ''}`.trim(),
      faculty: e.faculty?.faculty?.name || '',
      room: e.room?.room_number || '',
      type: e.session_type || '',
      division: e.division?.name || '',
    });
  }
  return grid;
}

export async function exportTimetablePdf(id) {
  const { tt, entries, allSlots, institution } = await loadExportBundle(id);
  const grid = buildGrid(entries);

  const periodSet = new Set((allSlots || []).map((s) => s.period_number));
  const dayNames = [...new Set((allSlots || []).map((s) => s.working_day?.name).filter(Boolean))];
  const periods = [...periodSet].sort((a, b) => a - b);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const margin = 15;
  const colWidth = 38;
  const rowHeight = 18;
  const tableLeft = margin;
  const tableWidth = (periods.length + 1) * colWidth;
  const y0 = 60;

  doc.setFontSize(15).setFont('helvetica', 'bold');
  doc.text(institution || 'Educational Institute', 148, 20, { align: 'center' });
  doc.setFontSize(10).setFont('helvetica', 'normal');
  doc.text(`Timetable — ${tt.academic_year?.name} | ${tt.semester?.name} | ${tt.course?.name}`, 148, 28, { align: 'center' });
  doc.setFontSize(8.5);
  doc.text(`Status: ${tt.status}  •  Generated: ${new Date().toISOString().split('T')[0]}`, 148, 34, { align: 'center' });

  doc.setFont('helvetica', 'bold').setFontSize(7);
  doc.text('Day', tableLeft + 3, y0 + 6);
  periods.forEach((p, idx) => {
    const s = (allSlots || []).find((x) => x.period_number === p);
    const label = s ? `P${p} ${s.start_time}-${s.end_time}` : `P${p}`;
    doc.text(label, tableLeft + colWidth * (idx + 1) + colWidth / 2, y0 + 6, { align: 'center' });
  });

  doc.setFont('helvetica', 'normal');
  dayNames.forEach((day, rowIdx) => {
    const y = y0 + (rowIdx + 1) * rowHeight;
    doc.setFont('helvetica', 'bold').setFontSize(9).text(day, tableLeft + 3, y + 6);
    doc.setFont('helvetica', 'normal');
    periods.forEach((p, idx) => {
      const cell = grid.get(day)?.get(p);
      if (!cell) return;
      const cx = tableLeft + colWidth * (idx + 1);
      doc.setFontSize(6.5);
      doc.text(cell.subject, cx + 2, y + 4, { maxWidth: colWidth - 4 });
      doc.setFontSize(6);
      doc.text(cell.faculty, cx + 2, y + 9, { maxWidth: colWidth - 4 });
      doc.text(`${cell.room} · ${cell.type}`, cx + 2, y + 14, { maxWidth: colWidth - 4 });
      doc.setFontSize(6.5);
    });
  });

  const yBottom = y0 + (dayNames.length + 1) * rowHeight;
  doc.setDrawColor(0).setLineWidth(0.2);
  doc.rect(tableLeft, y0 - 4, tableWidth, yBottom - y0 + 4);
  for (let i = 1; i <= dayNames.length + 1; i++) {
    doc.line(tableLeft, y0 - 4 + rowHeight * i, tableLeft + tableWidth, y0 - 4 + rowHeight * i);
  }
  for (let i = 1; i <= periods.length; i++) {
    doc.line(tableLeft + colWidth * i, y0 - 4, tableLeft + colWidth * i, yBottom);
  }

  doc.setFontSize(7);
  doc.text(
    `Academic Year: ${tt.academic_year?.name} | Semester: ${tt.semester?.name} | Status: ${tt.status} | Institution: ${institution}`,
    margin,
    yBottom + 8
  );

  doc.save(`timetable-${id}.pdf`);
}

export async function exportTimetableExcel(id) {
  const { tt, entries, allSlots, institution } = await loadExportBundle(id);
  const grid = buildGrid(entries);

  const periodSet = new Set((allSlots || []).map((s) => s.period_number));
  const dayNames = [...new Set((allSlots || []).map((s) => s.working_day?.name).filter(Boolean))];
  const periods = [...periodSet].sort((a, b) => a - b);

  const headerCols = [
    'Day',
    ...periods.map((p) => {
      const s = (allSlots || []).find((x) => x.period_number === p);
      return s ? `P${p} ${s.start_time}-${s.end_time}` : `P${p}`;
    }),
  ];

  const aoa = [
    [institution || 'Educational Institute'],
    [`Timetable — ${tt.academic_year?.name} | ${tt.semester?.name} | ${tt.course?.name} | Status: ${tt.status}`],
    headerCols,
  ];
  for (const day of dayNames) {
    const row = [day];
    for (const p of periods) {
      const cell = grid.get(day)?.get(p);
      row.push(cell ? `${cell.subject}\n${cell.faculty}\n${cell.room} (${cell.type})` : '');
    }
    aoa.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 14 }, ...periods.map(() => ({ wch: 30 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Timetable');
  XLSX.writeFile(wb, `timetable-${id}.xlsx`);
}

// ---------------------------------------------------------------------------
// My timetable (faculty view)
// ---------------------------------------------------------------------------
export async function getMyTimetables(facultyId) {
  if (!facultyId) return [];
  const { data, error } = await supabase
    .from('timetable_entries')
    .select(
      `*,
       division:divisions(name),
       room:rooms(room_number, room_name, room_type),
       time_slot:time_slots(period_number, start_time, end_time, is_break, working_day:working_days(name, day_number)),
       faculty:faculty_subjects!inner(faculty_id, subject_id, subject:subjects(code, name, is_lab)),
       timetable:timetable(id, status, academic_year_id, course_id, semester_id,
         academic_year:academic_years(name), course:courses(name), semester:semesters(name))`
    )
    .eq('faculty_id', facultyId);
  throwOnError({ error });

  const grouped = new Map();
  for (const e of data || []) {
    const t = e.timetable;
    if (!t) continue;
    const key = t.id;
    if (!grouped.has(key)) {
      grouped.set(key, {
        ...t,
        status: t.status,
        entry_count: 0,
        entries: [],
      });
    }
    grouped.get(key).entries.push(e);
    grouped.get(key).entry_count += 1;
  }
  return [...grouped.values()].sort((a, b) => b.created_at?.localeCompare(a.created_at || '') || 0);
}

// ---------------------------------------------------------------------------
// Excel import helpers (templates + bulk upload)
// ---------------------------------------------------------------------------
export function downloadExcelTemplate(filename, columns) {
  const header = columns.map((c) => c.header);
  const sample = columns.map((c) => (c.sample ?? ''));
  const ws = XLSX.utils.aoa_to_sheet([header, sample]);
  ws['!cols'] = columns.map((c) => ({ wch: c.width ?? 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export async function parseExcelRows(file, expectedHeaders) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const keys = Object.keys(json[0] || {});
  const missing = expectedHeaders.filter((h) => !keys.includes(h));
  if (missing.length) {
    throw new AppError(422, `File is missing columns: ${missing.join(', ')}. Download the template and fill it in.`);
  }
  return json;
}

export function excelVal(v) {
  return String(v ?? '').trim();
}

export function excelBool(v) {
  const s = excelVal(v).toLowerCase();
  return s === '' ? null : ['true', 'yes', 'y', '1', '✓'].includes(s);
}

export async function importRows(rows, rowFn) {
  const errors = [];
  let imported = 0;
  for (let i = 0; i < rows.length; i++) {
    try {
      await rowFn(rows[i]);
      imported += 1;
    } catch (err) {
      errors.push(`Row ${i + 2}: ${err.message}`);
    }
  }
  return { imported, errors };
}

// ---------------------------------------------------------------------------
// Generic CRUD helpers
// ---------------------------------------------------------------------------
async function removeWithFallback(table, id, checks) {
  for (const { refTable, col } of checks) {
    const { count } = await supabase
      .from(refTable)
      .select('id', { count: 'exact', head: true })
      .eq(col, id);
    if ((count || 0) > 0) {
      const { error } = await supabase.from(table).update({ is_active: false }).eq('id', id);
      throwOnError({ error });
      return { deactivated: true };
    }
  }
  const { data, error } = await supabase.from(table).delete().eq('id', id).select('id').maybeSingle();
  throwOnError({ error });
  return { deleted: true, id: data?.id };
}

// ---------------------------------------------------------------------------
// Departments (lookup source; no standalone page)
// ---------------------------------------------------------------------------
export async function listDepartments() {
  const { data, error } = await supabase.from('departments').select('*').order('name');
  throwOnError({ error });
  return data || [];
}

export async function createDepartment(body) {
  const { error } = await supabase.from('departments').insert({ ...body, is_active: body.is_active ?? true });
  throwOnError({ error });
}

export async function updateDepartment(id, body) {
  const { error } = await supabase.from('departments').update(body).eq('id', id);
  throwOnError({ error });
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------
export async function listCourses() {
  const { data, error } = await supabase
    .from('courses')
    .select('*, department:departments(code, name)')
    .order('name');
  throwOnError({ error });
  return data || [];
}

export async function createCourse(body) {
  const { error } = await supabase.from('courses').insert({ ...body, is_active: body.is_active ?? true });
  throwOnError({ error });
}

export async function updateCourse(id, body) {
  const { error } = await supabase.from('courses').update(body).eq('id', id);
  throwOnError({ error });
}

export async function deleteCourse(id) {
  return removeWithFallback('courses', id, [
    { refTable: 'divisions', col: 'course_id' },
    { refTable: 'subjects', col: 'course_id' },
    { refTable: 'timetable', col: 'course_id' },
  ]);
}

// ---------------------------------------------------------------------------
// Semesters
// ---------------------------------------------------------------------------
export async function listSemesters() {
  const { data, error } = await supabase
    .from('semesters')
    .select('*, academic_year:academic_years(name)')
    .order('semester_number');
  throwOnError({ error });
  return data || [];
}

export async function createSemester(body) {
  const { error } = await supabase.from('semesters').insert(body);
  throwOnError({ error });
}

export async function updateSemester(id, body) {
  const { error } = await supabase.from('semesters').update(body).eq('id', id);
  throwOnError({ error });
}

export async function deleteSemester(id) {
  return removeWithFallback('semesters', id, [
    { refTable: 'divisions', col: 'semester_id' },
    { refTable: 'subjects', col: 'semester_id' },
    { refTable: 'timetable', col: 'semester_id' },
  ]);
}

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------
export async function listDivisions() {
  const { data, error } = await supabase
    .from('divisions')
    .select('*, course:courses(name), academic_year:academic_years(name), semester:semesters(name)')
    .order('name');
  throwOnError({ error });
  return data || [];
}

export async function createDivision(body) {
  const { error } = await supabase.from('divisions').insert({ ...body, is_active: body.is_active ?? true });
  throwOnError({ error });
}

export async function updateDivision(id, body) {
  const { error } = await supabase.from('divisions').update(body).eq('id', id);
  throwOnError({ error });
}

export async function deleteDivision(id) {
  return removeWithFallback('divisions', id, [
    { refTable: 'faculty_subjects', col: 'division_id' },
    { refTable: 'lesson_plans', col: 'division_id' },
    { refTable: 'attendance', col: 'division_id' },
    { refTable: 'timetable_entries', col: 'division_id' },
  ]);
}

// ---------------------------------------------------------------------------
// Faculty
// ---------------------------------------------------------------------------
export async function listFaculty() {
  const { data, error } = await supabase
    .from('faculty')
    .select('*, department:departments(code, name)')
    .order('name');
  throwOnError({ error });
  return data || [];
}

export async function createFaculty(body) {
  const { error } = await supabase.from('faculty').insert({ ...body, is_active: body.is_active ?? true });
  throwOnError({ error });
}

export async function updateFaculty(id, body) {
  const { error } = await supabase.from('faculty').update(body).eq('id', id);
  throwOnError({ error });
}

export async function deleteFaculty(id) {
  return removeWithFallback('faculty', id, [
    { refTable: 'faculty_subjects', col: 'faculty_id' },
    { refTable: 'lesson_plans', col: 'faculty_id' },
    { refTable: 'attendance', col: 'faculty_id' },
    { refTable: 'users', col: 'faculty_id' },
  ]);
}

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------
export async function listSubjects() {
  const { data, error } = await supabase
    .from('subjects')
    .select('*, department:departments(code, name), course:courses(name), semester:semesters(name)')
    .order('name');
  throwOnError({ error });
  return data || [];
}

function subjectWithHours(body) {
  const bodyCopy = { ...body };
  const lec = Number(bodyCopy.lecture_hours || 0);
  const tut = Number(bodyCopy.tutorial_hours || 0);
  const pra = Number(bodyCopy.practical_hours || 0);
  bodyCopy.weekly_required_hours = lec + tut + pra;
  return bodyCopy;
}

export async function createSubject(body) {
  const { error } = await supabase.from('subjects').insert(subjectWithHours(body));
  throwOnError({ error });
}

export async function updateSubject(id, body) {
  const { error } = await supabase.from('subjects').update(subjectWithHours(body)).eq('id', id);
  throwOnError({ error });
}

export async function deleteSubject(id) {
  return removeWithFallback('subjects', id, [
    { refTable: 'faculty_subjects', col: 'subject_id' },
    { refTable: 'lesson_plans', col: 'subject_id' },
    { refTable: 'attendance', col: 'subject_id' },
    { refTable: 'subject_credits', col: 'subject_id' },
  ]);
}

// ---------------------------------------------------------------------------
// Faculty <-> subject mappings
// ---------------------------------------------------------------------------
export async function listMappings() {
  const { data, error } = await supabase
    .from('faculty_subjects')
    .select('*, faculty:faculty(id, name, employee_id), subject:subjects(code, name), division:divisions(name), academic_year:academic_years(name)')
    .order('created_at', { ascending: false });
  throwOnError({ error });
  return data || [];
}

export async function createMapping(body) {
  const { error } = await supabase.from('faculty_subjects').insert({ ...body, is_active: body.is_active ?? true });
  throwOnError({ error });
}

export async function updateMapping(id, body) {
  const { error } = await supabase.from('faculty_subjects').update(body).eq('id', id);
  throwOnError({ error });
}

export async function deleteMapping(id) {
  const { error } = await supabase.from('faculty_subjects').delete().eq('id', id);
  throwOnError({ error });
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
export async function listRooms() {
  const { data, error } = await supabase
    .from('rooms')
    .select('*, department:departments(code, name)')
    .order('room_number');
  throwOnError({ error });
  return data || [];
}

export async function createRoom(body) {
  const { error } = await supabase.from('rooms').insert({
    ...body,
    department_id: body.department_id || null,
    is_available: body.is_available ?? true,
    is_active: body.is_active ?? true,
  });
  throwOnError({ error });
}

export async function updateRoom(id, body) {
  const { error } = await supabase
    .from('rooms')
    .update({ ...body, department_id: body.department_id || null })
    .eq('id', id);
  throwOnError({ error });
}

export async function deleteRoom(id) {
  return removeWithFallback('rooms', id, [{ refTable: 'timetable_entries', col: 'room_id' }]);
}

// ---------------------------------------------------------------------------
// Working days
// ---------------------------------------------------------------------------
export async function listWorkingDays() {
  const { data, error } = await supabase
    .from('working_days')
    .select('*, slots:time_slots(count)')
    .order('day_number');
  throwOnError({ error });
  return (data || []).map((d) => ({ ...d, slot_count: Array.isArray(d.slots) && d.slots[0] ? Number(d.slots[0].count) : 0 }));
}

export async function createWorkingDay(body) {
  const { error } = await supabase.from('working_days').insert({ ...body, is_active: body.is_active ?? true });
  throwOnError({ error });
}

export async function updateWorkingDay(id, body) {
  const { error } = await supabase.from('working_days').update(body).eq('id', id);
  throwOnError({ error });
}

export async function deleteWorkingDay(id) {
  return removeWithFallback('working_days', id, [{ refTable: 'time_slots', col: 'working_day_id' }]);
}

// ---------------------------------------------------------------------------
// Time slots
// ---------------------------------------------------------------------------
export async function listTimeSlots() {
  const { data, error } = await supabase
    .from('time_slots')
    .select('*, working_day:working_days(name, day_number)')
    .order('working_day_id')
    .order('period_number');
  throwOnError({ error });
  return data || [];
}

export async function createTimeSlot(body) {
  const { error } = await supabase.from('time_slots').insert({ ...body, is_active: body.is_active ?? true });
  throwOnError({ error });
}

export async function updateTimeSlot(id, body) {
  const { error } = await supabase.from('time_slots').update(body).eq('id', id);
  throwOnError({ error });
}

export async function deleteTimeSlot(id) {
  const { error } = await supabase.from('time_slots').delete().eq('id', id);
  throwOnError({ error });
}

// ---------------------------------------------------------------------------
// Users (admin page)
// ---------------------------------------------------------------------------
export async function listUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('*, department:departments(code, name), faculty:faculty(id, name, employee_id)')
    .order('created_at', { ascending: false });
  throwOnError({ error });
  return data || [];
}

export async function updateUser(id, body) {
  const { error } = await supabase.from('users').update(body).eq('id', id);
  throwOnError({ error });
}

// ---------------------------------------------------------------------------
// Lesson plans
// ---------------------------------------------------------------------------
const lessonPlanSelect =
  '*, academic_year:academic_years(name), semester:semesters(name), course:courses(name), division:divisions(name), faculty:faculty(id, name, employee_id), subject:subjects(code, name)';

export async function listLessonPlans(filters = {}) {
  let qb = supabase.from('lesson_plans').select(lessonPlanSelect).order('planned_date', { ascending: false, nullsFirst: false });
  if (filters.faculty_id) qb = qb.eq('faculty_id', filters.faculty_id);
  if (filters.subject_id) qb = qb.eq('subject_id', filters.subject_id);
  if (filters.division_id) qb = qb.eq('division_id', filters.division_id);
  if (filters.status) qb = qb.eq('status', filters.status);
  const { data, error } = await qb;
  throwOnError({ error });
  return data || [];
}

export async function createLessonPlan(body) {
  const { error } = await supabase.from('lesson_plans').insert({ ...body, status: 'draft' });
  throwOnError({ error });
}

export async function updateLessonPlan(id, body) {
  const { error } = await supabase.from('lesson_plans').update(body).eq('id', id);
  throwOnError({ error });
}

export async function deleteLessonPlan(id) {
  const { error } = await supabase.from('lesson_plans').delete().eq('id', id);
  throwOnError({ error });
}

const LESSON_TRANSITIONS = {
  submit: { from: 'draft', to: 'submitted', allowed: ['admin', 'hod', 'faculty'] },
  approve: { from: 'submitted', to: 'approved', allowed: ['admin', 'hod'] },
  reject: { from: 'submitted', to: 'draft', allowed: ['admin', 'hod'] },
  reopen: { from: 'approved', to: 'draft', allowed: ['admin', 'hod'] },
};

export async function transitionLessonPlan(id, action) {
  const me = get(user);
  const spec = LESSON_TRANSITIONS[action];
  if (!spec) throw new AppError(400, `Unknown action: ${action}`);
  if (!me || !spec.allowed.includes(me.role)) {
    throw new AppError(403, 'You do not have permission for this action');
  }
  const { data: plan, error } = await supabase
    .from('lesson_plans')
    .select('id, status, faculty:faculty(id, department_id)')
    .eq('id', id)
    .maybeSingle();
  throwOnError({ error });
  if (!plan) throw new AppError(404, 'Lesson plan not found');
  if (me.role === 'hod') {
    const { data: meFaculty } = await supabase.from('users').select('department_id').eq('id', me.id).maybeSingle();
    if (meFaculty?.department_id && plan.faculty?.department_id !== meFaculty.department_id) {
      throw new AppError(403, 'You do not have access to this lesson plan');
    }
  }
  if (plan.status !== spec.from) {
    throw new AppError(409, `Lesson plan must be "${spec.from}" to perform this action`);
  }
  const { error: upErr } = await supabase
    .from('lesson_plans')
    .update({ status: spec.to, created_by: me.id })
    .eq('id', id);
  throwOnError({ error: upErr });
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
const attendanceSelect =
  '*, faculty:faculty(id, name, employee_id), subject:subjects(code, name), division:divisions(name), academic_year:academic_years(name)';

export async function listAttendance(filters = {}) {
  let qb = supabase.from('attendance').select(attendanceSelect).order('date', { ascending: false });
  if (filters.faculty_id) qb = qb.eq('faculty_id', filters.faculty_id);
  if (filters.subject_id) qb = qb.eq('subject_id', filters.subject_id);
  if (filters.division_id) qb = qb.eq('division_id', filters.division_id);
  if (filters.status) qb = qb.eq('status', filters.status);
  if (filters.date) qb = qb.eq('date', filters.date);
  const { data, error } = await qb;
  throwOnError({ error });
  return data || [];
}

export async function createAttendance(body) {
  const me = get(user);
  const { error } = await supabase.from('attendance').insert({ ...body, created_by: me?.id || null });
  throwOnError({ error });
}

export async function updateAttendance(id, body) {
  const { error } = await supabase.from('attendance').update(body).eq('id', id);
  throwOnError({ error });
}

export async function deleteAttendance(id) {
  const { error } = await supabase.from('attendance').delete().eq('id', id);
  throwOnError({ error });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export async function getWorkloadReport(yearId) {
  let qb = supabase
    .from('faculty_workload')
    .select(
      '*, faculty:faculty(id, name, employee_id, designation, department_id, maximum_weekly_load, department:departments(name)), academic_year:academic_years(name), semester:semesters(name)'
    );
  if (yearId) qb = qb.eq('academic_year_id', yearId);
  const { data, error } = await qb;
  throwOnError({ error });

  const rows = (data || []).map((r) => ({
    ...r,
    load_percent:
      Number(r.faculty?.maximum_weekly_load) > 0
        ? Math.round((Number(r.total_hours) / Number(r.faculty.maximum_weekly_load)) * 100)
        : null,
    overloaded:
      Number(r.faculty?.maximum_weekly_load) > 0 && Number(r.total_hours) > Number(r.faculty.maximum_weekly_load),
  }));
  rows.sort((a, b) => Number(b.load_percent || 0) - Number(a.load_percent || 0));
  return rows;
}

export async function getAttendanceReport(yearId) {
  let qb = supabase.from('attendance').select('id, status, date, academic_year_id');
  if (yearId) qb = qb.eq('academic_year_id', yearId);
  const { data, error } = await qb;
  throwOnError({ error });
  const total = (data || []).length;
  const byStatus = (data || []).reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const byMonth = (data || []).reduce((acc, r) => {
    const m = (r.date || '').slice(0, 7);
    if (!m) return acc;
    acc[m] = (acc[m] || 0) + 1;
    return acc;
  }, {});
  return {
    total,
    present: byStatus.present || 0,
    absent: byStatus.absent || 0,
    leave: byStatus.leave || 0,
    byMonth: Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0])),
  };
}