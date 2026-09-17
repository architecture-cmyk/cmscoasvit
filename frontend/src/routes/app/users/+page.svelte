<script>
  import { onMount } from 'svelte';
  import { listUsers, updateUser, listDepartments, listFaculty } from '$lib/data';
  import { notify } from '$lib/stores';
  import Table from '$lib/components/Table.svelte';

  let items = [];
  let departments = [];
  let facultyAll = [];
  let error = '';
  let form = { role: 'faculty', department_id: '', faculty_id: '', is_active: true };
  let editing = null;

  async function load() {
    [items, departments, facultyAll] = await Promise.all([listUsers(), listDepartments(), listFaculty()]);
  }

  onMount(async () => { try { await load(); } catch (e) { error = e.message; } });

  function reset() {
    form = { role: 'faculty', department_id: '', faculty_id: '', is_active: true };
    editing = null;
  }

  function startEdit(item) {
    editing = item;
    form = {
      role: item.role,
      department_id: item.department_id || '',
      faculty_id: item.faculty_id || '',
      is_active: item.is_active,
    };
  }

  async function save(e) {
    e.preventDefault();
    error = '';
    try {
      const body = {
        role: form.role,
        department_id: form.role === 'hod' ? form.department_id || null : null,
        faculty_id: form.role === 'faculty' ? form.faculty_id || null : null,
        is_active: form.is_active,
      };
      if (form.role === 'hod' && !body.department_id) return error = 'Select a department for the HOD role.';
      if (form.role === 'faculty' && !body.faculty_id) return error = 'Select a faculty member for the faculty role.';
      await updateUser(editing.id, body);
      notify('Updated', 'success');
      reset();
      await load();
    } catch (err) { error = err.message; }
  }
</script>

<h1>Users</h1>
<p style="color:var(--muted)">
  User accounts are created in Supabase Auth (or via the provisioning Edge Function). Here you can
  assign roles, departments and faculty links.
</p>
{#if error}<div class="error-box">{error}</div>{/if}

{#if editing}
  <div class="card" style="margin:14px 0">
    <h2>Edit user — {editing.email}</h2>
    <form on:submit={save} style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div class="field">
        <label for="usr-role">Role</label>
        <select id="usr-role" bind:value={form.role}>
          <option value="admin">Admin</option>
          <option value="hod">HoD</option>
          <option value="faculty">Faculty</option>
        </select>
      </div>
      {#if form.role === 'hod'}
        <div class="field">
          <label for="usr-dept">Department</label>
          <select id="usr-dept" bind:value={form.department_id} required>
            <option value="">— select —</option>
            {#each departments as d}<option value={d.id}>{d.code} — {d.name}</option>{/each}
          </select>
        </div>
      {/if}
      {#if form.role === 'faculty'}
        <div class="field">
          <label for="usr-fac">Faculty</label>
          <select id="usr-fac" bind:value={form.faculty_id} required>
            <option value="">— select —</option>
            {#each facultyAll as f}<option value={f.id}>{f.name} ({f.employee_id})</option>{/each}
          </select>
        </div>
      {/if}
      <div class="field">
        <label for="usr-active">Active</label>
        <input id="usr-active" type="checkbox" bind:checked={form.is_active} />
      </div>
      <button class="btn-primary" type="submit">Save</button>
      <button type="button" on:click={reset}>Cancel</button>
    </form>
  </div>
{/if}

<div class="card">
  <Table
    columns={[
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role', render: (r) => `<span class="badge badge-${r.role}">${r.role}</span>` },
      { key: 'department', label: 'Department', render: (r) => r.department?.name || '—' },
      { key: 'faculty', label: 'Faculty', render: (r) => r.faculty?.name || '—' },
      { key: 'is_active', label: 'Active', render: (r) => r.is_active ? '✓' : '—' },
    ]}
    items={items}
    rowButtons={(item) => [
      { label: 'Edit', onClick: startEdit },
    ]}
  />
</div>

<style>
  :global(.badge-admin) { background: #dcfce7; color: #15803d; }
  :global(.badge-hod) { background: #fef3c7; color: #b45309; }
  :global(.badge-faculty) { background: #eef2ff; color: #4338ca; }
</style>