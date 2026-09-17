<script>
  import { downloadExcelTemplate, parseExcelRows } from '$lib/data';
  import { notify } from '$lib/stores';

  export let columns = [];
  export let onImport = async () => ({ imported: 0, errors: [] });
  export let templateName = 'import';
  export let label = '';

  let busy = false;

  function download() {
    downloadExcelTemplate(templateName, columns);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    busy = true;
    try {
      const rows = await parseExcelRows(file, columns.map((c) => c.header));
      if (rows.length === 0) {
        notify('The file contains no data rows.', 'error');
        return;
      }
      const result = await onImport(rows);
      if (result.errors && result.errors.length > 0) {
        notify(`${result.imported} / ${rows.length} imported — ${result.errors.length} failed. See console for details.`, 'error');
        console.group('Import errors');
        result.errors.forEach((m) => console.error(m));
        console.groupEnd();
      } else {
        notify(`${result.imported} ${label} imported`, 'success');
      }
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="import-bar">
  <button type="button" class="btn-sm" on:click={download} title="Download an Excel template">⬇ Template</button>
  <label class="btn-sm btn-primary upload" class:disabled={busy}>
    {busy ? 'Importing…' : '⬆ Upload Excel'}
    <input type="file" accept=".xlsx,.xls,.csv" hidden on:change={handleFile} />
  </label>
</div>

<style>
  .import-bar {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .upload {
    color: #fff;
  }
  .upload.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  .upload input {
    display: none;
  }
</style>