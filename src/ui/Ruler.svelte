<script lang="ts">
  import type { Snippet } from 'svelte'
  import { fmt } from './format.js'

  type Word = { term: string; kind: string; text: string; x: number; y: number; size: number; w: number; h: number; cmp: string; bridge: boolean; aria: string; title: string }
  type Spilled = { term: string; kind: string; text: string; cmp: string }
  type Pick = { term: string; kind: string }

  let {
    width,
    height,
    half,
    x0,
    x1,
    ticks,
    endA,
    endB,
    axisLabels,
    ariaLabel,
    note,
    words,
    overflow,
    selected,
    onpick,
    tail,
  }: {
    width: number
    height: number
    half: number
    x0: number
    x1: number
    ticks: number[]
    endA: string
    endB: string
    axisLabels: [string, string, string]
    ariaLabel: string
    note: string
    words: Word[]
    overflow: Spilled[]
    selected: Pick | null
    onpick: (term: string, kind: string) => void
    tail?: Snippet
  } = $props()

  const uid = $props.id()
  // The scale sits under the words, never through them: a line across a word is a strike-through.
  const SCALE = 30
  const isPicked = (d: Pick) => !!selected && selected.term === d.term && selected.kind === d.kind
  const onkey = (event: KeyboardEvent, d: Pick) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onpick(d.term, d.kind)
  }
</script>

<div class="ruler-end-row"><span class="ruler-end cmp-a">{endA}</span><span class="ruler-end cmp-b">{endB}</span></div>
<svg class="ruler-svg" {width} height={height + SCALE} viewBox="0 0 {width} {height + SCALE}" role="group" aria-label={ariaLabel}>
  <defs>
    <linearGradient id="ruler-scale-{uid}" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" class="ruler-stop-a" />
      <stop offset="0.5" class="ruler-stop-mid" />
      <stop offset="1" class="ruler-stop-b" />
    </linearGradient>
  </defs>
  {#each ticks as tick, i}
    <line class="ruler-guide" class:is-centre={i === (ticks.length - 1) / 2} x1={tick} x2={tick} y1="0" y2={height + 6} />
  {/each}
  <rect class="ruler-axis" x={x0} y={height + 12} width={x1 - x0} height="4" rx="2" fill="url(#ruler-scale-{uid})" />
  {#each ticks as tick}
    <line class="ruler-tick" x1={tick} x2={tick} y1={height + 8} y2={height + 20} />
  {/each}
  {#each words as d (d.kind + ':' + d.term)}
    <g
      class="ruler-word"
      class:is-selected={isPicked(d)}
      class:ruler-bridge={d.bridge}
      transform="translate({d.x},{half + d.y})"
      style:--size="{d.size}px"
      style:--cmp={d.cmp}
      data-term={d.term}
      data-kind={d.kind}
      role="button"
      tabindex="0"
      aria-pressed={isPicked(d)}
      aria-label={d.aria}
      onclick={() => onpick(d.term, d.kind)}
      onkeydown={(event) => onkey(event, d)}
    >
      <title>{d.title}</title>
      <rect class="ruler-glow" x={-d.w / 2 - 4} y={-d.h / 2 - 3} width={d.w + 8} height={d.h + 6} />
      <rect class="ruler-hit" x={-d.w / 2} y={-d.h / 2} width={d.w} height={d.h} />
      <text class="ruler-text" text-anchor="middle" dominant-baseline="central"><tspan x="0" y="0">{d.text}</tspan></text>
      {#if d.bridge}
        <path class="ruler-bridge-mark" d="M{-d.w / 2 - 12} 0l4.5-4.5 4.5 4.5-4.5 4.5z" />
      {/if}
    </g>
  {/each}
</svg>
<div class="ruler-axis-labels"><span>{axisLabels[0]}</span><span>{axisLabels[1]}</span><span>{axisLabels[2]}</span></div>
{#if note}<p class="note">{note}</p>{/if}
{#if overflow.length}
  <div class="ruler-overflow">
    <p>{fmt(overflow.length)} {overflow.length === 1 ? 'palavra não coube' : 'palavras não couberam'} na régua sem cobrir as outras. Todas continuam clicáveis aqui:</p>
    {#each overflow as d (d.kind + ':' + d.term)}
      <button class="quiet-button" class:is-selected={isPicked(d)} data-term={d.term} data-kind={d.kind} aria-pressed={isPicked(d)} style:--cmp={d.cmp} onclick={() => onpick(d.term, d.kind)}>{d.text}</button>
    {/each}
  </div>
{/if}
{@render tail?.()}
