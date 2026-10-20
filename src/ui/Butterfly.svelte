<script lang="ts">
  import type { ButterflyGroup, ButterflyRow, ButterflyScale, ButterflySide } from './butterfly-model.js'
  import { fmt, label } from './format.js'

  type Pick = { term: string; kind: string }

  let {
    groups,
    scale,
    labelA,
    labelB,
    selected,
    onpick,
    ariaLabel,
  }: {
    groups: ButterflyGroup[]
    scale: ButterflyScale
    labelA: string
    labelB: string
    selected: Pick | null
    onpick: (term: string, kind: string) => void
    ariaLabel: string
  } = $props()

  const MAX_LABEL = 26

  const titles = $derived<Record<string, string>>({ a: `só ${labelA}`, both: 'dos dois', b: `só ${labelB}` })
  const isPicked = (r: Pick) => !!selected && selected.term === r.term && selected.kind === r.kind
  const text = (r: ButterflyRow) => label(r)
  const shown = (r: ButterflyRow) => (text(r).length > MAX_LABEL ? text(r).slice(0, MAX_LABEL - 1) + '…' : text(r))
  const fraction = (side: ButterflySide) => (scale.domain > 0 ? side.share / scale.domain : 0)
  const at = (tick: number) => (scale.domain > 0 ? tick / scale.domain : 0)
  const docs = (name: string, side: ButterflySide | null) => (side ? `${name} ${fmt(side.count)} documentos` : `${name} nenhum documento`)
  const aria = (r: ButterflyRow) => `${text(r)}: ${docs(labelA, r.a)}, ${docs(labelB, r.b)}`
  const onkey = (event: KeyboardEvent, r: ButterflyRow) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onpick(r.term, r.kind)
  }
</script>

<div class="butterfly-chart" role="group" aria-label={ariaLabel}>
  <div class="butterfly-axes">
    {#each [['a', labelA], ['b', labelB]] as [side, name] (side)}
      <div class="butterfly-axis is-{side}" data-side={side}>
        <span class="butterfly-axis-label cmp-{side}">{name}</span>
        <span class="butterfly-axis-ticks">
          {#each scale.ticks as tick (tick)}
            <span class="butterfly-axis-tick" style:--at={at(tick)}>{fmt(tick)}%</span>
          {/each}
        </span>
      </div>
    {/each}
  </div>
  {#each groups as group (group.key)}
    <div class="butterfly-group" data-group={group.key} role="group" aria-label={titles[group.key]}>
      <p class="butterfly-group-head">{titles[group.key]}</p>
      {#each group.rows as r (r.kind + ':' + r.term)}
        <div
          class="butterfly-row"
          class:is-selected={isPicked(r)}
          data-term={r.term}
          data-kind={r.kind}
          data-bridge={r.bridge ? '1' : undefined}
          role="button"
          tabindex="0"
          aria-pressed={isPicked(r)}
          aria-label={aria(r)}
          onclick={() => onpick(r.term, r.kind)}
          onkeydown={(event) => onkey(event, r)}
        >
          <span class="butterfly-side is-a">
            {#if r.a}
              <span class="butterfly-track"><span class="butterfly-bar cmp-a" data-side="a" style:--bar={fraction(r.a)}></span><span class="butterfly-count">{fmt(r.a.count)}</span></span>
            {/if}
          </span>
          <span class="butterfly-label" title={text(r).length > MAX_LABEL ? text(r) : undefined}>
            {#if r.bridge}<span class="butterfly-bridge-mark" aria-hidden="true"></span><span class="sr-only">ponte</span>{/if}
            <span class="butterfly-word">{shown(r)}</span>
          </span>
          <span class="butterfly-side is-b">
            {#if r.b}
              <span class="butterfly-track"><span class="butterfly-bar cmp-b" data-side="b" style:--bar={fraction(r.b)}></span><span class="butterfly-count">{fmt(r.b.count)}</span></span>
            {/if}
          </span>
        </div>
      {/each}
    </div>
  {/each}
</div>
