<script lang="ts">
  import { untrack } from 'svelte'
  import { createFigure } from '../../src/ui/figure.svelte.js'

  let { opts, onHandle, bound = false, onSwap = () => {} }: { opts: any; onHandle: (figure: any) => void; bound?: boolean; onSwap?: (swap: () => void) => void } = $props()
  let chart: HTMLElement | undefined = $state()
  let generation = $state(0)
  untrack(() => onSwap(() => generation++))
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
  {#key generation}
    <div id="probe-chart" bind:this={chart}><span class="mark">m</span><span class="bg">b</span></div>
  {/key}
{/if}
