<script>
  import { onMount } from 'svelte';
  import {
    listAttendance,
    createAttendance,
    updateAttendance,
    deleteAttendance,
    listFaculty,
    listSubjects,
    listDivisions,
    listAcademicYears,
  } from '$lib/data';
  import { user, notify } from '$lib/stores';
  import Table from '$lib/components/Table.svelte';

  const STATUS_BADGE = {
    present: 'badge-approved',
    absent: 'badge-rejected',
    leave: 'badge-pending_approval',
  };

  let items = [];
  let facultyAll = [];
  let subjects = [];
  let divisions = [];
  let years = [];
  let error = '';
  let loading = true;
  let me = null;

  let filters = { faculty_id: '', subject_id: '', division_id: '', status: '', date: '' };
  let form = {
    faculty_id: '',
    subject_id: '',
    division_id: '',
    academic_year_id: '',
    date: '',
    period_number: '',
    in_time: '',
    out_time: '',
    hours: '',
    status: 'present',
    remarks: '',
  };
  let editing = null;

  async function load() {
    loading = true;
    try {
      [items, facultyAll, subjects, divisions, years] = await Promise.all([
        listAttendance(filters),
        listFaculty(),
        listSubjects(),
        listDivisions(),
        listAcademicYears(),
      ]);
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    me = $user;
    if (me?.role === 'faculty' && me.faculty_id) {
      filters.faculty_id = me.faculty_id;
      form.faculty_id = me.faculty_id;
    }
    try { await load(); } catch (e) { error = e.message; }
  });

  function reset() {
    form = {
      faculty_id: me?.role === 'faculty' ? (me.faculty_id || '') : '',
      subject_id: '',
      division_id: '',
      academic_year_id: '',
      date: new Date().toISOString().slice(0, 10),
      period_number: '',
      in_time: '',
      out_time: '',
      hours: '',
      status: 'present',
      remarks: '',
    };
    editing = null;
  }

  function startEdit(item) {
    editing = item;
    form = {
      faculty_id: item.faculty_id || '',
      subject_id: item.subject_id || '',
      division_id: item.division_id || '',
      academic_year_id: item.academic_year_id || '',
      date: item.date || '',
      period_number: item.period_number ?? '',
      in_time: (item.in_time || '').slice(0, 5),
      out_time: (item.out_time || '').slice(0, 5),
      hours: item.hours ?? '',
      status: item.status,
      remarks: item.remarks || '',
    };
  }

  async function save(e) {
    e.preventDefault();
    error = '';
    try {
      const body = {
        faculty_id: form.faculty_id || null,
        subject_id: form.subject_id || null,
        division_id: form.division_id || null,
        academic_year_id: form.academic_year_id || null,
        date: form.date || null,
        period_number: form.period_number === '' ? null : Number(form.period_number),
        in_time: form.in_time || null,
        out_time: form.out_time || null,
        hours: form.hours === '' ? null : Number(form.hours),
        status: form.status,
        remarks: form.remarks || null,
      };
      if (editing) {
        await updateAttendance(editing.id, body);
        notify('Updated', 'success');
      } else {
        await createAttendance(body);
        notify('Created', 'success');
      }
      reset();
      await load();
    } catch (err) { error = err.message; }
  }

  async function remove(item) {
    if (!confirm(`Delete this attendance record?`)) return;
    try {
      await deleteAttendance(item.id);
      notify('Deleted', 'success');
      await load();
    } catch (err) { error = err.message; }
  }
</script>

<h1>Attendance</h1>
{#if error}<div class="error-box">{error}</div>{/if}

<div class="card" style="margin:14px 0">
  <h2>Filters</h2>
  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
    {#if me?.role !== 'faculty'}
      <div class="field">
        <label for="att-f-fac">Faculty</label>
        <select id="att-f-fac" bind:value={filters.faculty_id} on:change={load}>
          <option value="">All</option>
          {#each facultyAll as f}<option value={f.id}>{f.name}</option>{/each}
        </select>
      </div>
    {/if}
    <div class="field">
      <label for="att-f-sub">Subject</label>
      <select id="att-f-sub" bind:value={filters.subject_id} on:change={load}>
        <option value="">All</option>
        {#each subjects as s}<option value={s.id}>{s.code} — {s.name}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="att-f-div">Division</label>
      <select id="att-f-div" bind:value={filters.division_id} on:change={load}>
        <option value="">All</option>
        {#each divisions as d}<option value={d.id}>{d.name}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="att-f-status">Status</label>
      <select id="att-f-status" bind:value={filters.status} on:change={load}>
        <option value="">All</option>
        <option value="present">Present</option>
        <option value="absent">Absent</option>
        <option value="leave">Leave</option>
      </select>
    </div>
    <div class="field">
      <label for="att-f-date">Date</label>
      <input id="att-f-date" type="date" bind:value={filters.date} on:change={load} />
    </div>
    <button type="button" on:click={() => { filters = { faculty_id: me?.role === 'faculty' ? (me.faculty_id || '') : '', subject_id: '', division_id: '', status: '', date: '' }; load(); }}>Reset</button>
  </div>
</div>

<div class="card" style="margin:0 0 14px">
  <h2>{editing ? 'Edit' : 'New'} attendance record</h2>
  <form on:submit={save}>
    <div class="grid">
      <div class="field">
        <label for="att-fac">Faculty</label>
        <select id="att-fac" bind:value={form.faculty_id} required disabled={me?.role === 'faculty'}>
          <option value="">— select —</option>
          {#each facultyAll as f}<option value={f.id}>{f.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="att-sub">Subject</label>
        <select id="att-sub" bind:value={form.subject_id} required>
          <option value="">— select —</option>
          {#each subjects as s}<option value={s.id}>{s.code} — {s.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="att-div">Division</label>
        <select id="att-div" bind:value={form.division_id}>
          <option value="">— none —</option>
          {#each divisions as d}<option value={d.id}>{d.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="att-ay">Academic year</label>
        <select id="att-ay" bind:value={form.academic_year_id} required>
          <option value="">— select —</option>
          {#each years as y}<option value={y.id}>{y.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="att-date">Date</label>
        <input id="att-date" type="date" bind:value={form.date} required />
      </div>
      <div class="field">
        <label for="att-period">Period</label>
        <input id="att-period" type="number" min="1" bind:value={form.period_number} />
      </div>
      <div class="field">
        <label for="att-in">In time</label>
        <input id="att-in" type="time" bind:value={form.in_time} />
      </div>
      <div class="field">
        <label for="att-out">Out time</label>
        <input id="att-out" type="time" bind:value={form.out_time} />
      </div>
      <div class="field">
        <label for="att-hours">Hours</label>
        <input id="att-hours" type="number" min="0" step="0.5" bind:value={form.hours} />
      </div>
      <div class="field">
        <label for="att-status">Status</label>
        <select id="att-status" bind:value={form.status}>
          <option value="present">Present</option>
          <option value="absent">Absent</option>
          <option value="leave">Leave</option>
        </select>
      </div>
      <div class="field">
        <label for="att-remarks">Remarks</label>
        <input id="att-remarks" bind:value={form.remarks} />
      </div>
    </div>
    <button class="btn-primary" type="submit">{editing ? 'Save' : 'Create'}</button>
    {#if editing}<button type="button" on:click={reset}>Cancel</button>{/if}
  </form>
</div>

<div class="card">
  {#if loading}
    <p style="color:var(--muted)">Loading…</p>
  {:else}
    <Table
      columns={[
        { key: 'date', label: 'Date' },
        { key: 'faculty', label: 'Faculty', render: (r) => r.faculty?.name || '—' },
        { key: 'subject', label: 'Subject', render: (r) => r.subject?.code || r.subject?.name || '—' },
        { key: 'division', label: 'Division', render: (r) => r.division?.name || '—' },
        { key: 'period_number', label: 'Period', render: (r) => r.period_number || '—' },
        { key: 'hours', label: 'Hours', render: (r) => (r.hours ?? '') === '' ? '—' : Number(r.hours).toFixed(1) },
        { key: 'status', label: 'Status', render: (r) => `<span class="badge ${STATUS_BADGE[r.status] || 'badge-draft'}">${r.status}</span>` },
      ]}
      items={items}
      rowButtons={(item) => [
        { label: 'Edit', onClick: startEdit },
        { label: 'Delete', class: 'btn-danger', onClick: remove },
      ]}
    />
  {/if}
</div>