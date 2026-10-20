<script lang="ts">
  import { fmt, label, ratioText, type DumbbellModel, type DumbbellRow } from './format.js'

  type Pick = { term: string; kind: string }

  let { model, selected, onpick }: { model: DumbbellModel; selected: Pick | null; onpick: (term: string, kind: string) => void } = $props()

  const percent = (value: number) => `${Number(Math.min(100, Math.max(0, (value / model.max) * 100)).toFixed(3))}%`
  const isPicked = (d: Pick) => !!selected && selected.term === d.term && selected.kind === d.kind
  const per = $derived(model.unit === 'mil' ? 'a cada mil palavras' : 'a cada cem textos')
  const caption = $derived(model.unit === 'mil' ? 'Ocorrências a cada mil palavras escritas sobre a pessoa; uma palavra conta uma vez por texto.' : 'Textos com a palavra, a cada cem textos sobre a pessoa.')
  const value = (v: number | null) => (v === null ? 'sem valor' : `${fmt(v)} ${per}`)
  const aria = (r: DumbbellRow) => `${label(r)}, antes ${value(r.before)}, agora ${value(r.now)}, ${ratioText(r)}`
  const onkey = (event: KeyboardEvent, d: Pick) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onpick(d.term, d.kind)
  }
</script>

<div class="dumbbell-legend"><span class="dumbbell-end cmp-a">antes (14 dias)</span><span class="dumbbell-end cmp-b">agora (7 dias)</span></div>
<div class="dumbbell-chart" role="group" aria-label="Gráfico de termos em alta">
  <div class="dumbbell-axis" aria-hidden="true">
    <span class="dumbbell-axis-ticks">
      {#each model.ticks as tick (tick.value)}
        <span class="dumbbell-tick" style:--x={percent(tick.value)}>{tick.label}</span>
      {/each}
    </span>
  </div>
  {#each model.rows as r (r.kind + ':' + r.term)}
    <div
      class="dumbbell-row"
      class:is-selected={isPicked(r)}
      data-term={r.term}
      data-kind={r.kind}
      role="button"
      tabindex="0"
      aria-pressed={isPicked(r)}
      aria-label={aria(r)}
      onclick={() => onpick(r.term, r.kind)}
      onkeydown={(event) => onkey(event, r)}
    >
      <span class="dumbbell-label" title={label(r)}>{label(r)}</span>
      <span class="dumbbell-plot">
        {#each model.ticks as tick (tick.value)}
          <span class="dumbbell-gridline" style:--x={percent(tick.value)}></span>
        {/each}
        {#if r.before !== null && r.now !== null}
          <span class="dumbbell-line" style:--x0={percent(Math.min(r.before, r.now))} style:--x1={percent(Math.max(r.before, r.now))}></span>
        {/if}
        {#if r.before !== null}<span class="dumbbell-dot cmp-a" data-dot="before" style:--x={percent(r.before)}></span>{/if}
        {#if r.now !== null}<span class="dumbbell-dot cmp-b" data-dot="now" style:--x={percent(r.now)}></span>{/if}
      </span>
      <span class="dumbbell-ratio">{ratioText(r)}</span>
    </div>
  {/each}
</div>
<p class="dumbbell-caption">{caption}</p>
