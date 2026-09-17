import { supabase } from '../supabase.js';

// Thin helpers to fetch id sets used by scope filters.
async function idsIn(column, table) {
  const { data, error } = await supabase.from(table).select(column);
  if (error) throw error;
  return (data || []).map((r) => r[column]).filter(Boolean);
}

// Apply role-based row-level filtering to a Supabase query builder.
// Admin: no scope. HOD: department scope. Faculty: their own records.
export async function applyScope(qb, user, resource) {
  if (!user || user.role === 'admin') return qb;

  if (user.role === 'hod') return hodScope(qb, user, resource);
  return facultyScope(qb, user, resource);
}

async function hodScope(qb, user, resource) {
  const dept = user.department_id;

  switch (resource) {
    case 'departments':
      return qb.eq('id', dept);
    case 'faculty':
      return qb.eq('department_id', dept);
    case 'courses':
      return qb.eq('department_id', dept);
    case 'subjects':
      return qb.eq('department_id', dept);
    case 'divisions': {
      const courseIds = await idsIn('id', 'courses');
      const { data } = await supabase.from('courses').select('id').eq('department_id', dept);
      const ids = (data || []).map((r) => r.id);
      return ids.length ? qb.in('course_id', ids) : qb.in('course_id', courseIds.filter(() => false));
    }
    case 'subject_credits': {
      const { data } = await supabase.from('subjects').select('id').eq('department_id', dept);
      const ids = (data || []).map((r) => r.id);
      return ids.length ? qb.in('subject_id', ids) : qb.in('subject_id', [null]);
    }
    case 'faculty_subjects': {
      const { data } = await supabase.from('faculty').select('id').eq('department_id', dept);
      const ids = (data || []).map((r) => r.id);
      return ids.length ? qb.in('faculty_id', ids) : qb.in('faculty_id', [null]);
    }
    case 'rooms':
      return qb.or(`department_id.eq.${dept},department_id.is.null`);
    case 'lesson_plans':
    case 'attendance':
    case 'faculty_workload': {
      const { data } = await supabase.from('faculty').select('id').eq('department_id', dept);
      const ids = (data || []).map((r) => r.id);
      return ids.length ? qb.in('faculty_id', ids) : qb.in('faculty_id', [null]);
    }
    case 'timetable': {
      const { data } = await supabase.from('courses').select('id').eq('department_id', dept);
      const ids = (data || []).map((r) => r.id);
      return ids.length ? qb.in('course_id', ids) : qb.in('course_id', [null]);
    }
    case 'timetable_entries': {
      const { data: courseRows } = await supabase.from('courses').select('id').eq('department_id', dept);
      const courseIds = (courseRows || []).map((r) => r.id);
      const { data: divisionRows } = await supabase
        .from('divisions')
        .select('id')
        .in('course_id', courseIds.length ? courseIds : [null]);
      const ids = (divisionRows || []).map((r) => r.id);
      return ids.length ? qb.in('division_id', ids) : qb.in('division_id', [null]);
    }
    case 'academic_years':
    case 'semesters':
    case 'working_days':
    case 'time_slots':
    case 'settings':
      return qb;
    case 'audit_logs':
      return qb;
    default:
      return qb;
  }
}

async function facultyScope(qb, user, resource) {
  const fid = user.faculty_id;
  const noRows = (qb2) => qb2.in('id', []);

  switch (resource) {
    case 'departments':
      return qb.eq('id', user.department_id || '00000000-0000-0000-0000-000000000000');
    case 'faculty':
      return qb.eq('id', fid);
    case 'courses': {
      const { data } = await supabase
        .from('faculty_subjects')
        .select('divisions!inner(course_id)')
        .eq('faculty_id', fid);
      const ids = (data || []).map((r) => r.divisions?.course_id).filter(Boolean);
      return ids.length ? qb.in('id', ids) : noRows(qb);
    }
    case 'divisions': {
      const { data } = await supabase.from('faculty_subjects').select('division_id').eq('faculty_id', fid);
      const ids = (data || []).map((r) => r.division_id);
      return ids.length ? qb.in('id', ids) : noRows(qb);
    }
    case 'subjects': {
      const { data } = await supabase.from('faculty_subjects').select('subject_id').eq('faculty_id', fid);
      const ids = (data || []).map((r) => r.subject_id);
      return ids.length ? qb.in('id', ids) : noRows(qb);
    }
    case 'subject_credits': {
      const { data } = await supabase.from('faculty_subjects').select('subject_id').eq('faculty_id', fid);
      const ids = (data || []).map((r) => r.subject_id);
      return ids.length ? qb.in('subject_id', ids) : noRows(qb);
    }
    case 'faculty_subjects':
      return qb.eq('faculty_id', fid);
    case 'lesson_plans':
    case 'attendance':
    case 'faculty_workload':
      return qb.eq('faculty_id', fid);
    case 'timetable': {
      const { data } = await supabase
        .from('timetable_entries')
        .select('timetable_id')
        .eq('faculty_id', fid);
      const ids = (data || []).map((r) => r.timetable_id);
      return ids.length ? qb.in('id', ids) : noRows(qb);
    }
    case 'timetable_entries': {
      const { data } = await supabase
        .from('timetable_entries')
        .select('id')
        .eq('faculty_id', fid);
      const entryIds = (data || []).map((r) => r.id);
      const { data: divs } = await supabase.from('faculty_subjects').select('division_id').eq('faculty_id', fid);
      const divIds = (divs || []).map((r) => r.division_id);
      return entryIds.length
        ? qb.or(`id.in.(${entryIds.join(',')}),division_id.in.(${divIds.join(',')})`)
        : (divIds.length ? qb.in('division_id', divIds) : noRows(qb));
    }
    case 'rooms':
      return qb;
    case 'academic_years':
    case 'semesters':
    case 'working_days':
    case 'time_slots':
    case 'settings':
    case 'audit_logs':
      return qb;
    default:
      return qb;
  }
}