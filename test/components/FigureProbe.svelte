<script lang="ts">
  import { untrack } from 'svelte'
  import { createFigure } from '../../src/ui/figure.svelte.js'

  let { opts, onHandle }: { opts: any; onHandle: (figure: any) => void } = $props()
  const figure = untrack(() => {
    const made = createFigure(opts)
    onHandle(made)
    return made
  })
</script>

<p id="probe-data">{JSON.stringify(figure.data ?? null)}</p>
<p id="probe-loading">{String(figure.loading)}</p>
<p id="probe-error">{figure.error ? 'error' : ''}</p>
