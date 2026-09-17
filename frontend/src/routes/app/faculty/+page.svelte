<script>
  import { onMount } from 'svelte';
  import { listFaculty, createFaculty, updateFaculty, deleteFaculty, listDepartments, importRows, excelVal, excelBool } from '$lib/data';
  import { notify } from '$lib/stores';
  import Table from '$lib/components/Table.svelte';
  import ExcelImport from '$lib/components/ExcelImport.svelte';

  let items = [];
  let departments = [];
  let error = '';
  let form = {
    department_id: '',
    employee_id: '',
    name: '',
    designation: '',
    email: '',
    mobile: '',
    maximum_weekly_load: 0,
    is_active: true,
  };
  let editing = null;

  async function load() {
    [items, departments] = await Promise.all([listFaculty(), listDepartments()]);
  }

  onMount(async () => { try { await load(); } catch (e) { error = e.message; } });

  function reset() {
    form = {
      department_id: '',
      employee_id: '',
      name: '',
      designation: '',
      email: '',
      mobile: '',
      maximum_weekly_load: 0,
      is_active: true,
    };
    editing = null;
  }

  function startEdit(item) {
    editing = item;
    form = {
      department_id: item.department_id || '',
      employee_id: item.employee_id || '',
      name: item.name,
      designation: item.designation || '',
      email: item.email || '',
      mobile: item.mobile || '',
      maximum_weekly_load: item.maximum_weekly_load,
      is_active: item.is_active,
    };
  }

  async function save(e) {
    e.preventDefault();
    error = '';
    try {
      const body = {
        department_id: form.department_id || null,
        employee_id: form.employee_id,
        name: form.name,
        designation: form.designation || null,
        email: form.email,
        mobile: form.mobile || null,
        maximum_weekly_load: Number(form.maximum_weekly_load || 0),
        is_active: form.is_active,
      };
      if (editing) {
        await updateFaculty(editing.id, body);
        notify('Updated', 'success');
      } else {
        await createFaculty(body);
        notify('Created', 'success');
      }
      reset();
      await load();
    } catch (err) { error = err.message; }
  }

  async function remove(item) {
    if (!confirm(`Delete ${item.name}?`)) return;
    try {
      const r = await deleteFaculty(item.id);
      notify(r?.deactivated ? 'In use — deactivated instead' : 'Deleted', 'success');
      await load();
    } catch (err) { error = err.message; }
  }

  const importColumns = [
    { key: 'department_code', header: 'Department Code', sample: 'CSE' },
    { key: 'employee_id', header: 'Employee ID', sample: 'EMP001' },
    { key: 'name', header: 'Full Name', sample: 'Dr. Anil Rao' },
    { key: 'designation', header: 'Designation', sample: 'Associate Professor' },
    { key: 'email', header: 'Email', sample: 'anil.rao@college.edu' },
    { key: 'mobile', header: 'Mobile', sample: '9876543210' },
    { key: 'maximum_weekly_load', header: 'Max Weekly Load', sample: 18 },
    { key: 'active', header: 'Active', sample: 'TRUE' },
  ];

  async function onImport(rows) {
    return importRows(rows, async (row) => {
      const code = excelVal(row['Department Code']);
      const dept = departments.find((d) => d.code.toLowerCase() === code.toLowerCase());
      if (!dept) throw new Error(`Unknown department code "${code}"`);
      await createFaculty({
        department_id: dept.id,
        employee_id: excelVal(row['Employee ID']),
        name: excelVal(row['Full Name']),
        designation: excelVal(row.Designation) || null,
        email: excelVal(row.Email),
        mobile: excelVal(row.Mobile) || null,
        maximum_weekly_load: Number(row['Max Weekly Load'] || 0),
        is_active: excelBool(row.Active) ?? true,
      });
    });
  }
</script>

<h1 style="display:flex;justify-content:space-between;align-items:center">
  Faculty
  <ExcelImport columns={importColumns} onImport={onImport} templateName="faculty-template" label="faculty" />
</h1>
{#if error}<div class="error-box">{error}</div>{/if}

<div class="card" style="margin:14px 0">
  <h2>{editing ? 'Edit' : 'New'} faculty member</h2>
  <form on:submit={save} style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
    <div class="field">
      <label for="fac-dept">Department</label>
      <select id="fac-dept" bind:value={form.department_id} required>
        <option value="">— select —</option>
        {#each departments as d}
          <option value={d.id}>{d.code} — {d.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="fac-emp">Employee ID</label>
      <input id="fac-emp" bind:value={form.employee_id} required />
    </div>
    <div class="field">
      <label for="fac-name">Full name</label>
      <input id="fac-name" bind:value={form.name} required />
    </div>
    <div class="field">
      <label for="fac-desig">Designation</label>
      <input id="fac-desig" bind:value={form.designation} />
    </div>
    <div class="field">
      <label for="fac-email">Email</label>
      <input id="fac-email" type="email" bind:value={form.email} required />
    </div>
    <div class="field">
      <label for="fac-mobile">Mobile</label>
      <input id="fac-mobile" bind:value={form.mobile} />
    </div>
    <div class="field">
      <label for="fac-load">Max weekly load (hrs)</label>
      <input id="fac-load" type="number" min="0" step="0.5" bind:value={form.maximum_weekly_load} required />
    </div>
    <div class="field">
      <label for="fac-active">Active</label>
      <input id="fac-active" type="checkbox" bind:checked={form.is_active} />
    </div>
    <button class="btn-primary" type="submit">{editing ? 'Save' : 'Create'}</button>
    {#if editing}<button type="button" on:click={reset}>Cancel</button>{/if}
  </form>
</div>

<div class="card">
  <Table
    columns={[
      { key: 'name', label: 'Name' },
      { key: 'employee_id', label: 'Employee ID' },
      { key: 'department', label: 'Department', render: (r) => r.department?.name || '—' },
      { key: 'designation', label: 'Designation', render: (r) => r.designation || '—' },
      { key: 'email', label: 'Email' },
      { key: 'max_load', label: 'Max load', render: (r) => Number(r.maximum_weekly_load || 0).toFixed(1) },
      { key: 'is_active', label: 'Active', render: (r) => r.is_active ? '✓' : '—' },
    ]}
    items={items}
    rowButtons={(item) => [
      { label: 'Edit', onClick: startEdit },
      { label: 'Delete', class: 'btn-danger', onClick: remove },
    ]}
  />
</div>