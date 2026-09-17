<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { restoreSession } from '$lib/restore';
  import { session } from '$lib/stores';

  onMount(() => {
    restoreSession();
  });
</script>

<div>
  <slot />
</div>