<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import * as api from './api.js'
  import { bootData } from './boot.svelte.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import { fmt, kinds, SOURCE_SEGMENTS, sourceLabels, weekDayIso, weekDayLabel, type Week } from './format.js'
  import { WEEK_COLUMN_WIDTH, weekLayout } from './layout.js'
  import { createCanvasMeasure } from './measure.js'
  import { seedFor } from './seed.js'

  type Picked = { day: string; term: string; kind: string }

  const LIMITS = ['5', '8', '12']
  const GHOST_WORDS: [number, number][] = [
    [-30, 44],
    [18, 78],
    [-14, 112],
  ]
  const GHOST_HEIGHT = 150

  let mounted = $state(false)
  let chartEl: HTMLElement | undefined = $state()
  let person = $state('')
  let source = $state(SOURCE_SEGMENTS[0][0])
  let limit = $state('8')
  let selected = $state.raw<Picked | null>(null)
  let width = $state(WEEK_COLUMN_WIDTH)
  let tick = $state(0)
  let started = false
  let lastData: Week | undefined
  let metrics: ReturnType<typeof createCanvasMeasure> | null = null

  const people = $derived(bootData.people)
  const peopleFailed = $derived(bootData.ready && !!bootData.peopleError)
  const peopleEmpty = $derived(bootData.ready && !bootData.peopleError && people.length === 0)

  const params = (): URLSearchParams | null => {
    if (!bootData.ready || bootData.peopleError || !people.length) return null
    const qp = api.weekParams({ source, limit })
    qp.set('person', person)
    return qp
  }

  const isSelected = (day: string, d: { term: string; kind: string }) =>
    !!selected && selected.day === day && selected.term === d.term && selected.kind === d.kind

  const showDocs = (word: Picked) => {
    const found = people.find((p) => p.id === person)
    const bucket = figure.data?.buckets.find((b) => weekDayIso(b.start) === word.day)
    const day = bucket ? weekDayLabel(bucket.start) : word.day
    void docsCard.open({
      owner: 'week',
      kicker: `Documentos com ${kinds[word.kind] ? kinds[word.kind].toLowerCase() : 'o termo'} · ${day}`,
      title: word.term,
      sides: [
        {
          personId: person,
          personName: found?.name ?? person,
          label: found?.name ?? person,
          query: api.docsParams({ days: '7', source, term: word.term, kind: word.kind, day: word.day }),
        },
      ],
    })
  }

  const pick = (day: string, term: string, kind: string) => {
    if (selected && selected.day === day && selected.term === term && selected.kind === kind) {
      figure.release()
      return
    }
    selected = { day, term, kind }
    showDocs(selected)
  }

  const dropStalePick = () => {
    if (docsCard.openedBy('week')) docsCard.close()
    selected = null
  }

  const figure = createFigure<Week>({
    name: 'week',
    params,
    fetch: (qp, signal) => api.loadWeek(qp.get('person')!, api.weekParams({ source: qp.get('source')!, limit: qp.get('limit')! }), signal),
    ghost: () => {},
    paint: (result) => {
      if (result !== lastData) dropStalePick()
      lastData = result
      tick++
    },
    paintError: () => {
      lastData = undefined
      dropStalePick()
    },
    detail: (_data, qp) => ({ person: qp.get('person') }),
    el: () => chartEl,
    markSelector: '[data-term]',
    onRelease: () => {
      selected = null
    },
  })

  const onControlChange = () => {
    figure.release()
    figure.reload()
  }

  onMount(() => {
    mounted = true
  })

  // Waits for the people list: painting "Nenhuma pessoa cadastrada." before it arrives would lie.
  $effect(() => {
    if (!bootData.ready || started) return
    started = true
    untrack(() => {
      const seed = seedFor('week', ['person', 'source', 'limit'], bootData.search)
      person = seed.person && people.some((p) => p.id === seed.person) ? seed.person : (people[0]?.id ?? '')
      if (seed.source !== undefined && SOURCE_SEGMENTS.some(([value]) => value === seed.source)) source = seed.source
      if (seed.limit !== undefined && LIMITS.includes(seed.limit)) limit = seed.limit
      void figure.load()
    })
  })

  // The svg is drawn at the column's real width, never scaled; the grid sets it, not the content.
  $effect(() => {
    void tick
    void figure.data
    void ghost
    if (!chartEl) return
    const measured = chartEl.querySelector<HTMLElement>('.week-day')?.clientWidth
    if (measured && Math.floor(measured) !== untrack(() => width)) width = Math.floor(measured)
  })

  const layouts = $derived.by(() => {
    const data = figure.data
    if (!data) return []
    metrics ??= createCanvasMeasure()
    return weekLayout(
      metrics,
      data.buckets.map((b) => b.terms),
      width,
    )
  })

  const columns = $derived(
    (figure.data?.buckets ?? []).map((bucket, i) => ({ bucket, layout: layouts[i], day: weekDayIso(bucket.start), label: weekDayLabel(bucket.start) })),
  )

  const ghost = $derived(mounted && !peopleFailed && !peopleEmpty && figure.data === undefined && (figure.loading || !figure.error))
  const failed = $derived(!ghost && !!figure.error && !figure.loading && figure.data === undefined)
  const emptyWeek = $derived(!!figure.data && figure.data.buckets.every((b) => !b.terms.length))
  const note = $derived(
    peopleFailed
      ? 'Falha de rede ou base indisponível.'
      : peopleEmpty
        ? 'Nenhuma pessoa cadastrada.'
        : failed
          ? 'Não foi possível carregar a semana.'
          : emptyWeek
            ? 'Não há palavras suficientes nesta semana.'
            : '',
  )
  const shown = $derived(ghost || (!!figure.data && !peopleFailed && !peopleEmpty))
  const dimmed = $derived(figure.loading && figure.data !== undefined)
  const keyPick = (event: KeyboardEvent, go: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      go()
    }
  }
</script>

<section class="figure week" class:is-loading={dimmed} id="week" aria-labelledby="weekTitle">
  <header class="figure-head">
    <div class="figure-title"><span class="eyebrow">Gráfico 5</span><h2 id="weekTitle">A semana</h2></div>
    <p class="figure-sub">Quais palavras ocuparam cada dia dos últimos sete. <a href="/como-ler#semana">Como ler</a>.</p>
    <dl class="figure-key">
      <div><dt><span class="type-scale" aria-hidden="true"><span>Aa</span><span>Aa</span></span>Tamanho</dt><dd>documentos naquele dia</dd></div>
      <div><dt>Posição</dt><dd>só o dia; a altura na coluna não mede nada</dd></div>
      <div><dt>Clique</dt><dd>os textos daquele dia</dd></div>
    </dl>
    <div class="sentence">
      <p class="sentence-line">
        Na semana de <span class="keep"><span class="pick"><select id="weekPerson" aria-label="Pessoa (semana)" bind:value={person} onchange={onControlChange}>{#each people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span>,</span>
        em <span class="keep"><span class="pick"><select id="weekSource" aria-label="Fonte (semana)" bind:value={source} onchange={onControlChange}>{#each SOURCE_SEGMENTS as [value, text] (value)}<option {value}>{sourceLabels[value] ?? text}</option>{/each}</select></span>,</span>
        as palavras que mais ocuparam cada dia. Mostrar <span class="pick"><select id="weekLimit" aria-label="Quantidade de palavras por dia" bind:value={limit} onchange={onControlChange}>{#each LIMITS as n (n)}<option value={n}>{n}</option>{/each}</select></span> palavras por dia.
      </p>
    </div>
  </header>
  <figure class="week-chart" id="weekChart" aria-label="Palavras da semana, uma coluna por dia" aria-busy={ghost} hidden={!shown} bind:this={chartEl}>
    {#if ghost}
      <div class="ghost-field" aria-hidden="true">
        <div class="week-columns">
          {#each { length: 7 } as _, i (i)}
            <div class="week-day">
              <span class="ghost ghost-line is-short"></span>
              <svg class="week-svg" viewBox="0 0 {WEEK_COLUMN_WIDTH} {GHOST_HEIGHT}" width={WEEK_COLUMN_WIDTH} height={GHOST_HEIGHT}>
                {#each GHOST_WORDS as [y, w] (y)}
                  <rect class="ghost" x={WEEK_COLUMN_WIDTH / 2 - w / 2} y={GHOST_HEIGHT / 2 + y - 8} width={w} height="16" rx="5" />
                {/each}
              </svg>
            </div>
          {/each}
        </div>
      </div>
      <p class="sr-only">Lendo a semana.</p>
    {:else if figure.data}
      <div class="week-columns">
        {#each columns as { bucket, layout, day, label } (bucket.start)}
          <div class="week-day">
            <dl class="stat"><div><dt>{label}</dt><dd>{fmt(bucket.about)}</dd></div></dl>
            {#if layout.words.length}
              <svg class="week-svg" {width} height={layout.height} viewBox="0 0 {width} {layout.height}" role="group" aria-label="Palavras de {label}">
                {#each layout.words as d (d.kind + '\u0000' + d.term)}
                  {@const on = isSelected(day, d)}
                  {@const lineHeight = d.h / d.lines.length}
                  <!-- svelte-ignore a11y_click_events_have_key_events -- Enter and Space are handled by onkeydown on the same element -->
                  <g
                    class="week-word {on ? 'is-selected' : ''}"
                    transform="translate({width / 2 + d.x},{layout.half + d.y})"
                    style:--size="{d.size}px"
                    data-term={d.term}
                    data-kind={d.kind}
                    data-day={day}
                    role="button"
                    tabindex="0"
                    aria-pressed={on}
                    aria-label="{d.text}, {fmt(d.count)} documentos neste dia"
                    onclick={() => pick(day, d.term, d.kind)}
                    onkeydown={(event) => keyPick(event, () => pick(day, d.term, d.kind))}
                  >
                    <title>{d.text} · {kinds[d.kind] || d.kind || 'Tipo desconhecido'} · {fmt(d.count)} documentos</title>
                    <rect class="week-glow" x={-d.w / 2 - 4} y={-d.h / 2 - 3} width={d.w + 8} height={d.h + 6} />
                    <rect class="week-hit" x={-d.w / 2} y={-d.h / 2} width={d.w} height={d.h} />
                    <text class="week-text" text-anchor="middle" dominant-baseline="central">{#each d.lines as line, li (li)}<tspan x="0" y={(li - (d.lines.length - 1) / 2) * lineHeight}>{line}</tspan>{/each}</text>
                  </g>
                {/each}
              </svg>
            {/if}
            {#if layout.overflow.length}
              <div class="week-overflow">
                <p class="eyebrow">{layout.overflow.length === 1 ? 'Não coube' : 'Não couberam'}</p>
                {#each layout.overflow as d (d.kind + '\u0000' + d.term)}
                  {@const on = isSelected(day, d)}
                  <button class="quiet-button {on ? 'is-selected' : ''}" data-term={d.term} data-kind={d.kind} data-day={day} aria-pressed={on} aria-label="{d.text}, {fmt(d.count)} documentos neste dia" onclick={() => pick(day, d.term, d.kind)}>{d.text}<b>{fmt(d.count)}</b></button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </figure>
  <p class="note" id="weekNote">{note}</p>
</section>
