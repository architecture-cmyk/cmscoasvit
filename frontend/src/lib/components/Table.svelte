<script>
  export let columns = [];
  export let items = [];
  export let empty = 'No records found.';
  export let rowButtons = null;
</script>

<table class="data">
  <thead>
    <tr>
      {#each columns as c (c.key)}
        <th>{c.label}</th>
      {/each}
      {#if rowButtons}
        <th>Actions</th>
      {/if}
    </tr>
  </thead>
  <tbody>
    {#each items as item}
      <tr>
        {#each columns as c (c.key)}
          <td>{@html c.render ? c.render(item, c) : String(item[c.key] ?? '')}</td>
        {/each}
        {#if rowButtons}
          <td class="row-actions">
            {#each rowButtons(item) as btn}
              <button type="button" class="btn-sm {btn.class || ''}" on:click={() => btn.onClick(item)}>{btn.label}</button>
            {/each}
          </td>
        {/if}
      </tr>
    {/each}
    {#if items.length === 0}
      <tr><td colspan={columns.length + (rowButtons ? 1 : 0)} style="text-align:center;color:var(--muted);padding:24px">{empty}</td></tr>
    {/if}
  </tbody>
</table>

<style>
  .row-actions {
    white-space: nowrap;
  }
  .row-actions button {
    margin-right: 4px;
  }
</style>