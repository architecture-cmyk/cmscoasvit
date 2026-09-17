<script>
  import { onMount } from 'svelte';
  import {
    listSubjects,
    createSubject,
    updateSubject,
    deleteSubject,
    listDepartments,
    listCourses,
    listSemesters,
    importRows,
    excelVal,
    excelBool,
  } from '$lib/data';
  import { notify } from '$lib/stores';
  import Table from '$lib/components/Table.svelte';
  import ExcelImport from '$lib/components/ExcelImport.svelte';

  let items = [];
  let departments = [];
  let courses = [];
  let semesters = [];
  let error = '';
  let form = {
    department_id: '',
    course_id: '',
    semester_id: '',
    code: '',
    name: '',
    lecture_hours: 0,
    tutorial_hours: 0,
    practical_hours: 0,
    is_lab: false,
    is_active: true,
  };
  let editing = null;

  async function load() {
    [items, departments, courses, semesters] = await Promise.all([
      listSubjects(),
      listDepartments(),
      listCourses(),
      listSemesters(),
    ]);
  }

  onMount(async () => { try { await load(); } catch (e) { error = e.message; } });

  function reset() {
    form = {
      department_id: '',
      course_id: '',
      semester_id: '',
      code: '',
      name: '',
      lecture_hours: 0,
      tutorial_hours: 0,
      practical_hours: 0,
      is_lab: false,
      is_active: true,
    };
    editing = null;
  }

  function startEdit(item) {
    editing = item;
    form = {
      department_id: item.department_id || '',
      course_id: item.course_id || '',
      semester_id: item.semester_id || '',
      code: item.code,
      name: item.name,
      lecture_hours: item.lecture_hours,
      tutorial_hours: item.tutorial_hours,
      practical_hours: item.practical_hours,
      is_lab: item.is_lab,
      is_active: item.is_active,
    };
  }

  async function save(e) {
    e.preventDefault();
    error = '';
    try {
      const body = {
        department_id: form.department_id || null,
        course_id: form.course_id || null,
        semester_id: form.semester_id || null,
        code: form.code,
        name: form.name,
        lecture_hours: Number(form.lecture_hours || 0),
        tutorial_hours: Number(form.tutorial_hours || 0),
        practical_hours: Number(form.practical_hours || 0),
        is_lab: form.is_lab,
        is_active: form.is_active,
      };
      if (editing) {
        await updateSubject(editing.id, body);
        notify('Updated', 'success');
      } else {
        await createSubject(body);
        notify('Created', 'success');
      }
      reset();
      await load();
    } catch (err) { error = err.message; }
  }

  async function remove(item) {
    if (!confirm(`Delete ${item.name}?`)) return;
    try {
      const r = await deleteSubject(item.id);
      notify(r?.deactivated ? 'In use — deactivated instead' : 'Deleted', 'success');
      await load();
    } catch (err) { error = err.message; }
  }

  const importColumns = [
    { key: 'department_code', header: 'Department Code', sample: 'CSE' },
    { key: 'course_name', header: 'Course Name (optional)', sample: 'B.Tech Computer Science' },
    { key: 'semester_name', header: 'Semester Name (optional)', sample: 'Semester 1' },
    { key: 'code', header: 'Code', sample: 'CS201' },
    { key: 'name', header: 'Name', sample: 'Data Structures' },
    { key: 'lecture_hours', header: 'Lecture Hours', sample: 3 },
    { key: 'tutorial_hours', header: 'Tutorial Hours', sample: 1 },
    { key: 'practical_hours', header: 'Practical Hours', sample: 0 },
    { key: 'is_lab', header: 'Lab', sample: 'FALSE' },
    { key: 'active', header: 'Active', sample: 'TRUE' },
  ];

  async function onImport(rows) {
    return importRows(rows, async (row) => {
      const code = excelVal(row['Department Code']);
      const dept = departments.find((d) => d.code.toLowerCase() === code.toLowerCase());
      if (!dept) throw new Error(`Unknown department code "${code}"`);
      const courseName = excelVal(row['Course Name (optional)']);
      const course = courseName ? courses.find((c) => c.name === courseName) : null;
      if (courseName && !course) throw new Error(`Unknown course "${courseName}"`);
      const semName = excelVal(row['Semester Name (optional)']);
      const sem = semName ? semesters.find((s) => s.name === semName) : null;
      if (semName && !sem) throw new Error(`Unknown semester "${semName}"`);
      const lec = Number(row['Lecture Hours'] || 0);
      const tut = Number(row['Tutorial Hours'] || 0);
      const pra = Number(row['Practical Hours'] || 0);
      await createSubject({
        department_id: dept.id,
        course_id: course?.id || null,
        semester_id: sem?.id || null,
        code: excelVal(row.Code),
        name: excelVal(row.Name),
        lecture_hours: lec,
        tutorial_hours: tut,
        practical_hours: pra,
        weekly_required_hours: lec + tut + pra,
        is_lab: excelBool(row.Lab) ?? false,
        is_active: excelBool(row.Active) ?? true,
      });
    });
  }
</script>

<h1 style="display:flex;justify-content:space-between;align-items:center">
  Subjects
  <ExcelImport columns={importColumns} onImport={onImport} templateName="subjects-template" label="subjects" />
</h1>
{#if error}<div class="error-box">{error}</div>{/if}

<div class="card" style="margin:14px 0">
  <h2>{editing ? 'Edit' : 'New'} subject</h2>
  <form on:submit={save} style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
    <div class="field">
      <label for="sub-dept">Department</label>
      <select id="sub-dept" bind:value={form.department_id} required>
        <option value="">— select —</option>
        {#each departments as d}
          <option value={d.id}>{d.code} — {d.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="sub-course">Course (optional)</label>
      <select id="sub-course" bind:value={form.course_id}>
        <option value="">— none —</option>
        {#each courses as c}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="sub-sem">Semester (optional)</label>
      <select id="sub-sem" bind:value={form.semester_id}>
        <option value="">— none —</option>
        {#each semesters as s}
          <option value={s.id}>{s.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="sub-code">Code</label>
      <input id="sub-code" bind:value={form.code} required />
    </div>
    <div class="field">
      <label for="sub-name">Name</label>
      <input id="sub-name" bind:value={form.name} required />
    </div>
    <div class="field">
      <label for="sub-lec">Lecture hrs/wk</label>
      <input id="sub-lec" type="number" min="0" step="0.5" bind:value={form.lecture_hours} />
    </div>
    <div class="field">
      <label for="sub-tut">Tutorial hrs/wk</label>
      <input id="sub-tut" type="number" min="0" step="0.5" bind:value={form.tutorial_hours} />
    </div>
    <div class="field">
      <label for="sub-pra">Practical hrs/wk</label>
      <input id="sub-pra" type="number" min="0" step="0.5" bind:value={form.practical_hours} />
    </div>
    <div class="field">
      <label for="sub-lab">Lab</label>
      <input id="sub-lab" type="checkbox" bind:checked={form.is_lab} />
    </div>
    <div class="field">
      <label for="sub-active">Active</label>
      <input id="sub-active" type="checkbox" bind:checked={form.is_active} />
    </div>
    <button class="btn-primary" type="submit">{editing ? 'Save' : 'Create'}</button>
    {#if editing}<button type="button" on:click={reset}>Cancel</button>{/if}
  </form>
</div>

<div class="card">
  <Table
    columns={[
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'department', label: 'Department', render: (r) => r.department?.name || '—' },
      { key: 'course', label: 'Course', render: (r) => r.course?.name || '—' },
      { key: 'semester', label: 'Semester', render: (r) => r.semester?.name || '—' },
      { key: 'hours', label: 'L / T / P', render: (r) => `${r.lecture_hours} / ${r.tutorial_hours} / ${r.practical_hours}` },
      { key: 'is_lab', label: 'Lab', render: (r) => r.is_lab ? '✓' : '—' },
      { key: 'is_active', label: 'Active', render: (r) => r.is_active ? '✓' : '—' },
    ]}
    items={items}
    rowButtons={(item) => [
      { label: 'Edit', onClick: startEdit },
      { label: 'Delete', class: 'btn-danger', onClick: remove },
    ]}
  />
</div>