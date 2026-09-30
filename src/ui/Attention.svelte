<script lang="ts">
  import { untrack } from 'svelte'
  import * as api from './api.js'
  import { bootData } from './boot.svelte.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import { SOURCE_SEGMENTS, attentionDayLabel, attentionNoteText, fmt, sourceLabels, type Attention } from './format.js'
  import { ATTENTION_ROW_WIDTH, attentionLayout, peakDay, type AttentionMark } from './layout.js'
  import { createCanvasMeasure } from './render.js'
  import { seedFor } from './seed.js'

  type TimelineBucket = { bucket_start: string; count: number }
  type Keyed<T> = { key: string; data: T }
  type Companion = Map<string, string>

  const OWNER = 'attention'
  const ROW_HEIGHT = 64
  const BASELINE = ROW_HEIGHT - 12
  const GHOST_BARS = [10, 22, 14, 30, 18, 26]
  const VIEWS_LABEL = 'Pageviews (Wikipédia)'
  const ROW_NOTE = { mentions: 'sem dado de menções para esta pessoa nesta janela', views: 'sem dado de pageviews para esta pessoa' }

  // The UTC date of a /timeline bucket's start, the calendar /attention's own days speak in; never BRT.
  const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10)

  let person = $state('')
  let source = $state(SOURCE_SEGMENTS[0][0])
  let unavailable = $state(false)
  let unavailableText = $state('')
  let buckets = $state.raw<TimelineBucket[] | null>(null)
  let series = $state.raw<{ day: string; views: number }[] | null>(null)
  let viewsErrored = $state(false)
  let mentionsErrored = $state(false)
  let selected = $state<string | null>(null)
  let chartWidth = $state(0)
  let chart: HTMLElement | undefined = $state()
  let started = false

  // The prerender has no document; attentionLayout never measures text, so a stub serves there.
  let metrics: ReturnType<typeof createCanvasMeasure> | null = null
  const measured = () => (metrics ??= typeof document === 'undefined' ? () => 0 : createCanvasMeasure())

  const measure = () => {
    const width = chart?.clientWidth
    if (width) chartWidth = width
  }

  const withoutPerson = (queryParams: URLSearchParams) => {
    const p = new URLSearchParams(queryParams)
    p.delete('person')
    return p
  }

  // A rejection carries the key a success would, without disturbing AbortError's own shape.
  const tagKey = <T,>(key: string, p: Promise<T>): Promise<Keyed<T>> =>
    p.then(
      (data) => ({ key, data }),
      (e) => {
        if (e && typeof e === 'object' && Object.isExtensible(e)) (e as { key?: string }).key = key
        throw e
      },
    )

  const mentionsKey = () => `${person}|${source}`
  const keyOfError = (e: unknown) => (e as { key?: string } | null)?.key

  const dropStalePick = () => {
    if (docsCard.openedBy(OWNER)) docsCard.close()
    selected = null
  }

  const canFetch = () => !bootData.peopleError && bootData.people.length > 0

  const pick = (day: string) => {
    if (selected === day) {
      views.release()
      return
    }
    selected = day
    const found = bootData.people.find((p) => p.id === person)
    void docsCard.open({
      owner: OWNER,
      kicker: `Documentos de ${attentionDayLabel(day)}`,
      title: day,
      sides: [{ personId: person, personName: found?.name ?? person, query: api.docsParams({ days: '30', source, term: '', kind: api.ATLAS_KINDS, day }) }],
    })
  }

  const onKey = (e: KeyboardEvent, day: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    pick(day)
  }

  // The docs card is owned by 'attention', so only this instance carries el/markSelector/onRelease.
  const views = createFigure<Keyed<Attention>>({
    name: 'attention',
    params: () => {
      if (!canFetch()) return null
      const qp = api.attentionParams({})
      qp.set('person', person)
      return qp
    },
    fetch: (qp, signal) => tagKey(qp.get('person') ?? '', api.loadAttention(qp.get('person')!, withoutPerson(qp), signal)),
    ghost: () => {},
    paint: ({ key, data }) => {
      if (key !== person) return
      if (data.series !== series) dropStalePick()
      series = data.series
      viewsErrored = false
      measure()
    },
    paintError: (e) => {
      const key = keyOfError(e)
      if (key !== undefined && key !== person) return
      dropStalePick()
      series = null
      viewsErrored = true
    },
    detail: (_data, qp) => ({ person: qp.get('person') }),
    el: () => chart,
    markSelector: '[data-day]',
    onRelease: () => {
      selected = null
    },
  })

  const mentionsFigure = createFigure<Keyed<TimelineBucket[]>>({
    name: 'mentions',
    params: () => {
      if (!canFetch()) return null
      return new URLSearchParams({ term: '', kind: api.ATLAS_KINDS, days: '30', bucket: 'day', source, person })
    },
    fetch: (qp, signal) => tagKey(`${qp.get('person') ?? ''}|${qp.get('source') ?? ''}`, api.loadTimeline(qp.get('person')!, withoutPerson(qp), signal)),
    ghost: () => {},
    paint: ({ key, data }) => {
      if (key !== mentionsKey()) return
      if (data !== buckets) dropStalePick()
      buckets = data
      mentionsErrored = false
      measure()
    },
    paintError: (e) => {
      const key = keyOfError(e)
      if (key !== undefined && key !== mentionsKey()) return
      dropStalePick()
      buckets = null
      mentionsErrored = true
    },
    detail: (_data, qp) => ({ person: qp.get('person') }),
  })

  const start = () => {
    const initial = seedFor('attention', ['person', 'source'], bootData.search)
    if (bootData.peopleError || !bootData.people.length) {
      unavailable = true
      unavailableText = bootData.peopleError ? 'Falha de rede ou base indisponível.' : 'Nenhuma pessoa cadastrada.'
      return
    }
    const seeded = initial.person
    person = seeded && bootData.people.some((p) => p.id === seeded) ? seeded : bootData.people[0].id
    if (initial.source !== undefined && SOURCE_SEGMENTS.some(([value]) => value === initial.source)) source = initial.source
    measure()
    void views.load()
    void mentionsFigure.load()
  }

  $effect(() => {
    if (!bootData.ready || started) return
    started = true
    untrack(start)
  })

  // Width follows the chart itself, so a failed /attention (no views paint) still repaints the mentions row.
  $effect(() => {
    if (!chart) return
    untrack(measure)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(chart)
    return () => observer.disconnect()
  })

  // A person change must never paint one series against the other's previous-person data.
  const onPerson = (e: Event) => {
    person = (e.currentTarget as HTMLSelectElement).value
    views.release()
    buckets = null
    series = null
    viewsErrored = false
    mentionsErrored = false
    views.reload()
    mentionsFigure.reload()
  }

  // /attention has no source: only the mentions row refetches, the views row stays as it is.
  const onSource = (e: Event) => {
    source = (e.currentTarget as HTMLSelectElement).value
    views.release()
    mentionsFigure.reload()
  }

  const mentions = $derived(buckets ? buckets.map((b) => ({ day: utcDay(b.bucket_start), count: b.count })) : null)
  const viewDays = $derived.by(() => {
    if (!series) return null
    if (!mentions) return series
    const byDay = new Map(series.map((s) => [s.day, s.views]))
    return mentions.map((m) => ({ day: m.day, views: byDay.get(m.day) ?? 0 }))
  })
  const layout = $derived(attentionLayout(measured(), mentions ?? [], viewDays ?? [], chartWidth || ATTENTION_ROW_WIDTH))
  const fullGhost = $derived(!unavailable && mentions === null && !mentionsErrored)
  const viewsPending = $derived(series === null && !viewsErrored)
  const busy = $derived(!unavailable && (fullGhost || viewsPending))
  // Only a reload over data already on screen dims: never the first ghost, never the views-only ghost.
  // The views instance reloads only with a person change, which clears series first, so it never dims alone.
  const dim = $derived(mentionsFigure.loading && buckets !== null)
  const mentionsPeak = $derived(mentions ? peakDay(mentions.map((m) => ({ day: m.day, value: m.count }))) : null)
  const viewsPeak = $derived(viewDays && !viewsErrored ? peakDay(viewDays.map((v) => ({ day: v.day, value: v.views }))) : null)
  const peakOf = (days: { day: string }[] | null, peak: string | null, pick: (d: never) => number) => (peak && days ? pick(days.find((d) => d.day === peak) as never) : 0)
  const mentionsPeakValue = $derived(peakOf(mentions, mentionsPeak, (d: { count: number }) => d.count))
  const viewsPeakValue = $derived(peakOf(viewDays, viewsPeak, (d: { views: number }) => d.views))
  const note = $derived(unavailable ? unavailableText : fullGhost || viewsPending || viewsErrored ? '' : attentionNoteText(mentionsPeak, viewsPeak))
  const companion = (marks: AttentionMark[]): Companion => new Map(marks.map((m) => [m.day, m.text]))
  const mentionsByDay = $derived(companion(layout.mentions))
  const viewsByDay = $derived(companion(layout.views))
  const ticks = (marks: AttentionMark[]) => marks.map((m) => m.x)
  const ghostStep = $derived(layout.width / GHOST_BARS.length)
  const ghostX = (i: number) => Math.round(ghostStep * (i + 0.5))
</script>

{#snippet bars(marks: AttentionMark[], other: Companion, interactive: boolean)}
  {#each marks as m (m.day)}
    {@const isSelected = selected === m.day}
    {@const title = interactive ? `${attentionDayLabel(m.day)}, ${m.text} documentos, ${other.get(m.day) ?? '0'} visualizações` : `${attentionDayLabel(m.day)}, ${other.get(m.day) ?? '0'} documentos, ${m.text} visualizações`}
    {#if interactive}
      <g class="attention-mark {isSelected ? 'is-selected' : ''}" transform="translate({m.x},{BASELINE})" data-day={m.day} role="button" tabindex="0" aria-pressed={isSelected} aria-label={title} onclick={() => pick(m.day)} onkeydown={(e) => onKey(e, m.day)}>
        <title>{title}</title>
        <rect class="attention-hit" x={-m.barW / 2} y={-BASELINE} width={m.barW} height={ROW_HEIGHT} />
        <rect class="attention-glow" x={-m.barW / 2} y={-m.size - 4} width={m.barW} height={m.size + 8} />
        <rect class="attention-bar" x={-m.barW / 2} y={-m.size} width={m.barW} height={m.size} />
      </g>
    {:else}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <g class="attention-mark {isSelected ? 'is-selected' : ''}" transform="translate({m.x},{BASELINE})" data-day={m.day} tabindex="-1" aria-hidden="true" onclick={() => pick(m.day)}>
        <title>{title}</title>
        <rect class="attention-hit" x={-m.barW / 2} y={-BASELINE} width={m.barW} height={ROW_HEIGHT} />
        <rect class="attention-glow" x={-m.barW / 2} y={-m.size - 4} width={m.barW} height={m.size + 8} />
        <rect class="attention-bar" x={-m.barW / 2} y={-m.size} width={m.barW} height={m.size} />
      </g>
    {/if}
  {/each}
{/snippet}

{#snippet svgRow(label: string, marks: AttentionMark[], other: Companion, interactive: boolean)}
  <svg class="attention-svg" width={layout.width} height={ROW_HEIGHT} viewBox="0 0 {layout.width} {ROW_HEIGHT}" role="group" aria-label={label}>
    <line class="attention-axis" x1="0" x2={layout.width} y1={BASELINE} y2={BASELINE} />
    {#each ticks(marks) as x}
      <line class="attention-tick" x1={x} x2={x} y1={BASELINE - 5} y2={BASELINE + 5} />
    {/each}
    {@render bars(marks, other, interactive)}
  </svg>
{/snippet}

{#snippet emptyRow(headNote: string | null, label: string, row: string)}
  <div class="attention-row" data-row={row}>
    <div class="attention-row-head"><span>{label}</span>{#if headNote}<span>{headNote}</span>{:else}<span class="ghost ghost-line is-short"></span>{/if}</div>
    <svg class="attention-svg" width={layout.width} height={ROW_HEIGHT} viewBox="0 0 {layout.width} {ROW_HEIGHT}">
      <line class="attention-axis" x1="0" x2={layout.width} y1={BASELINE} y2={BASELINE} />
      {#if !headNote}
        {#each GHOST_BARS as h, i}
          <line class="attention-tick" x1={ghostX(i)} x2={ghostX(i)} y1={BASELINE - 5} y2={BASELINE + 5} />
          <rect class="ghost" x={ghostX(i) - 6} y={BASELINE - h} width="12" height={h} rx="3" />
        {/each}
      {/if}
    </svg>
  </div>
{/snippet}

<section class="figure attention" id="attention" class:is-loading={dim} aria-labelledby="attentionTitle">
  <header class="figure-head">
    <div class="figure-title"><span class="eyebrow">Gráfico 7</span><h2 id="attentionTitle">Atenção e menções</h2></div>
    <p class="figure-sub">Quanto se buscou o nome na Wikipédia contra quanto se escreveu sobre a pessoa, dia a dia. <a href="/como-ler#atencao">Como ler</a>.</p>
    <dl class="figure-key">
      <div><dt>Posição</dt><dd>o dia, o mesmo eixo nas duas linhas</dd></div>
      <div><dt>Tamanho</dt><dd>altura da barra, numa escala só de cada linha</dd></div>
      <div><dt>Clique</dt><dd>documentos do dia, em qualquer das duas linhas</dd></div>
    </dl>
    <div class="sentence">
      <p class="sentence-line">Curiosidade e menções sobre <span class="pick"><select id="attentionPerson" aria-label="Pessoa (atenção)" bind:value={person} onchange={onPerson}>{#each bootData.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span> nos últimos 30 dias, em <span class="keep"><span class="pick"><select id="attentionSource" aria-label="Fonte (atenção)" bind:value={source} onchange={onSource}>{#each SOURCE_SEGMENTS as [value, text] (value)}<option {value}>{sourceLabels[value] ?? text}</option>{/each}</select></span>.</span></p>
    </div>
  </header>
  <p class="note" id="attentionNote">{note}</p>
  <figure class="attention-chart" id="attentionChart" aria-label="Pageviews da Wikipédia e menções por dia" aria-busy={busy ? 'true' : 'false'} hidden={unavailable} bind:this={chart}>
    {#if fullGhost}
      <div class="ghost-field" aria-hidden="true">
        {@render emptyRow(null, 'Menções', 'mentions')}
        {@render emptyRow(null, VIEWS_LABEL, 'views')}
      </div>
      <p class="sr-only">Lendo a atenção.</p>
    {:else if !unavailable}
      {#if mentionsErrored}
        {@render emptyRow('Não foi possível carregar as menções.', 'Menções', 'mentions')}
      {:else}
        <div class="attention-row" data-row="mentions">
          <div class="attention-row-head"><span>Menções</span><span>{mentionsPeak ? `pico: ${fmt(mentionsPeakValue)} documentos em ${attentionDayLabel(mentionsPeak)}` : ROW_NOTE.mentions}</span></div>
          {@render svgRow('Menções', layout.mentions, viewsByDay, true)}
        </div>
      {/if}
      {#if viewsErrored}
        {@render emptyRow('Não foi possível carregar os pageviews.', VIEWS_LABEL, 'views')}
      {:else if viewsPending}
        <div class="ghost-field" aria-hidden="true">{@render emptyRow(null, VIEWS_LABEL, 'views')}</div>
        <p class="sr-only">Lendo os pageviews.</p>
      {:else}
        <div class="attention-row" data-row="views">
          <div class="attention-row-head"><span>{VIEWS_LABEL}</span><span>{viewsPeak ? `pico: ${fmt(viewsPeakValue)} visualizações em ${attentionDayLabel(viewsPeak)}` : ROW_NOTE.views}</span></div>
          {@render svgRow(VIEWS_LABEL, layout.views, mentionsByDay, false)}
        </div>
      {/if}
    {/if}
  </figure>
</section>
