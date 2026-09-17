import { supabase } from '../supabase.js';
import { AppError, notFound, unprocessable, conflict } from '../utils/errors.js';

const LAB_ROOM_TYPES = ['laboratory', 'workshop'];

// Deterministic PRNG (mulberry32) so generation is repeatable for a given seed.
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

/**
 * Constraint-based timetable generator.
 * Returns an object with timetable_id, status, scheduled_entries,
 * unscheduled_requirements and conflicts.
 */
export async function generateTimetable({
  academic_year_id,
  semester_id,
  course_id,
  division_ids,
  working_day_ids,
  time_slot_ids,
  replace_existing_draft = false,
  seed = null,
  generated_by,
}) {
  if (!academic_year_id || !semester_id || !course_id || !division_ids?.length) {
    throw unprocessable('academic_year_id, semester_id, course_id and division_ids are required');
  }

  // 1. Only active academic year
  const { data: year } = await supabase.from('academic_years').select('id, is_active').eq('id', academic_year_id).maybeSingle();
  if (!year) throw notFound('Academic year not found');
  if (!year.is_active) throw unprocessable('Generation is only allowed for an active academic year');

  const periodFilter = { academic_year_id, semester_id, course_id };

  // 2. Handle existing timetables (drafts may be replaced; published never overwritten)
  const { data: nonDraft } = await supabase
    .from('timetable')
    .select('id, status')
    .match(periodFilter)
    .in('status', ['pending_approval', 'approved', 'published'])
    .maybeSingle();

  if (nonDraft && replace_existing_draft) {
    throw conflict(`Cannot replace the ${nonDraft.status} timetable. Unpublish it or create a new revision.`);
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
    throw unprocessable('No active divisions match the requested course/semester/academic year');
  }
  const divisionMap = new Map(divisions.map((d) => [d.id, d]));

  // 4. Faculty-subject mappings (+ faculty + subject)
  const { data: mappings } = await supabase
    .from('faculty_subjects')
    .select(
      `id, faculty_id, subject_id, division_id, is_active,
       faculty:faculty(id, name, maximum_weekly_load, is_active, employee_id),
       subject:subjects(id, code, name, lecture_hours, tutorial_hours, practical_hours, is_lab, is_active)`
    )
    .eq('academic_year_id', academic_year_id)
    .in('division_id', divisions.map((d) => d.id))
    .eq('is_active', true);

  const usableMappings = (mappings || []).filter((m) => {
    if (!m.faculty || !m.subject) return false;
    if (!m.faculty.is_active) return false;
    if (!m.subject.is_active) return false;
    return true;
  });

  if (usableMappings.length === 0) {
    throw unprocessable('No active faculty-subject mappings found for the selected divisions');
  }

  // 5. Time slots (only selected days, non-break, active)
  const { data: rawSlots } = await supabase
    .from('time_slots')
    .select('id, working_day_id, period_number, start_time, end_time, is_break, is_active, working_day:working_days(id, day_number, name, is_active)')
    .in('id', time_slot_ids || []);
  if (!rawSlots || rawSlots.length === 0) {
    throw unprocessable('No time slots match the request');
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

  if (slots.length < 2) throw unprocessable('Need at least two usable (non-break, active) time slots');

  // 6. Rooms
  const { data: rooms } = await supabase
    .from('rooms')
    .select('id, room_number, room_type, capacity, is_available, is_active')
    .eq('is_active', true)
    .eq('is_available', true);
  const roomPool = rooms || [];
  const labRooms = roomPool.filter((r) => LAB_ROOM_TYPES.includes(r.room_type));
  const classRooms = roomPool.filter((r) => !LAB_ROOM_TYPES.includes(r.room_type));
  if (classRooms.length === 0) throw unprocessable('No available classrooms for generation');

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
  const rng = mulberry32(seed == null ? Date.now() % 2147483647 : seed);

  const slotsByDay = new Map();
  for (const s of slots) {
    if (!slotsByDay.has(s.dayId)) slotsByDay.set(s.dayId, []);
    slotsByDay.get(s.dayId).push(s);
  }
  const days = [...slotsByDay.keys()];

  const facultyBusy = new Map();      // facultyId -> Set(slotId)
  const divisionBusy = new Map();     // divisionId -> Set(slotId)
  const roomBusy = new Map();         // roomId -> Set(slotId)
  const facultyHours = new Map();     // facultyId -> hours
  const divisionDayCount = new Map(); // division:dayId -> count
  const subjectDayCount = new Map();  // division:subject:dayId -> count

  const assigned = [];
  const unscheduled = [];

  function pickRoomFor(slotId, pool, maxCapacityNeeded) {
    const compatible = pool.filter((r) => r.capacity >= maxCapacityNeeded);
    // deterministic: prefer least used
    compatible.sort((a, b) => (roomBusy.get(a.id)?.size || 0) - (roomBusy.get(b.id)?.size || 0) || a.room_number.localeCompare(b.room_number));
    for (const r of compatible) {
      if (!roomBusy.get(r.id)?.has(slotId)) return r;
    }
    return null;
  }

  function windowValid(window, req, div) {
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

  function scoreWindow(window, req, div) {
    let score = 0;
    const dayId = window[0].dayId;
    const classesToday = divisionDayCount.get(`${req.divisionId}:${dayId}`) || 0;
    const subjToday = subjectDayCount.get(`${req.divisionId}:${req.subjectId}:${dayId}`) || 0;
    score += classesToday * 3; // spread work across days
    score += subjToday * 10;   // avoid same subject repeatedly on one day
    score += rng();            // seeded tie-breaker
    return score;
  }

  // Order: hardest (most hours) first for stability; tie-break by seed.
  const orderBy = new Map();
  for (const m of usableMappings) {
    orderBy.set(m.id, Number(m.subject.lecture_hours) + Number(m.subject.tutorial_hours) + Number(m.subject.practical_hours));
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

    // seeded shuffle of candidate starting order to smooth distribution
    windows = shuffle(windows, rng).map((w) => ({ w, score: scoreWindow(w, req, div) })).sort((a, b) => a.score - b.score);

    let chosen = null;
    for (const { w } of windows) {
      if (!windowValid(w, req, div)) continue;
      const roomsPicked = suggestRooms(w, req, div);
      if (!roomsPicked) continue;
      chosen = { w, roomsPicked };
      break;
    }

    if (!chosen) {
      unscheduled.push({
        ...req,
        reason: facultyHours.get(req.facultyId) >= req.maxLoad
          ? 'FACULTY_LOAD_EXCEEDED'
          : (req.roomType === 'lab' && labRooms.length === 0)
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

  // 9. Persist timetable (draft) and entries atomically
  const { data: tt, error: ttError } = await supabase
    .from('timetable')
    .insert({
      academic_year_id,
      semester_id,
      course_id,
      generated_by,
      status: 'draft',
      generated_seed: seed,
    })
    .select()
    .single();
  if (ttError) throw ttError;

  if (assigned.length > 0) {
    const { error: rpcError } = await supabase.rpc('insert_timetable_entries', {
      p_timetable_id: tt.id,
      p_entries: assigned,
    });
    if (rpcError) {
      await supabase.from('timetable').delete().eq('id', tt.id).catch(() => {});
      let extra = {};
      try {
        extra = { conflicts: JSON.parse(rpcError.details || '[]') };
      } catch {
        /* ignore */
      }
      throw new AppError(409, 'TIMETABLE_CONFLICT', 'Timetable contains unresolved conflicts', extra);
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