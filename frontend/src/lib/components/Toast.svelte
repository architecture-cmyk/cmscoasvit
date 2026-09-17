<script>
  import { toast } from '$lib/stores';
</script>

{#if $toast}
  <div class="toast toast-{$toast.type}" role="status">
    {$toast.message}
  </div>
{/if}