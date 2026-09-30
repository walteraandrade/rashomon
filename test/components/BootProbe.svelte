<script lang="ts">
  import { bootData } from '../../src/ui/boot.svelte.js'
</script>

<p>{bootData.ready ? `ready ${bootData.people.map((p) => p.name).join(',')} ${bootData.search}` : 'waiting'}{bootData.peopleError ? ' error' : ''}</p>
