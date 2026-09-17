<script>
  import { onMount } from 'svelte';
  import { listTimetables, listOptions, generateTimetable } from '$lib/data';
  import { notify } from '$lib/stores';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores';
  import Table from '$lib/components/Table.svelte';

  let tts = [];
  let error = '';
  let busy = false;
  let filters = { status: '', course_id: '', academic_year_id: '' };

  // Generate form state
  let showForm = false;
  let years = [], sems = [], courses = [], divisions = [], days = [], slots = [];
  let form = {
    academic_year_id: '', semester_id: '', course_id: '',
    division_ids: [], working_day_ids: [], time_slot_ids: [],
    replace_existing_draft: false, seed: '',
  };
  let genResult = null;

  async function loadTT() {
    const q = {};
    if (filters.status) q.status = filters.status;
    if (filters.course_id) q.course_id = filters.course_id;
    if (filters.academic_year_id) q.academic_year_id = filters.academic_year_id;
    tts = await listTimetables(q);
  }

  async function loadOptions() {
    const o = await listOptions();
    years = o.years; sems = o.semesters; courses = o.courses; divisions = o.divisions;
    days = o.workingDays; slots = o.timeSlots;
    const active = years.find((x) => x.is_active);
    if (active) {
      form.academic_year_id = active.id;
      applyYear();
    }
  }

  function applyYear() {
    form.semester_id = '';
    form.course_id = '';
    form.division_ids = [];
  }

  $: filteredSem = form.academic_year_id ? sems.filter((s) => s.academic_year_id === form.academic_year_id) : sems;
  $: filteredDiv = (form.course_id && form.academic_year_id && form.semester_id)
    ? divisions.filter((d) => d.course_id === form.course_id && d.academic_year_id === form.academic_year_id && d.semester_id === form.semester_id)
    : [];
  $: activeDays = days.filter((d) => d.is_active);
  $: activeSlots = slots.filter((s) => s.is_active && !s.is_break);

  function toggle(arr, id) {
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(id);
    arr = arr.slice();
    return arr;
  }

  onMount(async () => {
    await loadTT().catch((e) => (error = e.message));
    if ($user?.role === 'admin') await loadOptions().catch((e) => (error = e.message));
  });

  async function generate(e) {
    e.preventDefault();
    error = '';
    busy = true;
    genResult = null;
    try {
      const body = { ...form };
      body.seed = form.seed === '' ? null : Number(form.seed);
      if (!body.division_ids.length || !body.working_day_ids.length || !body.time_slot_ids.length) {
        throw new Error('Select at least one division, working day and time slot.');
      }
      const result = await generateTimetable(body);
      genResult = result;
      notify('Timetable generated as draft', 'success');
      await loadTT();
      showForm = false;
    } catch (em) {
      error = em.conflicts?.length ? em.message + '\n- ' + em.conflicts.map((c) => c.detail).join('\n- ') : em.message;
    } finally {
      busy = false;
    }
  }

  const statusBadge = (s) => `<span class="badge badge-${s}">${s}</span>`;
</script>

<h1>Timetables</h1>

<div style="display:flex;gap:10px;align-items:center;margin:14px 0">
  <select bind:value={filters.status}>
    <option value="">All statuses</option>
    <option value="draft">Draft</option>
    <option value="pending_approval">Pending approval</option>
    <option value="approved">Approved</option>
    <option value="published">Published</option>
    <option value="archived">Archived</option>
  </select>
  {#if $user?.role === 'admin'}
    <button class="btn-primary" on:click={() => { showForm = !showForm; genResult = null; }}>＋ Generate</button>
  {/if}
  <button on:click={loadTT}>Refresh</button>
</div>

{#if error}<div class="error-box">{error}</div>{/if}

{#if showForm}
  <div class="card" style="margin-bottom:18px">
    <h2>Generate new timetable (draft)</h2>
    <form on:submit={generate} style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">
      <div class="field">
        <label for="tt-year">Academic year</label>
        <select id="tt-year" bind:value={form.academic_year_id} on:change={applyYear}>
          {#each years as y}<option value={y.id}>{y.name}{y.is_active ? ' (active)' : ''}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="tt-semester">Semester</label>
        <select id="tt-semester" bind:value={form.semester_id}>
          <option value="">—</option>
          {#each filteredSem as s}<option value={s.id}>{s.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="tt-course">Course</label>
        <select id="tt-course" bind:value={form.course_id}>
          <option value="">—</option>
          {#each courses as c}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <span class="group-label">Working days</span>
        {#each activeDays as d}
          <label for={`tt-working-day-${d.id}`} style="font-weight:400"><input id={`tt-working-day-${d.id}`} type="checkbox" checked={form.working_day_ids.includes(d.id)} on:change={() => (form.working_day_ids = toggle(form.working_day_ids, d.id))} /> {d.name}</label>
        {/each}
      </div>
      <div class="field">
        <span class="group-label">Divisions</span>
        {#each filteredDiv as d}
          <label for={`tt-division-${d.id}`} style="font-weight:400"><input id={`tt-division-${d.id}`} type="checkbox" checked={form.division_ids.includes(d.id)} on:change={() => (form.division_ids = toggle(form.division_ids, d.id))} /> {d.name}</label>
        {/each}
        {#if filteredDiv.length === 0}<span style="color:var(--muted);font-size:12px">Select year/semester/course first.</span>{/if}
      </div>
      <div class="field">
        <span class="group-label">Time slots (periods)</span>
        {#each activeSlots as s}
          <label for={`tt-slot-${s.id}`} style="font-weight:400"><input id={`tt-slot-${s.id}`} type="checkbox" checked={form.time_slot_ids.includes(s.id)} on:change={() => (form.time_slot_ids = toggle(form.time_slot_ids, s.id))} /> P{s.period_number} {s.start_time}-{s.end_time}</label>
        {/each}
      </div>
      <div class="field">
        <label for="tt-seed">Seed (optional, for reproducible output)</label>
        <input id="tt-seed" type="number" bind:value={form.seed} />
      </div>
      <div class="field">
        <label for="tt-replace-draft" style="font-weight:400"><input id="tt-replace-draft" type="checkbox" bind:checked={form.replace_existing_draft} /> Replace existing draft(s) for this period</label>
      </div>
      <div>
        <button class="btn-primary" type="submit" disabled={busy}>{busy ? 'Generating…' : 'Generate'}</button>
      </div>
    </form>

    {#if genResult}
      <div class="card" style="margin-top:14px;background:#f0fdf4">
        <b>Generated {genResult.scheduled_entries} entries</b> (status: {genResult.status}, divisions: {genResult.division_count})
        {#if genResult.unscheduled_requirements?.length}
          <div class="error-box">Unscheduled: {genResult.unscheduled_requirements.map((u) => `${u.subject_code} (${u.session_type}) — ${u.reason}`).join('\n')}</div>
        {/if}
        {#if genResult.timetable_id}
          <button class="btn-sm" on:click={() => goto(`/app/timetables/${genResult.timetable_id}`)}>View →</button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<div class="card">
  <Table
    columns={[
      { key: 'name', label: 'Course', render: (r) => r.course?.name || '—' },
      { key: 'academic_year', label: 'Academic Year', render: (r) => r.academic_year?.name || '—' },
      { key: 'semester', label: 'Semester', render: (r) => r.semester?.name || '—' },
      { key: 'status', label: 'Status', render: (r) => `<span class="badge badge-${r.status}">${r.status}</span>` },
      { key: 'entry_count', label: 'Entries', render: (r) => r.entry_count ?? r.entries?.length ?? 0 },
      { key: 'created_at', label: 'Created', render: (r) => (r.created_at || '').slice(0, 10) },
      { key: 'actions', label: '', render: (r) => `<button class="btn-sm">Open</button>` },
    ]}
    items={tts}
    empty="No timetables yet. Generate one to start."
  />
</div>

{#if tts.length}
<div class="card" style="margin-top:14px">
  <h2>Open a timetable</h2>
  {#each tts as t}
    <button class="btn-sm" on:click={() => goto(`/app/timetables/${t.id}`)}>
      {t.course?.name} · {t.academic_year?.name} · {t.semester?.name} [{t.status}]
    </button>
    <span> </span>
  {/each}
</div>
{/if}

{#if error.length > 0}
  <div class="error-box" style="white-space:pre-wrap">{error}</div>
{/if}