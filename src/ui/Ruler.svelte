<script lang="ts">
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
    overflowIntro,
    selected,
    onpick,
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
    overflowIntro: string
    selected: Pick | null
    onpick: (term: string, kind: string) => void
  } = $props()

  const isPicked = (d: Pick) => !!selected && selected.term === d.term && selected.kind === d.kind
  const onkey = (event: KeyboardEvent, d: Pick) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onpick(d.term, d.kind)
  }
</script>

<div class="ruler-end-row"><span class="ruler-end cmp-a">{endA}</span><span class="ruler-end cmp-b">{endB}</span></div>
<svg class="ruler-svg" {width} {height} viewBox="0 0 {width} {height}" role="group" aria-label={ariaLabel}>
  <line class="ruler-axis" x1={x0} x2={x1} y1={half} y2={half} />
  {#each ticks as tick}
    <line class="ruler-tick" x1={tick} x2={tick} y1={half - 5} y2={half + 5} />
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
        <line class="ruler-bridge-mark" x1={-d.w / 2} x2={d.w / 2} y1={d.h / 2} y2={d.h / 2} />
      {/if}
    </g>
  {/each}
</svg>
<div class="ruler-axis-labels"><span>{axisLabels[0]}</span><span>{axisLabels[1]}</span><span>{axisLabels[2]}</span></div>
{#if note}<p class="note">{note}</p>{/if}
{#if overflow.length}
  <div class="ruler-overflow">
    <p>{overflowIntro}</p>
    {#each overflow as d (d.kind + ':' + d.term)}
      <button class="quiet-button" class:is-selected={isPicked(d)} data-term={d.term} data-kind={d.kind} aria-pressed={isPicked(d)} style:--cmp={d.cmp} onclick={() => onpick(d.term, d.kind)}>{d.text}</button>
    {/each}
  </div>
{/if}
