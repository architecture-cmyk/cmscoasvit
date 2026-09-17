<script>
  import { onMount } from 'svelte';
  import { listSemesters, createSemester, updateSemester, deleteSemester, listAcademicYears, importRows, excelVal, excelBool } from '$lib/data';
  import { notify } from '$lib/stores';
  import Table from '$lib/components/Table.svelte';
  import ExcelImport from '$lib/components/ExcelImport.svelte';

  let items = [];
  let years = [];
  let error = '';
  let form = { academic_year_id: '', name: '', semester_number: 1, is_active: true };
  let editing = null;

  async function load() {
    [items, years] = await Promise.all([listSemesters(), listAcademicYears()]);
  }

  onMount(async () => { try { await load(); } catch (e) { error = e.message; } });

  function reset() {
    form = { academic_year_id: '', name: '', semester_number: 1, is_active: true };
    editing = null;
  }

  function startEdit(item) {
    editing = item;
    form = {
      academic_year_id: item.academic_year_id || '',
      name: item.name,
      semester_number: item.semester_number,
      is_active: item.is_active,
    };
  }

  async function save(e) {
    e.preventDefault();
    error = '';
    try {
      const body = {
        academic_year_id: form.academic_year_id || null,
        name: form.name,
        semester_number: Number(form.semester_number),
        is_active: form.is_active,
      };
      if (editing) {
        await updateSemester(editing.id, body);
        notify('Updated', 'success');
      } else {
        await createSemester(body);
        notify('Created', 'success');
      }
      reset();
      await load();
    } catch (err) { error = err.message; }
  }

  async function remove(item) {
    if (!confirm(`Delete ${item.name}?`)) return;
    try {
      const r = await deleteSemester(item.id);
      notify(r?.deactivated ? 'In use — deactivated instead' : 'Deleted', 'success');
      await load();
    } catch (err) { error = err.message; }
  }

  const importColumns = [
    { key: 'academic_year_name', header: 'Academic Year Name', sample: '2026-2027' },
    { key: 'name', header: 'Name', sample: 'Semester 1' },
    { key: 'semester_number', header: 'Semester Number', sample: 1 },
    { key: 'active', header: 'Active', sample: 'TRUE' },
  ];

  async function onImport(rows) {
    return importRows(rows, async (row) => {
      const yearName = excelVal(row['Academic Year Name']);
      const year = years.find((y) => y.name === yearName);
      if (!year) throw new Error(`Unknown academic year "${yearName}"`);
      await createSemester({
        academic_year_id: year.id,
        name: excelVal(row.Name),
        semester_number: Number(row['Semester Number']),
        is_active: excelBool(row.Active) ?? true,
      });
    });
  }
</script>

<h1 style="display:flex;justify-content:space-between;align-items:center">
  Semesters
  <ExcelImport columns={importColumns} onImport={onImport} templateName="semesters-template" label="semesters" />
</h1>
{#if error}<div class="error-box">{error}</div>{/if}

<div class="card" style="margin:14px 0">
  <h2>{editing ? 'Edit' : 'New'} semester</h2>
  <form on:submit={save} style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
    <div class="field">
      <label for="sem-ay">Academic year</label>
      <select id="sem-ay" bind:value={form.academic_year_id} required>
        <option value="">— select —</option>
        {#each years as y}
          <option value={y.id}>{y.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="sem-name">Name</label>
      <input id="sem-name" bind:value={form.name} required />
    </div>
    <div class="field">
      <label for="sem-num">Semester no.</label>
      <input id="sem-num" type="number" min="1" bind:value={form.semester_number} required />
    </div>
    <div class="field">
      <label for="sem-active">Active</label>
      <input id="sem-active" type="checkbox" bind:checked={form.is_active} />
    </div>
    <button class="btn-primary" type="submit">{editing ? 'Save' : 'Create'}</button>
    {#if editing}<button type="button" on:click={reset}>Cancel</button>{/if}
  </form>
</div>

<div class="card">
  <Table
    columns={[
      { key: 'name', label: 'Name' },
      { key: 'ay', label: 'Academic year', render: (r) => r.academic_year?.name || '—' },
      { key: 'semester_number', label: 'No.' },
      { key: 'is_active', label: 'Active', render: (r) => r.is_active ? '✓' : '—' },
    ]}
    items={items}
    rowButtons={(item) => [
      { label: 'Edit', onClick: startEdit },
      { label: 'Delete', class: 'btn-danger', onClick: remove },
    ]}
  />
</div>