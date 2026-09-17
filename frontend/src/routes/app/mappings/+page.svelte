<script>
  import { onMount } from 'svelte';
  import {
    listMappings,
    createMapping,
    updateMapping,
    deleteMapping,
    listFaculty,
    listSubjects,
    listDivisions,
    listAcademicYears,
    importRows,
    excelVal,
    excelBool,
  } from '$lib/data';
  import { notify } from '$lib/stores';
  import Table from '$lib/components/Table.svelte';
  import ExcelImport from '$lib/components/ExcelImport.svelte';

  let items = [];
  let faculty = [];
  let subjects = [];
  let divisions = [];
  let years = [];
  let error = '';
  let form = { faculty_id: '', subject_id: '', division_id: '', academic_year_id: '', is_active: true };
  let editing = null;

  async function load() {
    [items, faculty, subjects, divisions, years] = await Promise.all([
      listMappings(),
      listFaculty(),
      listSubjects(),
      listDivisions(),
      listAcademicYears(),
    ]);
  }

  onMount(async () => { try { await load(); } catch (e) { error = e.message; } });

  function reset() {
    form = { faculty_id: '', subject_id: '', division_id: '', academic_year_id: '', is_active: true };
    editing = null;
  }

  function startEdit(item) {
    editing = item;
    form = {
      faculty_id: item.faculty_id || '',
      subject_id: item.subject_id || '',
      division_id: item.division_id || '',
      academic_year_id: item.academic_year_id || '',
      is_active: item.is_active,
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
        is_active: form.is_active,
      };
      if (editing) {
        await updateMapping(editing.id, body);
        notify('Updated', 'success');
      } else {
        await createMapping(body);
        notify('Created', 'success');
      }
      reset();
      await load();
    } catch (err) { error = err.message; }
  }

  async function remove(item) {
    if (!confirm('Delete this mapping?')) return;
    try {
      await deleteMapping(item.id);
      notify('Deleted', 'success');
      await load();
    } catch (err) { error = err.message; }
  }

  const importColumns = [
    { key: 'employee_id', header: 'Employee ID', sample: 'EMP001' },
    { key: 'subject_code', header: 'Subject Code', sample: 'CS201' },
    { key: 'division_name', header: 'Division Name', sample: 'CSE-A' },
    { key: 'academic_year_name', header: 'Academic Year Name', sample: '2026-2027' },
    { key: 'active', header: 'Active', sample: 'TRUE' },
  ];

  async function onImport(rows) {
    return importRows(rows, async (row) => {
      const empId = excelVal(row['Employee ID']);
      const f = faculty.find((x) => x.employee_id === empId);
      if (!f) throw new Error(`Unknown employee ID "${empId}"`);
      const subCode = excelVal(row['Subject Code']);
      const sub = subjects.find((x) => x.code === subCode);
      if (!sub) throw new Error(`Unknown subject code "${subCode}"`);
      const yearName = excelVal(row['Academic Year Name']);
      const year = years.find((y) => y.name === yearName);
      if (!year) throw new Error(`Unknown academic year "${yearName}"`);
      const divName = excelVal(row['Division Name']);
      const div = divisions.find((d) => d.name === divName && d.academic_year_id === year.id);
      if (!div) throw new Error(`Unknown division "${divName}" for year "${yearName}"`);
      await createMapping({
        faculty_id: f.id,
        subject_id: sub.id,
        division_id: div.id,
        academic_year_id: year.id,
        is_active: excelBool(row.Active) ?? true,
      });
    });
  }
</script>

<h1 style="display:flex;justify-content:space-between;align-items:center">
  Faculty — Subject Mappings
  <ExcelImport columns={importColumns} onImport={onImport} templateName="mappings-template" label="mappings" />
</h1>
<p style="color:var(--muted)">
  Assign a faculty member to a subject for a division in an academic year. The timetable generator
  only schedules sessions defined here.
</p>
{#if error}<div class="error-box">{error}</div>{/if}

<div class="card" style="margin:14px 0">
  <h2>{editing ? 'Edit' : 'New'} mapping</h2>
  <form on:submit={save} style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
    <div class="field">
      <label for="map-fac">Faculty</label>
      <select id="map-fac" bind:value={form.faculty_id} required>
        <option value="">— select —</option>
        {#each faculty as f}
          <option value={f.id}>{f.name} ({f.employee_id})</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="map-sub">Subject</label>
      <select id="map-sub" bind:value={form.subject_id} required>
        <option value="">— select —</option>
        {#each subjects as s}
          <option value={s.id}>{s.code} — {s.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="map-div">Division</label>
      <select id="map-div" bind:value={form.division_id} required>
        <option value="">— select —</option>
        {#each divisions as d}
          <option value={d.id}>{d.course?.name || ''} — {d.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="map-ay">Academic year</label>
      <select id="map-ay" bind:value={form.academic_year_id} required>
        <option value="">— select —</option>
        {#each years as y}
          <option value={y.id}>{y.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="map-active">Active</label>
      <input id="map-active" type="checkbox" bind:checked={form.is_active} />
    </div>
    <button class="btn-primary" type="submit">{editing ? 'Save' : 'Create'}</button>
    {#if editing}<button type="button" on:click={reset}>Cancel</button>{/if}
  </form>
</div>

<div class="card">
  <Table
    columns={[
      { key: 'faculty', label: 'Faculty', render: (r) => r.faculty?.name || '—' },
      { key: 'subject', label: 'Subject', render: (r) => (r.subject?.code ? `${r.subject.code} — ${r.subject.name}` : r.subject?.name || '—') },
      { key: 'division', label: 'Division', render: (r) => r.division?.name || '—' },
      { key: 'ay', label: 'Academic year', render: (r) => r.academic_year?.name || '—' },
      { key: 'is_active', label: 'Active', render: (r) => r.is_active ? '✓' : '—' },
    ]}
    items={items}
    rowButtons={(item) => [
      { label: 'Edit', onClick: startEdit },
      { label: 'Delete', class: 'btn-danger', onClick: remove },
    ]}
  />
</div>