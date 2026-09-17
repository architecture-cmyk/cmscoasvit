<script>
  import { onMount } from 'svelte';
  import { getWorkloadReport, getAttendanceReport, countRows, getFacultyWorkload, listAcademicYears } from '$lib/data';
  import { user, notify } from '$lib/stores';
  import Table from '$lib/components/Table.svelte';

  let me = null;
  let years = [];
  let yearFilter = '';
  let workload = [];
  let attendance = { total: 0, present: 0, absent: 0, leave: 0, byMonth: [] };
  let timetableStatus = { draft: 0, pending_approval: 0, approved: 0, published: 0, archived: 0 };
  let own = null;
  let error = '';
  let loading = true;

  async function load() {
    loading = true;
    try {
      if (!yearFilter) {
        years = await listAcademicYears();
        yearFilter = years.find((y) => y.is_active)?.id || years[0]?.id || '';
      }
      [workload, attendance] = await Promise.all([
        getWorkloadReport(yearFilter || null),
        getAttendanceReport(yearFilter || null),
      ]);
      if (me?.role === 'faculty' && me.faculty_id) {
        own = await getFacultyWorkload(me.faculty_id);
      }
      if (me?.role === 'admin' || me?.role === 'hod') {
        const [draft, pending, approved, published, archived] = await Promise.all([
          countRows('timetable', { status: 'draft' }),
          countRows('timetable', { status: 'pending_approval' }),
          countRows('timetable', { status: 'approved' }),
          countRows('timetable', { status: 'published' }),
          countRows('timetable', { status: 'archived' }),
        ]);
        timetableStatus = { draft, pending_approval: pending, approved, published, archived };
      }
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    me = $user;
    try { await load(); } catch (e) { error = e.message; }
  });

  async function changeYear(e) {
    e.preventDefault();
    error = '';
    try { await load(); } catch (err) { error = err.message; }
  }
</script>

<h1>Reports</h1>
{#if error}<div class="error-box">{error}</div>{/if}

<div class="card" style="margin:14px 0">
  <h2>Academic year</h2>
  <form on:submit={changeYear} style="display:flex;gap:10px;align-items:flex-end">
    <div class="field" style="margin:0">
      <label for="rep-year">Year</label>
      <select id="rep-year" bind:value={yearFilter}>
        <option value="">All years</option>
        {#each years as y}<option value={y.id}>{y.name}</option>{/each}
      </select>
    </div>
    <button class="btn-primary" type="submit">Apply</button>
  </form>
</div>

{#if loading}
  <p style="color:var(--muted)">Loading…</p>
{:else}
  {#if me?.role === 'faculty'}
    <div class="card" style="margin:14px 0">
      <h2>My workload</h2>
      {#if own}
        <div class="stat"><div class="num">{Number(own.total_hours || 0).toFixed(1)}</div><div class="lbl">Hours this term</div></div>
        <p style="margin-top:10px">
          Lecture <b>{Number(own.lecture_hours || 0).toFixed(1)}</b> ·
          Tutorial <b>{Number(own.tutorial_hours || 0).toFixed(1)}</b> ·
          Practical <b>{Number(own.practical_hours || 0).toFixed(1)}</b>
          {#if own.load_percent != null}
            — {own.load_percent}% of max ({Number(own.faculty?.maximum_weekly_load || 0).toFixed(1)} hrs)
          {/if}
        </p>
      {:else}
        <p style="color:var(--muted)">No workload computed for this year.</p>
      {/if}
    </div>
  {/if}

  {#if me?.role === 'admin' || me?.role === 'hod'}
    <div class="grid" style="margin:0 0 14px">
      <div class="stat"><div class="num">{timetableStatus.published}</div><div class="lbl">Published timetables</div></div>
      <div class="stat"><div class="num">{timetableStatus.pending_approval}</div><div class="lbl">Pending approval</div></div>
      <div class="stat"><div class="num">{attendance.total}</div><div class="lbl">Attendance records</div></div>
      <div class="stat"><div class="num">{attendance.present} / {attendance.absent} / {attendance.leave}</div><div class="lbl">Present / Absent / Leave</div></div>
    </div>

    <div class="card" style="margin:0 0 14px">
      <h2>Faculty workload</h2>
      <Table
        columns={[
          { key: 'name', label: 'Faculty', render: (r) => r.faculty?.name || '—' },
          { key: 'dept', label: 'Department', render: (r) => r.faculty?.department?.name || r.faculty?.department_id || '—' },
          { key: 'term', label: 'Term', render: (r) => `${r.academic_year?.name || ''} / ${r.semester?.name || ''}`.trim() || '—' },
          { key: 'total_hours', label: 'Total hrs', render: (r) => Number(r.total_hours || 0).toFixed(1) },
          { key: 'lec', label: 'L', render: (r) => Number(r.lecture_hours || 0).toFixed(1) },
          { key: 'tut', label: 'T', render: (r) => Number(r.tutorial_hours || 0).toFixed(1) },
          { key: 'pra', label: 'P', render: (r) => Number(r.practical_hours || 0).toFixed(1) },
          { key: 'max', label: 'Max', render: (r) => Number(r.faculty?.maximum_weekly_load || 0).toFixed(1) },
          { key: 'load', label: 'Load %', render: (r) => (r.load_percent == null ? '—' : `${r.load_percent}%`) },
          { key: 'over', label: 'Overloaded', render: (r) => r.overloaded ? '<b style="color:var(--danger)">⚠ yes</b>' : 'no' },
        ]}
        items={workload}
        empty="No workload records yet — approve/publish timetables to compute them."
      />
    </div>

    <div class="card">
      <h2>Attendance by month</h2>
      {#if attendance.byMonth.length}
        <Table
          columns={[
            { key: 'month', label: 'Month' },
            { key: 'count', label: 'Records' },
          ]}
          items={attendance.byMonth.map(([month, count]) => ({ month, count }))}
          empty="No attendance records yet."
        />
      {:else}
        <p style="color:var(--muted)">No attendance records for this period.</p>
      {/if}
    </div>
  {/if}
{/if}