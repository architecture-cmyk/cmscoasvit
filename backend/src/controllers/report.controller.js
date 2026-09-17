import { z } from 'zod';
import { Router } from 'express';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { supabase } from '../supabase.js';
import { validateQuery, uuidSchema } from '../utils/validate.js';
import { ok } from '../utils/response.js';
import { notFound, forbidden } from '../utils/errors.js';
import { fromDbError } from '../utils/errors.js';
import { applyScope } from '../services/scope.js';
import { authenticate } from '../middleware/auth.js';
import { departmentScopeMatches, requireAdminOrHod, requireRoles } from '../middleware/rbac.js';

export const reportRouter = Router();
reportRouter.use(authenticate);

const filterQuery = z.object({
  academic_year_id: uuidSchema.optional(),
  semester_id: uuidSchema.optional(),
  course_id: uuidSchema.optional(),
  department_id: uuidSchema.optional(),
  division_id: uuidSchema.optional(),
  faculty_id: uuidSchema.optional(),
  status: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Faculty workload
// ---------------------------------------------------------------------------
reportRouter.get('/faculty-workload', requireRoles('admin', 'hod', 'faculty'), validateQuery(filterQuery), async (req, res, next) => {
  try {
    async function deptFacultyIds(deptId) {
      const { data } = await supabase.from('faculty').select('id').eq('department_id', deptId);
      return (data || []).map((f) => f.id);
    }

    let qb = supabase
      .from('faculty_workload')
      .select('*, faculty:faculty(id, name, employee_id, maximum_weekly_load, designation, department:departments(code, name)), academic_year:academic_years(name), semester:semesters(name)')
      .order('total_hours', { ascending: false });

    if (req.query.department_id) {
      const ids = await deptFacultyIds(req.query.department_id);
      qb = qb.in('faculty_id', ids.length ? ids : [null]);
    } else if (req.user.role === 'hod') {
      const ids = await deptFacultyIds(req.user.department_id);
      qb = qb.in('faculty_id', ids.length ? ids : [null]);
    } else if (req.user.role === 'faculty') {
      qb = qb.eq('faculty_id', req.user.faculty_id);
    }
    if (req.query.academic_year_id) qb = qb.eq('academic_year_id', req.query.academic_year_id);
    if (req.query.semester_id) qb = qb.eq('semester_id', req.query.semester_id);

    const { data, error } = await qb;
    if (error) throw error;
    const rows = (data || []).map((r) => ({
      ...r,
      overloaded: Number(r.faculty?.maximum_weekly_load) > 0 && Number(r.total_hours) > Number(r.faculty.maximum_weekly_load),
      load_percent: Number(r.faculty?.maximum_weekly_load) > 0
        ? Math.round((Number(r.total_hours) / Number(r.faculty.maximum_weekly_load)) * 100)
        : null,
    }));
    return ok(res, rows, 'Faculty workload report');
  } catch (err) {
    return next(fromDbError(err));
  }
});

// ---------------------------------------------------------------------------
// Free rooms / free faculty at a given period
// ---------------------------------------------------------------------------
const freeQuery = z.object({
  academic_year_id: uuidSchema.optional(),
  semester_id: uuidSchema.optional(),
  course_id: uuidSchema.optional(),
  working_day_id: uuidSchema,
  period_number: z.coerce.number().int().min(1),
});

async function busyResourceIds(query, resource) {
  const { working_day_id, period_number, academic_year_id, semester_id } = query;
  const { data: slotRows } = await supabase
    .from('time_slots')
    .select('id')
    .eq('working_day_id', working_day_id)
    .eq('period_number', period_number)
    .eq('is_break', false);
  const slotIds = (slotRows || []).map((s) => s.id);
  if (slotIds.length === 0) return [];

  let ttQb = supabase.from('timetable').select('id').eq('status', 'published');
  if (academic_year_id) ttQb = ttQb.eq('academic_year_id', academic_year_id);
  if (semester_id) ttQb = ttQb.eq('semester_id', semester_id);
  const { data: tts } = await ttQb;
  const ttIds = (tts || []).map((t) => t.id);
  if (ttIds.length === 0) return [];

  const column = resource === 'room' ? 'room_id' : 'faculty_id';
  const { data: entries } = await supabase
    .from('timetable_entries')
    .select(column)
    .in('timetable_id', ttIds)
    .in('time_slot_id', slotIds);
  return (entries || []).map((e) => e[column]);
}

reportRouter.get('/free-rooms', requireRoles('admin', 'hod', 'faculty'), validateQuery(freeQuery), async (req, res, next) => {
  try {
    const busy = await busyResourceIds(req.query, 'room');
    const { data, error } = await supabase
      .from('rooms')
      .select('*, department:departments(code, name)')
      .eq('is_active', true)
      .eq('is_available', true);
    if (error) throw error;
    const free = (data || []).filter((r) => !busy.includes(r.id));
    return ok(res, free, 'Free rooms at requested period');
  } catch (err) {
    return next(fromDbError(err));
  }
});

reportRouter.get('/free-faculty', requireRoles('admin', 'hod'), validateQuery(freeQuery), async (req, res, next) => {
  try {
    const busy = await busyResourceIds(req.query, 'faculty');
    let qb = supabase.from('faculty').select('*, department:departments(code, name)').eq('is_active', true);
    if (req.user.role === 'hod') qb = qb.eq('department_id', req.user.department_id);
    const { data, error } = await qb;
    if (error) throw error;
    const free = (data || []).filter((f) => !busy.includes(f.id));
    return ok(res, free, 'Free faculty at requested period');
  } catch (err) {
    return next(fromDbError(err));
  }
});

// ---------------------------------------------------------------------------
// Shared export bundle
// ---------------------------------------------------------------------------
async function loadTimetableBundle(id) {
  const { data: tt, error: ttErr } = await supabase
    .from('timetable')
    .select('*, academic_year:academic_years(name), semester:semesters(name), course:courses(name, department_id)')
    .eq('id', id)
    .maybeSingle();
  if (ttErr) throw ttErr;
  if (!tt) throw notFound('Timetable not found');

  const { data: entries } = await supabase
    .from('timetable_entries')
    .select(
      `id, session_type,
       division:divisions(name, strength),
       room:rooms(room_number, room_name, room_type),
       time_slot:time_slots(period_number, start_time, end_time, is_break, working_day:working_days(name, day_number)),
       mapping:faculty_subjects!inner(subject_id, faculty_id, faculty:faculty(name, employee_id), subject:subjects(code, name))`
    )
    .eq('timetable_id', id);

  return { tt, entries: entries || [] };
}

async function institution() {
  const { data } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
  return data || { institution_name: 'Education Institute' };
}

async function assureAccess(req, tt) {
  if (req.user.role === 'hod' && !departmentScopeMatches(req.user, tt.course?.department_id)) {
    throw forbidden('You do not have access to this timetable');
  }
}

// ---------------------------------------------------------------------------
// PDF export
// ---------------------------------------------------------------------------
reportRouter.get('/timetable/:id/pdf', requireRoles('admin', 'hod', 'faculty'), async (req, res, next) => {
  try {
    const { tt, entries } = await loadTimetableBundle(req.params.id);
    await assureAccess(req, tt);
    const org = await institution();

    const { data: allSlots } = await supabase
      .from('time_slots')
      .select('id, period_number, start_time, end_time, working_day:working_days(name, day_number)')
      .eq('is_break', false)
      .order('period_number');

    const periodSet = new Set((allSlots || []).map((s) => s.period_number));
    const dayNames = [...new Set((allSlots || []).map((s) => s.working_day?.name).filter(Boolean))];

    const grid = new Map();
    for (const e of entries) {
      const day = e.time_slot?.working_day?.name;
      const pn = e.time_slot?.period_number;
      if (!day || !pn) continue;
      if (!grid.has(day)) grid.set(day, new Map());
      grid.get(day).set(pn, {
        subject: `${e.mapping?.subject?.code || ''} ${e.mapping?.subject?.name || ''}`,
        faculty: e.mapping?.faculty?.name || '',
        room: e.room?.room_number || '',
        type: e.session_type || '',
      });
    }

    const periods = [...periodSet].sort((a, b) => a - b);
    const columnWidth = 96;
    const colCount = periods.length + 1;
    const tableWidth = colCount * columnWidth;
    const rowHeight = 92;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="timetable-${req.params.id}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    doc.pipe(res);

    doc.fontSize(16).text(org.institution_name || 'Educational Institute', { align: 'center' });
    doc.fontSize(11).text(`Timetable — ${tt.academic_year?.name} | ${tt.semester?.name} | ${tt.course?.name}`, { align: 'center' });
    doc.fontSize(9).text(`Status: ${tt.status}  •  Generated: ${new Date().toISOString().split('T')[0]}`, { align: 'center' });
    doc.moveDown(0.8);

    const y0 = 120;
    const day0 = 130 + rowHeight;

    // header row
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text('Day', 36, day0 - rowHeight + 10, { width: 84 });
    periods.forEach((p, idx) => {
      const s = allSlots?.find((x) => x.period_number === p);
      const label = s ? `${s.start_time}\n${s.end_time}` : `P${p}`;
      doc.fontSize(7.5);
      doc.text(`P${p} — ${label}`, 30 + columnWidth * (idx + 1) + 8, day0 - rowHeight + 8, { width: columnWidth - 16, align: 'center' });
    });

    // body
    doc.font('Helvetica');
    dayNames.forEach((day, rowIdx) => {
      const y = day0 + rowIdx * rowHeight;
      doc.font('Helvetica-Bold').fontSize(9).text(day, 36, y + 8, { width: 80 });
      periods.forEach((p, idx) => {
        const cell = grid.get(day)?.get(p);
        if (!cell) return;
        const cx = 30 + columnWidth * (idx + 1);
        doc.fontSize(7);
        doc.text(cell.subject, cx + 6, y + 6, { width: columnWidth - 12, lineBreak: true });
        doc.fontSize(6.5);
        doc.text(cell.faculty, cx + 6, y + 30, { width: columnWidth - 12 });
        doc.text(`${cell.room} · ${cell.type}`, cx + 6, y + 46, { width: columnWidth - 12 });
      });
    });

    // borders
    const yBottom = day0 + dayNames.length * rowHeight;
    doc.rect(30, y0, tableWidth, yBottom - y0).stroke();
    for (let i = 1; i <= dayNames.length; i++) {
      doc.moveTo(30, y0 + rowHeight * i).lineTo(30 + tableWidth, y0 + rowHeight * i).stroke();
    }
    for (let i = 1; i < colCount; i++) {
      doc.moveTo(30 + columnWidth * i, y0).lineTo(30 + columnWidth * i, yBottom).stroke();
    }

    doc.fontSize(7).text(
      `Academic Year: ${tt.academic_year?.name} | Semester: ${tt.semester?.name} | Status: ${tt.status} | Institution: ${org.institution_name}`,
      30, yBottom + 12
    );
    doc.end();
  } catch (err) {
    return next(fromDbError(err));
  }
});

// ---------------------------------------------------------------------------
// Excel export
// ---------------------------------------------------------------------------
reportRouter.get('/timetable/:id/excel', requireRoles('admin', 'hod', 'faculty'), async (req, res, next) => {
  try {
    const { tt, entries } = await loadTimetableBundle(req.params.id);
    await assureAccess(req, tt);
    const org = await institution();

    const { data: allSlots } = await supabase
      .from('time_slots')
      .select('id, period_number, start_time, end_time, working_day:working_days(name, day_number)')
      .eq('is_break', false)
      .order('period_number');

    const periodSet = [...new Set((allSlots || []).map((s) => s.period_number))].sort((a, b) => a - b);
    const dayNames = [...new Set((allSlots || []).map((s) => s.working_day?.name).filter(Boolean))];

    const grid = new Map();
    for (const e of entries) {
      const day = e.time_slot?.working_day?.name;
      const pn = e.time_slot?.period_number;
      if (!day || !pn) continue;
      if (!grid.has(day)) grid.set(day, new Map());
      grid.get(day).set(pn, `${e.mapping?.subject?.code} | ${e.mapping?.subject?.name}\n${e.mapping?.faculty?.name}\n${e.room?.room_number} (${e.session_type})`);
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Timetable');

    const columns = [
      { header: 'Day', key: 'day', width: 14 },
      ...periodSet.map((p) => {
        const s = allSlots?.find((x) => x.period_number === p);
        return { header: s ? `P${p} ${s.start_time}-${s.end_time}` : `P${p}`, key: `p${p}`, width: 32, wrapText: true };
      }),
    ];
    ws.columns = columns;

    ws.addRow({ day: org.institution_name || 'Educational Institute' });
    ws.addRow({ day: `Timetable — ${tt.academic_year?.name} | ${tt.semester?.name} | ${tt.course?.name} | Status: ${tt.status}` });
    ws.addRow(Object.fromEntries(columns.map((c) => [c.key, c.header])));

    for (const day of dayNames) {
      const row = { day };
      for (const p of periodSet) row[`p${p}`] = grid.get(day)?.get(p) || '';
      ws.addRow(row);
    }

    ws.getRow(1).font = { bold: true, size: 14 };
    ws.getRow(2).font = { bold: true };
    ws.getRow(3).font = { bold: true };
    ws.getRow(3).height = 32;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="timetable-${req.params.id}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  } catch (err) {
    return next(fromDbError(err));
  }
});

// ---------------------------------------------------------------------------
// Lesson plan & attendance reports (JSON)
// ---------------------------------------------------------------------------
reportRouter.get('/lesson-plans', requireRoles('admin', 'hod', 'faculty'), validateQuery(filterQuery), async (req, res, next) => {
  try {
    let qb = supabase
      .from('lesson_plans')
      .select('*, academic_year:academic_years(name), semester:semesters(name), course:courses(name), division:divisions(name), faculty:faculty(name), subject:subjects(code, name)')
      .order('planned_date');
    qb = await applyScope(qb, req.user, 'lesson_plans');
    if (req.query.academic_year_id) qb = qb.eq('academic_year_id', req.query.academic_year_id);
    if (req.query.semester_id) qb = qb.eq('semester_id', req.query.semester_id);
    if (req.query.division_id) qb = qb.eq('division_id', req.query.division_id);
    const { data, error } = await qb;
    if (error) throw error;
    return ok(res, data || [], 'Lesson plan report');
  } catch (err) {
    return next(fromDbError(err));
  }
});

reportRouter.get('/attendance', requireRoles('admin', 'hod', 'faculty'), validateQuery(filterQuery), async (req, res, next) => {
  try {
    let qb = supabase
      .from('attendance')
      .select('*, faculty:faculty(name), subject:subjects(code, name), division:divisions(name)')
      .order('date', { ascending: false });
    qb = await applyScope(qb, req.user, 'attendance');
    if (req.query.academic_year_id) qb = qb.eq('academic_year_id', req.query.academic_year_id);
    if (req.query.faculty_id) qb = qb.eq('faculty_id', req.query.faculty_id);
    const { data, error } = await qb;
    if (error) throw error;
    return ok(res, data || [], 'Attendance report');
  } catch (err) {
    return next(fromDbError(err));
  }
});

reportRouter.get('/conflicts/:id', requireAdminOrHod, async (req, res, next) => {
  try {
    const { data: tt } = await supabase
      .from('timetable')
      .select('id, course:courses(id, department_id)')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!tt) throw notFound('Timetable not found');
    if (req.user.role === 'hod' && !departmentScopeMatches(req.user, tt.course?.department_id)) {
      throw forbidden('You do not have access to this timetable');
    }
    const { validateTimetable } = await import('../services/timetableValidator.js');
    const result = await validateTimetable(req.params.id);
    return ok(res, result.conflicts, result.valid ? 'No conflicts found' : 'Conflicts found');
  } catch (err) {
    return next(fromDbError(err));
  }
});