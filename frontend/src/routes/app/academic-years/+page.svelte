<script>
  import { onMount } from 'svelte';
  import { listAcademicYears, createAcademicYear, updateAcademicYear, deleteAcademicYear } from '$lib/data';
  import { notify } from '$lib/stores';
  import Table from '$lib/components/Table.svelte';

  let items = [];
  let error = '';
  let form = { name: '', start_date: '', end_date: '', is_active: true };
  let editing = null;

  async function load() {
    items = await listAcademicYears();
  }

  onMount(async () => { try { await load(); } catch (e) { error = e.message; } });

  async function save(e) {
    e.preventDefault();
    error = '';
    try {
      const body = { ...form, start_date: form.start_date || null, end_date: form.end_date || null };
      if (editing) {
        await updateAcademicYear(editing.id, body);
        notify('Updated', 'success');
      } else {
        await createAcademicYear(body);
        notify('Created', 'success');
      }
      form = { name: '', start_date: '', end_date: '', is_active: true };
      editing = null;
      await load();
    } catch (err) { error = err.message; }
  }

  function startEdit(item) {
    editing = item;
    form = { name: item.name, start_date: item.start_date || '', end_date: item.end_date || '', is_active: item.is_active };
  }

  async function remove(item) {
    if (!confirm(`Delete ${item.name}?`)) return;
    try {
      const r = await deleteAcademicYear(item.id);
      notify(r?.is_active === false ? 'Academic year is in use; deactivated instead' : 'Academic year deleted', 'success');
      await load();
    } catch (err) { error = err.message; }
  }
</script>

<h1>Academic Years</h1>
{#if error}<div class="error-box">{error}</div>{/if}

<div class="card" style="margin:14px 0">
  <h2>{editing ? 'Edit' : 'New'} academic year</h2>
  <form on:submit={save} style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
    <div class="field"><label for="academic-year-name">Name</label><input id="academic-year-name" bind:value={form.name} required /></div>
    <div class="field"><label for="academic-year-start">Start date</label><input id="academic-year-start" type="date" bind:value={form.start_date} /></div>
    <div class="field"><label for="academic-year-end">End date</label><input id="academic-year-end" type="date" bind:value={form.end_date} /></div>
    <div class="field"><label for="academic-year-active">Active</label><input id="academic-year-active" type="checkbox" bind:checked={form.is_active} /></div>
    <button class="btn-primary" type="submit">{editing ? 'Save' : 'Create'}</button>
    {#if editing}<button type="button" on:click={() => { editing = null; form = { name: '', start_date: '', end_date: '', is_active: true }; }}>Cancel</button>{/if}
  </form>
</div>

<div class="card">
  <Table
    columns={[
      { key: 'name', label: 'Name' },
      { key: 'start_date', label: 'Start', render: (r) => r.start_date || '—' },
      { key: 'end_date', label: 'End', render: (r) => r.end_date || '—' },
      { key: 'is_active', label: 'Active', render: (r) => r.is_active ? '✓' : '—' },
    ]}
    items={items}
    rowButtons={(item) => [
      { label: 'Edit', onClick: startEdit },
      { label: 'Delete', class: 'btn-danger', onClick: remove },
    ]}
  />
</div>