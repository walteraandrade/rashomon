<script lang="ts">
  import { createFigure } from '../../src/ui/figure.svelte.js'

  let { opts, onHandle }: { opts: any; onHandle: (figure: any) => void } = $props()
  const figure = createFigure(opts)
  onHandle(figure)
</script>

<p id="probe-data">{JSON.stringify(figure.data ?? null)}</p>
<p id="probe-loading">{String(figure.loading)}</p>
<p id="probe-error">{figure.error ? 'error' : ''}</p>
