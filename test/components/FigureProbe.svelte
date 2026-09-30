<script lang="ts">
  import { untrack } from 'svelte'
  import { createFigure } from '../../src/ui/figure.svelte.js'

  let { opts, onHandle, bound = false }: { opts: any; onHandle: (figure: any) => void; bound?: boolean } = $props()
  let chart: HTMLElement | undefined = $state()
  const figure = untrack(() => {
    const made = createFigure(bound ? { ...opts, el: () => chart } : opts)
    onHandle(made)
    return made
  })
</script>

<p id="probe-data">{JSON.stringify(figure.data ?? null)}</p>
<p id="probe-loading">{String(figure.loading)}</p>
<p id="probe-error">{figure.error ? 'error' : ''}</p>
{#if bound}
  <div id="probe-chart" bind:this={chart}><span class="mark">m</span><span class="bg">b</span></div>
{/if}
