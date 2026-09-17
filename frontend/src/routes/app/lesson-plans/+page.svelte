<script>
  import { onMount } from 'svelte';
  import {
    listLessonPlans,
    createLessonPlan,
    updateLessonPlan,
    deleteLessonPlan,
    transitionLessonPlan,
    listAcademicYears,
    listSemesters,
    listCourses,
    listDivisions,
    listFaculty,
    listSubjects,
  } from '$lib/data';
  import { user, notify } from '$lib/stores';
  import Table from '$lib/components/Table.svelte';

  const STATUS_BADGE = {
    draft: 'badge-draft',
    submitted: 'badge-pending_approval',
    approved: 'badge-approved',
    rejected: 'badge-rejected',
  };

  let items = [];
  let years = [];
  let semesters = [];
  let courses = [];
  let divisions = [];
  let facultyAll = [];
  let subjects = [];
  let error = '';
  let loading = true;

  let filters = { academic_year_id: '', semester_id: '', division_id: '', subject_id: '', faculty_id: '', status: '' };
  let form = {
    academic_year_id: '',
    semester_id: '',
    course_id: '',
    division_id: '',
    faculty_id: '',
    subject_id: '',
    unit: '',
    topic: '',
    lesson_number: 1,
    planned_date: '',
    period_number: '',
    start_time: '09:00',
    end_time: '10:00',
    teaching_method: '',
    remarks: '',
  };
  let editing = null;
  let me = null;

  async function load() {
    loading = true;
    try {
      [items, years, semesters, courses, divisions, facultyAll, subjects] = await Promise.all([
        listLessonPlans(filters),
        listAcademicYears(),
        listSemesters(),
        listCourses(),
        listDivisions(),
        listFaculty(),
        listSubjects(),
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
      academic_year_id: '',
      semester_id: '',
      course_id: '',
      division_id: '',
      faculty_id: me?.role === 'faculty' ? (me.faculty_id || '') : '',
      subject_id: '',
      unit: '',
      topic: '',
      lesson_number: 1,
      planned_date: '',
      period_number: '',
      start_time: '09:00',
      end_time: '10:00',
      teaching_method: '',
      remarks: '',
    };
    editing = null;
  }

  function startEdit(item) {
    editing = item;
    form = {
      academic_year_id: item.academic_year_id || '',
      semester_id: item.semester_id || '',
      course_id: item.course_id || '',
      division_id: item.division_id || '',
      faculty_id: item.faculty_id || '',
      subject_id: item.subject_id || '',
      unit: item.unit || '',
      topic: item.topic || '',
      lesson_number: item.lesson_number,
      planned_date: item.planned_date || '',
      period_number: item.period_number ?? '',
      start_time: (item.start_time || '09:00').slice(0, 5),
      end_time: (item.end_time || '10:00').slice(0, 5),
      teaching_method: item.teaching_method || '',
      remarks: item.remarks || '',
    };
  }

  async function save(e) {
    e.preventDefault();
    error = '';
    try {
      const body = {
        academic_year_id: form.academic_year_id || null,
        semester_id: form.semester_id || null,
        course_id: form.course_id || null,
        division_id: form.division_id || null,
        faculty_id: form.faculty_id || null,
        subject_id: form.subject_id || null,
        unit: form.unit,
        topic: form.topic,
        lesson_number: Number(form.lesson_number),
        planned_date: form.planned_date || null,
        period_number: form.period_number === '' ? null : Number(form.period_number),
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        teaching_method: form.teaching_method || null,
        remarks: form.remarks || null,
      };
      if (editing) {
        await updateLessonPlan(editing.id, body);
        notify('Updated', 'success');
      } else {
        await createLessonPlan(body);
        notify('Created', 'success');
      }
      reset();
      await load();
    } catch (err) { error = err.message; }
  }

  async function remove(item) {
    if (!confirm(`Delete "${item.topic}"?`)) return;
    try {
      await deleteLessonPlan(item.id);
      notify('Deleted', 'success');
      await load();
    } catch (err) { error = err.message; }
  }

  async function act(item, action, label) {
    try {
      await transitionLessonPlan(item.id, action);
      notify(label, 'success');
      await load();
    } catch (err) { error = err.message; }
  }

  function statusRowButtons(item) {
    const btns = [{ label: 'Edit', onClick: startEdit }];
    if (item.status === 'draft') btns.push({ label: 'Submit', class: 'btn-primary', onClick: (r) => act(r, 'submit', 'Submitted') });
    if (item.status === 'submitted' && (me?.role === 'admin' || me?.role === 'hod')) {
      btns.push({ label: 'Approve', class: 'btn-success', onClick: (r) => act(r, 'approve', 'Approved') });
      btns.push({ label: 'Reject', class: 'btn-danger', onClick: (r) => act(r, 'reject', 'Rejected') });
    }
    if ((item.status === 'submitted' && (me?.role === 'admin' || me?.role === 'hod' || me?.role === 'faculty')) || item.status === 'approved') {
      btns.push({ label: 'Delete', class: 'btn-danger', onClick: remove });
    }
    return btns;
  }
</script>

<h1>Lesson Plans</h1>
{#if error}<div class="error-box">{error}</div>{/if}

<div class="card" style="margin:14px 0">
  <h2>Filters</h2>
  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
    <div class="field">
      <label for="lp-f-ay">Academic year</label>
      <select id="lp-f-ay" bind:value={filters.academic_year_id} on:change={load}>
        <option value="">All</option>
        {#each years as y}<option value={y.id}>{y.name}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="lp-f-sem">Semester</label>
      <select id="lp-f-sem" bind:value={filters.semester_id} on:change={load}>
        <option value="">All</option>
        {#each semesters as s}<option value={s.id}>{s.name}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="lp-f-div">Division</label>
      <select id="lp-f-div" bind:value={filters.division_id} on:change={load}>
        <option value="">All</option>
        {#each divisions as d}<option value={d.id}>{d.name}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="lp-f-sub">Subject</label>
      <select id="lp-f-sub" bind:value={filters.subject_id} on:change={load}>
        <option value="">All</option>
        {#each subjects as s}<option value={s.id}>{s.code} — {s.name}</option>{/each}
      </select>
    </div>
    {#if me?.role !== 'faculty'}
      <div class="field">
        <label for="lp-f-fac">Faculty</label>
        <select id="lp-f-fac" bind:value={filters.faculty_id} on:change={load}>
          <option value="">All</option>
          {#each facultyAll as f}<option value={f.id}>{f.name}</option>{/each}
        </select>
      </div>
    {/if}
    <div class="field">
      <label for="lp-f-status">Status</label>
      <select id="lp-f-status" bind:value={filters.status} on:change={load}>
        <option value="">All</option>
        <option value="draft">Draft</option>
        <option value="submitted">Submitted</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
      </select>
    </div>
    <button type="button" on:click={() => { filters = { academic_year_id: '', semester_id: '', division_id: '', subject_id: '', faculty_id: me?.role === 'faculty' ? (me.faculty_id || '') : '', status: '' }; load(); }}>Reset</button>
  </div>
</div>

<div class="card" style="margin:0 0 14px">
  <h2>{editing ? 'Edit' : 'New'} lesson plan</h2>
  <form on:submit={save}>
    <div class="grid">
      <div class="field">
        <label for="lp-ay">Academic year</label>
        <select id="lp-ay" bind:value={form.academic_year_id} required>
          <option value="">— select —</option>
          {#each years as y}<option value={y.id}>{y.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="lp-sem">Semester</label>
        <select id="lp-sem" bind:value={form.semester_id} required>
          <option value="">— select —</option>
          {#each semesters as s}<option value={s.id}>{s.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="lp-course">Course</label>
        <select id="lp-course" bind:value={form.course_id} required>
          <option value="">— select —</option>
          {#each courses as c}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="lp-div">Division</label>
        <select id="lp-div" bind:value={form.division_id} required>
          <option value="">— select —</option>
          {#each divisions as d}<option value={d.id}>{d.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="lp-fac">Faculty</label>
        <select id="lp-fac" bind:value={form.faculty_id} required disabled={me?.role === 'faculty'}>
          <option value="">— select —</option>
          {#each facultyAll as f}<option value={f.id}>{f.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="lp-sub">Subject</label>
        <select id="lp-sub" bind:value={form.subject_id} required>
          <option value="">— select —</option>
          {#each subjects as s}<option value={s.id}>{s.code} — {s.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="lp-unit">Unit</label>
        <input id="lp-unit" bind:value={form.unit} />
      </div>
      <div class="field">
        <label for="lp-topic">Topic</label>
        <input id="lp-topic" bind:value={form.topic} required />
      </div>
      <div class="field">
        <label for="lp-num">Lesson number</label>
        <input id="lp-num" type="number" min="1" bind:value={form.lesson_number} required />
      </div>
      <div class="field">
        <label for="lp-date">Planned date</label>
        <input id="lp-date" type="date" bind:value={form.planned_date} />
      </div>
      <div class="field">
        <label for="lp-period">Period number</label>
        <input id="lp-period" type="number" min="1" bind:value={form.period_number} />
      </div>
      <div class="field">
        <label for="lp-method">Teaching method</label>
        <input id="lp-method" bind:value={form.teaching_method} />
      </div>
      <div class="field">
        <label for="lp-start">Start</label>
        <input id="lp-start" type="time" bind:value={form.start_time} />
      </div>
      <div class="field">
        <label for="lp-end">End</label>
        <input id="lp-end" type="time" bind:value={form.end_time} />
      </div>
      <div class="field">
        <label for="lp-remarks">Remarks</label>
        <input id="lp-remarks" bind:value={form.remarks} />
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
        { key: 'lesson_number', label: '#' },
        { key: 'topic', label: 'Topic', render: (r) => r.unit ? `${r.unit} — ${r.topic}` : r.topic },
        { key: 'subject', label: 'Subject', render: (r) => r.subject?.code || r.subject?.name || '—' },
        { key: 'division', label: 'Division', render: (r) => r.division?.name || '—' },
        { key: 'faculty', label: 'Faculty', render: (r) => r.faculty?.name || '—' },
        { key: 'planned_date', label: 'Planned', render: (r) => r.planned_date || '—' },
        { key: 'status', label: 'Status', render: (r) => `<span class="badge ${STATUS_BADGE[r.status] || 'badge-draft'}">${r.status}</span>` },
      ]}
      items={items}
      rowButtons={statusRowButtons}
    />
  {/if}
</div>