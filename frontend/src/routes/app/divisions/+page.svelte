<script>
  import { onMount } from 'svelte';
  import { listDivisions, createDivision, updateDivision, deleteDivision, listCourses, listAcademicYears, listSemesters, importRows, excelVal, excelBool } from '$lib/data';
  import { notify } from '$lib/stores';
  import Table from '$lib/components/Table.svelte';
  import ExcelImport from '$lib/components/ExcelImport.svelte';

  let items = [];
  let courses = [];
  let years = [];
  let semesters = [];
  let error = '';
  let form = { course_id: '', academic_year_id: '', semester_id: '', name: '', strength: 60, is_active: true };
  let editing = null;

  async function load() {
    [items, courses, years, semesters] = await Promise.all([
      listDivisions(),
      listCourses(),
      listAcademicYears(),
      listSemesters(),
    ]);
  }

  onMount(async () => { try { await load(); } catch (e) { error = e.message; } });

  function reset() {
    form = { course_id: '', academic_year_id: '', semester_id: '', name: '', strength: 60, is_active: true };
    editing = null;
  }

  function startEdit(item) {
    editing = item;
    form = {
      course_id: item.course_id || '',
      academic_year_id: item.academic_year_id || '',
      semester_id: item.semester_id || '',
      name: item.name,
      strength: item.strength,
      is_active: item.is_active,
    };
  }

  async function save(e) {
    e.preventDefault();
    error = '';
    try {
      const body = {
        course_id: form.course_id || null,
        academic_year_id: form.academic_year_id || null,
        semester_id: form.semester_id || null,
        name: form.name,
        strength: Number(form.strength),
        is_active: form.is_active,
      };
      if (editing) {
        await updateDivision(editing.id, body);
        notify('Updated', 'success');
      } else {
        await createDivision(body);
        notify('Created', 'success');
      }
      reset();
      await load();
    } catch (err) { error = err.message; }
  }

  async function remove(item) {
    if (!confirm(`Delete ${item.name}?`)) return;
    try {
      const r = await deleteDivision(item.id);
      notify(r?.deactivated ? 'In use — deactivated instead' : 'Deleted', 'success');
      await load();
    } catch (err) { error = err.message; }
  }

  function semestersFor(yearId) {
    return semesters.filter((s) => !yearId || s.academic_year_id === yearId);
  }

  const importColumns = [
    { key: 'course_name', header: 'Course Name', sample: 'B.Tech Computer Science' },
    { key: 'academic_year_name', header: 'Academic Year Name', sample: '2026-2027' },
    { key: 'semester_name', header: 'Semester Name', sample: 'Semester 1' },
    { key: 'name', header: 'Division Name', sample: 'CSE-A' },
    { key: 'strength', header: 'Strength', sample: 60 },
    { key: 'active', header: 'Active', sample: 'TRUE' },
  ];

  async function onImport(rows) {
    return importRows(rows, async (row) => {
      const courseName = excelVal(row['Course Name']);
      const yearName = excelVal(row['Academic Year Name']);
      const semName = excelVal(row['Semester Name']);
      const course = courses.find((c) => c.name === courseName);
      if (!course) throw new Error(`Unknown course "${courseName}"`);
      const year = years.find((y) => y.name === yearName);
      if (!year) throw new Error(`Unknown academic year "${yearName}"`);
      const sem = semesters.find((s) => s.name === semName && s.academic_year_id === year.id);
      if (!sem) throw new Error(`Unknown semester "${semName}" for year "${yearName}"`);
      await createDivision({
        course_id: course.id,
        academic_year_id: year.id,
        semester_id: sem.id,
        name: excelVal(row['Division Name']),
        strength: Number(row.Strength),
        is_active: excelBool(row.Active) ?? true,
      });
    });
  }
</script>

<h1 style="display:flex;justify-content:space-between;align-items:center">
  Divisions
  <ExcelImport columns={importColumns} onImport={onImport} templateName="divisions-template" label="divisions" />
</h1>
{#if error}<div class="error-box">{error}</div>{/if}

<div class="card" style="margin:14px 0">
  <h2>{editing ? 'Edit' : 'New'} division</h2>
  <form on:submit={save} style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
    <div class="field">
      <label for="div-course">Course</label>
      <select id="div-course" bind:value={form.course_id} required>
        <option value="">— select —</option>
        {#each courses as c}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="div-ay">Academic year</label>
      <select id="div-ay" bind:value={form.academic_year_id} required>
        <option value="">— select —</option>
        {#each years as y}
          <option value={y.id}>{y.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="div-sem">Semester</label>
      <select id="div-sem" bind:value={form.semester_id} required>
        <option value="">— select —</option>
        {#each semestersFor(form.academic_year_id) as s}
          <option value={s.id}>{s.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="div-name">Name</label>
      <input id="div-name" bind:value={form.name} required />
    </div>
    <div class="field">
      <label for="div-strength">Strength</label>
      <input id="div-strength" type="number" min="1" bind:value={form.strength} required />
    </div>
    <div class="field">
      <label for="div-active">Active</label>
      <input id="div-active" type="checkbox" bind:checked={form.is_active} />
    </div>
    <button class="btn-primary" type="submit">{editing ? 'Save' : 'Create'}</button>
    {#if editing}<button type="button" on:click={reset}>Cancel</button>{/if}
  </form>
</div>

<div class="card">
  <Table
    columns={[
      { key: 'name', label: 'Name' },
      { key: 'course', label: 'Course', render: (r) => r.course?.name || '—' },
      { key: 'ay', label: 'Academic year', render: (r) => r.academic_year?.name || '—' },
      { key: 'semester', label: 'Semester', render: (r) => r.semester?.name || '—' },
      { key: 'strength', label: 'Strength' },
      { key: 'is_active', label: 'Active', render: (r) => r.is_active ? '✓' : '—' },
    ]}
    items={items}
    rowButtons={(item) => [
      { label: 'Edit', onClick: startEdit },
      { label: 'Delete', class: 'btn-danger', onClick: remove },
    ]}
  />
</div>