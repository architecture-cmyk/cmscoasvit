<script>
  import { onMount } from 'svelte';
  import { listCourses, createCourse, updateCourse, deleteCourse, listDepartments, importRows, excelVal, excelBool } from '$lib/data';
  import { notify } from '$lib/stores';
  import Table from '$lib/components/Table.svelte';
  import ExcelImport from '$lib/components/ExcelImport.svelte';

  let items = [];
  let departments = [];
  let error = '';
  let form = { name: '', department_id: '', is_active: true };
  let editing = null;

  async function load() {
    [items, departments] = await Promise.all([listCourses(), listDepartments()]);
  }

  onMount(async () => { try { await load(); } catch (e) { error = e.message; } });

  async function save(e) {
    e.preventDefault();
    error = '';
    try {
      const body = { name: form.name, department_id: form.department_id || null, is_active: form.is_active };
      if (editing) {
        await updateCourse(editing.id, body);
        notify('Updated', 'success');
      } else {
        await createCourse(body);
        notify('Created', 'success');
      }
      reset();
      await load();
    } catch (err) { error = err.message; }
  }

  function reset() {
    form = { name: '', department_id: '', is_active: true };
    editing = null;
  }

  function startEdit(item) {
    editing = item;
    form = { name: item.name, department_id: item.department_id || '', is_active: item.is_active };
  }

  async function remove(item) {
    if (!confirm(`Delete ${item.name}?`)) return;
    try {
      const r = await deleteCourse(item.id);
      notify(r?.deactivated ? 'In use — deactivated instead' : 'Deleted', 'success');
      await load();
    } catch (err) { error = err.message; }
  }

  const importColumns = [
    { key: 'name', header: 'Name', sample: 'B.Tech Computer Science' },
    { key: 'department_code', header: 'Department Code', sample: 'CSE' },
    { key: 'active', header: 'Active', sample: 'TRUE' },
  ];

  async function onImport(rows) {
    return importRows(rows, async (row) => {
      const code = excelVal(row['Department Code']);
      const dept = departments.find((d) => d.code.toLowerCase() === code.toLowerCase());
      if (!dept) throw new Error(`Unknown department code "${code}"`);
      await createCourse({ name: excelVal(row.Name), department_id: dept.id, is_active: excelBool(row.Active) ?? true });
    });
  }
</script>

<h1 style="display:flex;justify-content:space-between;align-items:center">
  Courses
  <ExcelImport columns={importColumns} onImport={onImport} templateName="courses-template" label="courses" />
</h1>
{#if error}<div class="error-box">{error}</div>{/if}

<div class="card" style="margin:14px 0">
  <h2>{editing ? 'Edit' : 'New'} course</h2>
  <form on:submit={save} style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
    <div class="field">
      <label for="course-name">Name</label>
      <input id="course-name" bind:value={form.name} required />
    </div>
    <div class="field">
      <label for="course-dept">Department</label>
      <select id="course-dept" bind:value={form.department_id} required>
        <option value="">— select —</option>
        {#each departments as d}
          <option value={d.id}>{d.code} — {d.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="course-active">Active</label>
      <input id="course-active" type="checkbox" bind:checked={form.is_active} />
    </div>
    <button class="btn-primary" type="submit">{editing ? 'Save' : 'Create'}</button>
    {#if editing}<button type="button" on:click={reset}>Cancel</button>{/if}
  </form>
</div>

<div class="card">
  <Table
    columns={[
      { key: 'name', label: 'Name' },
      { key: 'dept', label: 'Department', render: (r) => r.department?.name || '—' },
      { key: 'is_active', label: 'Active', render: (r) => r.is_active ? '✓' : '—' },
    ]}
    items={items}
    rowButtons={(item) => [
      { label: 'Edit', onClick: startEdit },
      { label: 'Delete', class: 'btn-danger', onClick: remove },
    ]}
  />
</div>