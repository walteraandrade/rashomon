<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import * as api from './api.js'
  import { docsQuery, scopeKeys } from './atlas-model.js'
  import { bootData } from './boot.svelte.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import {
    barShare,
    communityRanking,
    fmt,
    kinds,
    label,
    matching,
    MASK_MIN,
    normalize,
    relatedTo,
    scoreName,
    score,
    signed,
    SOURCE_SEGMENTS,
    sourceLabels,
    themeMask,
    termMask,
    type Graph,
    type MaskState,
    type Measure,
    type Sparkline,
    type Term,
  } from './format.js'
  import { SCATTER_DEFAULT_WIDTH, scatterLayout, STRIP_PAD, termStripLayout } from './layout.js'
  import { seedFor } from './seed.js'
  import { createCanvasMeasure } from './measure.js'

  const OWNER = 'atlas'
  const DAYS = ['7', '21']
  const WIDEST = DAYS.at(-1)
  const DAYS_LABELS: Record<string, string> = { '7': 'últimos 7 dias', '21': 'últimos 21 dias' }
  const SORTS = ['count', 'pmi', 'reach']
  const LIMITS = ['12', '18', '24']
  const SOURCES = SOURCE_SEGMENTS.map(([value]) => value)
  const MASK_CYCLE: MaskState[] = ['avaliacao', 'tema', 'off']
  const MASK_LABELS: Record<MaskState, string> = { avaliacao: 'Colorir por avaliação', tema: 'Colorir por tema', off: 'Sem cor' }
  const SPARK_BARS = 7
  const SPARK_HEIGHT = 34

  type Shown = { graph: Graph; sort: string; limit: string; days: string; source: string; person: string }
  type View = 'idle' | 'ghost' | 'data' | 'error'

  let mounted = $state(false)
  let scatterEl: HTMLElement | undefined = $state()
  let stripEl: HTMLElement | undefined = $state()
  let personEl: HTMLSelectElement | undefined = $state()
  let daysEl: HTMLSelectElement | undefined = $state()
  let sourceEl: HTMLSelectElement | undefined = $state()
  let sortEl: HTMLSelectElement | undefined = $state()
  let limitEl: HTMLSelectElement | undefined = $state()
  let person = $state('')
  let days = $state('21')
  let source = $state('all')
  let sort = $state('pmi')
  let limit = $state('18')
  let mode = $state<'columns' | 'scatter' | 'strip'>('columns')
  let mask = $state<MaskState>('avaliacao')
  let search = $state('')
  let selected = $state<string | null>(null)
  let selectionNote = $state('')
  let spark = $state.raw<Sparkline | undefined>(undefined)
  let view = $state<View>('idle')
  let shown = $state.raw<Shown | null>(null)
  let dim = $state(false)
  let scatterWidth = $state(0)
  let stripWidth = $state(0)
  let fontsTick = $state(0)
  let started = false
  let measure: Measure | null = null
  let sparkController: AbortController | null = null

  const measured = () => (measure ??= createCanvasMeasure())
  const aborted = (e: unknown) => e instanceof Error && e.name === 'AbortError'

  // sort=reach re-sorts client-side so the list and the inspector lead with reach.
  const byReach = (list: Term[], by: string) =>
    by === 'reach' ? [...list].sort((a, b) => score(b, 'reach') - score(a, 'reach') || a.term.localeCompare(b.term) || a.kind.localeCompare(b.kind)) : list

  const failed = $derived(Boolean(bootData.peopleError))
  const noPeople = $derived(bootData.ready && !failed && !bootData.people.length)
  // /api/people is fetched once by the page's onMount, so only a page reload can retry a people outage.
  const retry = () => (failed ? location.reload() : void figure.load())
  const unusable = $derived(failed || noPeople || view === 'error')
  const ghosting = $derived(!unusable && view !== 'data')
  const eff = $derived(view === 'data' ? mode : 'columns')

  const nodes = $derived(shown ? byReach(shown.graph.nodes.slice(0, Number(shown.limit)), shown.sort) : [])
  const ranking = $derived(communityRanking(nodes))
  const links = $derived.by(() => {
    if (!shown) return []
    const ids = new Set(nodes.map((n) => n.id))
    return shown.graph.links.filter((l) => ids.has(l.source) && ids.has(l.target))
  })
  const viewSort = $derived(shown?.sort ?? sort)
  const personName = $derived(shown?.graph.person.name ?? '')
  const about = $derived(shown?.graph.stats?.about)
  const personTestimony = $derived(shown?.graph.stats?.testimony)
  const personScore = $derived(personTestimony?.score ?? null)
  const masked = $derived(mask === 'avaliacao' && personScore !== null)
  const themed = $derived(mask === 'tema')
  const empty = $derived(view === 'data' && shown !== null && !nodes.length)

  const stats = $derived(shown ? `${fmt(about)} docs · ${sourceLabels[shown.source] || shown.source}` : '')

  const related = $derived(new Set(selected ? relatedTo(nodes, links, selected).map((r) => r.node.id) : []))
  const query = $derived(normalize(search))
  const states = $derived(
    new Map(
      nodes.map((n) => {
        const match = !!query && matching(n, search)
        const on = n.id === selected
        return [n.id, { on, match, neighbor: !query && !!selected && related.has(n.id), dim: query ? !match : !!selected && !on && !related.has(n.id) }]
      }),
    ),
  )
  const matches = $derived(nodes.filter((n) => matching(n, search)).length)
  const searchNote = $derived(query ? `${matches} ${matches === 1 ? 'termo encontrado' : 'termos encontrados'} no recorte.` : '')

  const noReach = $derived(viewSort === 'reach' && nodes.every((n) => score(n, 'reach') === 0))
  const maxScore = $derived(Math.max(0, ...nodes.map((n) => score(n, viewSort))))
  const byId = $derived(new Map(nodes.map((n) => [n.id, n])))

  const scatterW = $derived(scatterWidth || SCATTER_DEFAULT_WIDTH)
  const scatter = $derived.by(() => {
    void fontsTick
    return eff === 'scatter' && nodes.length ? scatterLayout(measured(), nodes, scatterW) : null
  })

  const stripW = $derived(stripWidth || 860)
  const strip = $derived(eff === 'strip' && nodes.length ? termStripLayout(nodes, personTestimony, stripW) : null)
  const stripHidden = $derived(strip ? nodes.length - strip.dots.length : 0)
  const stripNote = $derived.by(() => {
    if (!strip || !stripHidden) return ''
    const words = `${stripHidden} ${stripHidden === 1 ? 'palavra deixada' : 'palavras deixadas'} de fora`
    return personScore !== null ? `${words} por ${stripHidden === 1 ? 'ter' : 'terem'} menos de 3 textos avaliados.` : `${words}: esta pessoa não tem média de avaliação neste recorte.`
  })
  const stripMean = $derived(strip && personScore !== null ? personScore : null)

  const chosen = $derived(selected ? (nodes.find((n) => n.id === selected) ?? null) : null)
  const communityMates = $derived(
    chosen && mask === 'tema' && chosen.community !== null && chosen.community !== undefined ? nodes.filter((o) => o.id !== chosen.id && o.community === chosen.community) : [],
  )
  const chosenRelated = $derived(chosen ? relatedTo(nodes, links, chosen.id) : [])
  const reading = $derived.by(() => {
    const t = chosen?.testimony
    if (!t || personScore === null) return null
    const delta = t.score - personScore
    const text = t.n < MASK_MIN ? 'poucos textos para comparar' : delta <= -0.5 ? 'mais hostis que a média da pessoa' : delta >= 0.5 ? 'mais favoráveis que a média da pessoa' : 'na média da pessoa'
    return { t, text }
  })
  const bars = $derived.by(() => {
    if (!spark || spark.state !== 'ready') return []
    const counts = spark.counts ?? []
    const max = Math.max(1, ...counts)
    return Array.from({ length: SPARK_BARS }, (_, i) => Math.max(2, Math.round(((counts[i] ?? 0) / max) * SPARK_HEIGHT)))
  })

  const graphQuery = () => {
    const s = shown as Shown
    return api.params({ days: s.days, sort: s.sort, limit: s.limit, source: s.source })
  }

  const showDocs = (n: Term | null) => {
    if (!shown || !shown.person) return
    docsCard.open({
      kicker: n ? `Documentos com ${kinds[n.kind] ? kinds[n.kind].toLowerCase() : 'o termo'}` : 'Documentos sobre',
      title: n ? label(n) : shown.graph.person.name,
      sides: [{ personId: shown.person, personName: shown.graph.person.name, query: docsQuery(graphQuery(), n) }],
    })
  }

  // The inspector sparkline: the last 7 rolling days for the word in focus, on the atlas's own
  // source and never its days chip. A word in focus is the only caller.
  const loadSparkline = (term: Term) => {
    sparkController?.abort()
    const control = new AbortController()
    sparkController = control
    spark = { state: 'loading' }
    const s = shown as Shown
    api
      .loadTimeline(s.person, api.sparklineParams(term.term, term.kind, s.source), control.signal)
      .then((rows: { bucket_start: string; count: number }[]) => {
        if (control.signal.aborted || selected !== term.id) return
        spark = { state: 'ready', counts: rows.map((r) => r.count) }
      })
      .catch((e) => {
        if (control.signal.aborted || aborted(e) || selected !== term.id) return
        spark = { state: 'error' }
      })
  }

  const choose = (id: string | null) => {
    selected = id
    docsCard.close()
    const term = nodes.find((n) => n.id === id)
    sparkController?.abort()
    spark = undefined
    if (term) loadSparkline(term)
    selectionNote = term ? `${label(term)} selecionado. Detalhes atualizados.` : 'Seleção limpa.'
    if (term) showDocs(term)
    else docsCard.close()
  }

  // Selecting is a toggle: clicking again releases without the clear button.
  const pick = (id: string | null) => choose(id !== null && id === selected ? null : id)

  const showPerson = () => {
    if (selected !== null) choose(null)
    showDocs(null)
  }

  const canClear = () => view === 'data' && shown !== null && !figure.loading

  const clear = () => {
    if (!canClear()) return
    search = ''
    choose(null)
  }

  // A click on empty space releases the selection; a row, a point and the person's own entry
  // point are excluded so opening her card does not close itself by bubbling into this.
  const background = (event: MouseEvent) => {
    if (!selected) return
    if ((event.target as Element | null)?.closest('[data-node], [data-person-docs]')) return
    choose(null)
  }

  // Escape closes the docs card first, then clears the selection so the word stays visible.
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    if (docsCard.isOpen()) {
      docsCard.close()
      return
    }
    clear()
  }

  const activate = (fn: () => void) => (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    fn()
  }

  const setMode = (next: 'columns' | 'scatter' | 'strip') => {
    mode = next
    docsCard.close()
  }

  const toColumns = () => setMode('columns')
  const toScatter = () => setMode('scatter')
  const toStrip = () => setMode('strip')

  const toggleMask = () => {
    mask = MASK_CYCLE[(MASK_CYCLE.indexOf(mask) + 1) % MASK_CYCLE.length]
  }

  // New data drops whatever the reader picked on the old recorte, whether or not the word survives.
  const dropStale = () => {
    const open = selected !== null || docsCard.isOpen()
    sparkController?.abort()
    spark = undefined
    selected = null
    search = ''
    selectionNote = ''
    if (open) docsCard.close()
  }

  const figure = createFigure<Graph>({
    name: 'atlas',
    scope: 'graph',
    key: (p) => {
      const q = new URLSearchParams(p)
      const id = q.get('person') as string
      q.delete('person')
      return scopeKeys(id, q).graph
    },
    params: () => {
      if (failed || noPeople || !person) return null
      const p = api.params({ days, sort, limit, source })
      p.set('person', person)
      return p
    },
    fetch: (p, signal) => {
      const q = new URLSearchParams(p)
      const id = q.get('person') as string
      q.delete('person')
      return api.loadGraph(id, q, signal)
    },
    ghost: () => {
      if (shown) dim = true
      else view = 'ghost'
    },
    paint: (graph) => {
      dropStale()
      shown = { graph, sort, limit, days, source, person }
      dim = false
      view = 'data'
    },
    paintError: () => {
      dropStale()
      shown = null
      dim = false
      view = 'error'
    },
    detail: (graph, p) => ({ person: p.get('person'), nodes: graph.nodes.length }),
  })

  const status = $derived(
    failed || view === 'error'
      ? 'Não foi possível carregar dados reais.'
      : noPeople
        ? 'Nenhuma pessoa cadastrada.'
        : !bootData.ready
          ? 'Lendo as pessoas.'
          : view === 'data' && shown && !figure.loading
            ? `${fmt(about)} documentos sobre ${personName} neste recorte.`
            : 'Lendo o recorte.',
  )
  const among = (options: string[], value: string | undefined) => (value !== undefined && options.includes(value) ? value : undefined)
  const write = (el: HTMLSelectElement | undefined, value: string) => {
    if (el) el.value = value
    return value
  }

  onMount(() => {
    mounted = true
    const sc = scatterEl
    const st = stripEl
    const scatterObserver = new ResizeObserver(() => {
      if (eff !== 'scatter' || !shown || !nodes.length || !sc) return
      const width = sc.clientWidth
      if (width && width !== scatterWidth) scatterWidth = width
    })
    const stripObserver = new ResizeObserver(() => {
      if (eff !== 'strip' || !shown || !nodes.length || !st) return
      const width = st.clientWidth
      if (width && width !== stripWidth) stripWidth = width
    })
    if (sc) scatterObserver.observe(sc)
    if (st) stripObserver.observe(st)
    void document.fonts?.ready?.then(() => {
      fontsTick++
    })
    return () => {
      scatterObserver.disconnect()
      stripObserver.disconnect()
      sparkController?.abort()
    }
  })

  $effect(() => {
    if (!bootData.ready || started) return
    started = true
    untrack(() => {
      if (bootData.peopleError) return
      const people = bootData.people
      if (!people.length) return
      const seed = seedFor('atlas', ['person', 'days', 'source', 'sort', 'limit'], bootData.search)
      person = write(personEl, seed.person && people.some((p) => p.id === seed.person) ? seed.person : people[0].id)
      days = write(daysEl, among(DAYS, seed.days) ?? days)
      source = write(sourceEl, among(SOURCES, seed.source) ?? source)
      sort = write(sortEl, among(SORTS, seed.sort) ?? sort)
      limit = write(limitEl, among(LIMITS, seed.limit) ?? limit)
      void figure.load()
    })
  })

  // Scatter and strip width are read after their container is unhidden, or a hidden element measures 0.
  $effect(() => {
    if (eff !== 'scatter' || !shown) return
    untrack(() => {
      const width = scatterEl?.clientWidth ?? 0
      if (width !== scatterWidth) scatterWidth = width
    })
  })

  $effect(() => {
    if (eff !== 'strip' || !shown) return
    untrack(() => {
      const width = stripEl?.clientWidth ?? 0
      if (width !== stripWidth) stripWidth = width
    })
  })

  const onControl = (set: (value: string) => void) => (event: Event) => {
    set((event.currentTarget as HTMLSelectElement).value)
    figure.reload()
  }

  const focusHeading = () => {
    void tick().then(() => document.getElementById('termHeading')?.focus({ preventScroll: true }))
  }
</script>

<svelte:document onkeydown={onKey} />

{#snippet maskLegend()}
  {#if personTestimony && personScore !== null}
    <span id="maskLegend" hidden={mask !== 'avaliacao'}><span class="mask-scale" aria-hidden="true"></span>Cor = avaliação dos textos com a palavra contra a média da pessoa ({signed(personScore)}): vermelho mais hostil, verde mais favorável, cinza igual ou com menos de {MASK_MIN} textos avaliados</span>
  {:else}
    <span id="maskLegend" hidden={mask !== 'avaliacao'}>Sem avaliação neste recorte para colorir as palavras.</span>
  {/if}
{/snippet}

{#snippet related_(items: { node: Term; count?: number }[], counts: boolean)}
  {#each items as item (item.node.id)}
    <button data-related={item.node.id} onclick={() => { pick(item.node.id); focusHeading() }}><span>{label(item.node)}</span><b>{fmt(counts ? item.count : score(item.node, viewSort))}</b></button>
  {/each}
{/snippet}

{#snippet personEntry()}
  <div class="column-person" data-person-docs role="button" tabindex="0" aria-label="Ler os {fmt(about)} documentos sobre {personName}" onclick={showPerson} onkeydown={activate(showPerson)}><span>Textos sobre</span> <strong>{personName}</strong> <span>· {fmt(about)} documentos</span></div>
{/snippet}

{#snippet emptyNote()}
  <div class="empty">Nenhum termo neste recorte.<br>{shown?.days === WIDEST ? 'Experimente outra pessoa.' : 'Experimente outra pessoa ou um período maior.'}</div>
{/snippet}

{#snippet outage()}
  <div class="empty"><img class="pet" src="/pet-caracara-perched.png" alt="" width="26" height="37">Falha de rede ou base indisponível.<br>Nenhum grafo fictício será exibido.<br><br><button class="quiet-button" id="retry" onclick={retry}>Tentar novamente</button></div>
{/snippet}

<section class="figure workspace" id="workspace" aria-labelledby="atlasTitle" class:is-loading={dim}>
  <header class="figure-head">
    <div class="figure-title"><span class="eyebrow">Gráfico 1</span><h2 id="atlasTitle">Atlas de palavras <b id="atlasStats">{stats}</b></h2></div>
    <p class="figure-sub">Palavras nos textos que citam a pessoa, na ordem da medida da frase. <a href="/como-ler#atlas">Como ler</a>.</p>
    <dl class="figure-key" id="keyDefault" hidden={eff !== 'columns'}>
      <div><dt>Barra</dt><dd>frequência, PMI ponderado ou alcance: a medida escolhida na frase</dd></div>
      <div id="keyDefaultColor" hidden={mask === 'tema'}><dt><span class="mask-scale" aria-hidden="true"></span>Cor</dt><dd>avaliação contra a média desta pessoa</dd></div>
      <div><dt>Organização</dt><dd>tag org: organização citada no texto, só no GDELT</dd></div>
      <div><dt>Clique</dt><dd>textos da palavra; na primeira linha, textos da pessoa</dd></div>
    </dl>
    <dl class="figure-key" id="keyScatter" hidden={eff !== 'scatter'}>
      <div><dt>Posição</dt><dd>à direita, mais documentos (escala log); acima, PMI mais alto</dd></div>
      <div id="keyScatterColor" hidden={mask === 'tema'}><dt><span class="mask-scale" aria-hidden="true"></span>Cor</dt><dd>avaliação contra a média desta pessoa</dd></div>
      <div><dt>Clique</dt><dd>textos da palavra; as palavras ligadas a ela ficam realçadas</dd></div>
    </dl>
    <dl class="figure-key" id="keyTheme" hidden={eff === 'strip' || mask !== 'tema'}>
      <div><dt><span class="theme-scale" aria-hidden="true"></span>Cor</dt><dd id="keyThemeText">{shown && !ranking.size ? 'esta construção não tem temas para este recorte' : 'tema: palavras que caminharam juntas nesta construção'}</dd></div>
    </dl>
    <dl class="figure-key" id="keyStrip" hidden={eff !== 'strip'}>
      <div><dt>Posição</dt><dd>média da avaliação dos textos com a palavra</dd></div>
      <div><dt><span class="type-scale" aria-hidden="true"><span>Aa</span><span>Aa</span></span>Tamanho</dt><dd>quantos textos</dd></div>
      <div><dt><span class="mask-scale" aria-hidden="true"></span>Cor</dt><dd>distância da média da pessoa</dd></div>
      <div><dt>Clique</dt><dd>textos da palavra</dd></div>
    </dl>
    <div class="sentence">
      <p class="sentence-line">Palavras ligadas a <span class="pick"><select id="person" aria-label="Pessoa" bind:this={personEl} onchange={onControl((v) => (person = v))}>{#each bootData.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span> nos <span class="keep"><span class="pick"><select id="days" aria-label="Período" bind:this={daysEl} onchange={onControl((v) => (days = v))}><option value="7">últimos 7 dias</option><option value="21" selected>últimos 21 dias</option></select></span>,</span> em <span class="keep"><span class="pick"><select id="source" aria-label="Fonte" bind:this={sourceEl} onchange={onControl((v) => (source = v))}>{#each SOURCE_SEGMENTS as [value, text] (value)}<option {value}>{sourceLabels[value] ?? text}</option>{/each}</select></span>,</span> por <span class="keep"><span class="pick"><select id="sort" aria-label="Medida" bind:this={sortEl} onchange={onControl((v) => (sort = v))}><option value="count">frequência</option><option value="pmi" selected>PMI ponderado</option><option value="reach">alcance</option></select></span>.</span> Mostrar <span class="pick"><select id="limit" aria-label="Quantidade de palavras" bind:this={limitEl} onchange={onControl((v) => (limit = v))}><option>12</option><option selected>18</option><option>24</option></select></span> palavras.</p>
      <p class="status-row"><span class="status" id="status" role="status" class:error={failed || view === 'error'}>{status}</span></p>
    </div>
  </header>
  <div class="map-tools"><label class="search"><input id="search" type="search" placeholder="Encontrar uma palavra no recorte…" aria-label="Encontrar uma palavra no recorte" bind:value={search}></label><div class="segment" role="group" aria-label="Modo de leitura"><button id="modeColumns" aria-pressed={eff === 'columns'} onclick={toColumns}>Lista</button><button id="modeScatter" aria-pressed={eff === 'scatter'} onclick={toScatter}>Dispersão</button><button id="modeStrip" aria-pressed={eff === 'strip'} onclick={toStrip}>Avaliação</button></div><button id="mask" class="quiet-button toggle" aria-pressed={mask !== 'off'} hidden={eff === 'strip'} onclick={toggleMask}>{MASK_LABELS[mask]}</button><button id="clear" class="quiet-button" onclick={clear}>Limpar seleção</button></div>
  <div class="figure-body">
    <div class="canvas">
      <div id="searchNote" class="search-note" role="status">{searchNote}</div>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div id="columns" class="columns" class:is-masked={masked} class:is-themed={themed} class:has-dot={mask !== 'off'} aria-busy={ghosting || figure.loading} hidden={!mounted || eff !== 'columns'} onclick={background}>
        {#if failed || view === 'error'}
          {@render outage()}
        {:else if noPeople}
          <div class="empty">A lista de pessoas está vazia.<br>Cadastre pessoas em seed.json e rode o índice.<br><br><button class="quiet-button" id="retry" onclick={() => location.reload()}>Tentar novamente</button></div>
        {:else if ghosting}
          <div class="column-person is-ghost ghost-field" aria-hidden="true"><span class="ghost ghost-kicker"></span><span class="ghost ghost-title"></span></div>
          {#each { length: Number(limit) || 18 } as _row}
            <div class="list-row is-ghost ghost-field" aria-hidden="true"><span class="ghost ghost-rank"></span><span class="ghost ghost-term"></span><span class="ghost ghost-bar"></span><span class="ghost ghost-value"></span></div>
          {/each}
        {:else if empty}
          {@render emptyNote()}
        {:else if view === 'data' && eff === 'columns' && nodes.length}
          {@render personEntry()}
          {#each nodes as n, i (n.id)}
            {@const s = states.get(n.id)}
            {@const value = score(n, viewSort)}
            <button class="list-row" class:is-selected={s?.on} class:is-neighbor={s?.neighbor} class:is-dim={s?.dim} class:is-match={s?.match} data-node={n.id} aria-pressed={!!s?.on} aria-label="{label(n)}, {fmt(n.count)} documentos; {scoreName(viewSort)}: {fmt(value)}" onclick={() => pick(n.id)}>
              <span class="list-rank">{String(i + 1).padStart(2, '0')}</span>
              <span class="list-term">{label(n)}{#if n.kind === 'org'}{' '}<span class="list-tag">org</span>{/if}</span>
              <span class="list-bar" style:--w={barShare(value, maxScore)}></span>
              <span class="list-value">{fmt(value)}</span>
              {#if mask !== 'off'}<span class="list-dot" style:--mask={termMask(n, personScore)} style:--theme={themeMask(n, ranking)} aria-hidden="true"></span>{/if}
            </button>
          {/each}
        {/if}
      </div>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <figure class="scatter" id="scatter" aria-busy={figure.loading} hidden={unusable || eff !== 'scatter'} bind:this={scatterEl} onclick={background}>
        {#if empty}
          {@render emptyNote()}
        {:else if scatter && eff === 'scatter'}
          {@render personEntry()}
          <svg class="scatter-svg" class:is-masked={masked} class:is-themed={themed} width={scatter.width} height={scatter.height} viewBox="0 0 {scatter.width} {scatter.height}" role="group" aria-label="Dispersão: documentos por PMI">
            <g class="scatter-grid">
              {#each scatter.xTicks as t (t.value)}<line class="scatter-gridline" x1={t.x} x2={t.x} y1={scatter.plot.top} y2={scatter.plot.bottom}/>{/each}
              {#each scatter.yTicks as t (t.value)}<line class="scatter-gridline" x1={scatter.plot.left} x2={scatter.plot.right} y1={t.y} y2={t.y}/>{/each}
            </g>
            <line class="scatter-axis" x1={scatter.plot.left} x2={scatter.plot.right} y1={scatter.plot.bottom} y2={scatter.plot.bottom}/>
            <line class="scatter-axis" x1={scatter.plot.left} x2={scatter.plot.left} y1={scatter.plot.top} y2={scatter.plot.bottom}/>
            {#if scatter.zeroY !== null}<line class="scatter-zero" x1={scatter.plot.left} x2={scatter.plot.right} y1={scatter.zeroY} y2={scatter.zeroY}/><text class="scatter-zero-note" x={scatter.plot.right} y={scatter.zeroY - 5} text-anchor="end">0 = acaso</text>{/if}
            {#each scatter.xTicks as t (t.value)}<text class="scatter-tick" x={t.x} y={scatter.plot.bottom + 16} text-anchor="middle">{fmt(t.value)}</text>{/each}
            {#each scatter.yTicks as t (t.value)}<text class="scatter-tick" x={scatter.plot.left - 8} y={t.y} text-anchor="end" dominant-baseline="central">{fmt(t.value)}</text>{/each}
            <text class="scatter-caption" x={scatter.captions.x.x} y={scatter.captions.x.y} text-anchor="middle">{scatter.captions.x.text}</text>
            <text class="scatter-caption" x={scatter.captions.y.x}>{#each scatter.captions.y.lines as line (line.y)}<tspan x={scatter.captions.y.x} y={line.y}>{line.text}</tspan>{/each}</text>
            {#each scatter.points as p (p.id)}
              {@const n = byId.get(p.id) as Term}
              {@const s = states.get(p.id)}
              {@const text = scatter.labels.get(p.id)}
              <g class="scatter-point" class:is-selected={s?.on} class:is-neighbor={s?.neighbor} class:is-dim={s?.dim} class:is-match={s?.match} data-node={p.id} style:--mask={termMask(n, personScore)} style:--theme={themeMask(n, ranking)} role="button" tabindex="0" aria-pressed={!!s?.on} aria-label="{label(n)}, {fmt(n.count)} documentos; PMI {fmt(n.pmi)}" onclick={() => pick(p.id)} onkeydown={activate(() => pick(p.id))}>
                <title>{label(n)} · {kinds[n.kind] || n.kind || 'Tipo desconhecido'} · {fmt(n.count)} documentos · PMI {fmt(n.pmi)}{n.testimony ? ` · avaliação ${signed(n.testimony.score)} em ${fmt(n.testimony.n)} textos` : ''}</title>
                <circle class="scatter-halo" cx={p.x} cy={p.y} r={scatter.r + 5}/>
                <circle class="scatter-dot" cx={p.x} cy={p.y} r={scatter.r}/>
                {#if text}<text class="scatter-label" x={text.x} y={text.y} text-anchor={text.anchor} dominant-baseline="central">{label(n)}</text>{/if}
              </g>
            {/each}
          </svg>
        {/if}
      </figure>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <figure class="strip" id="atlasStrip" aria-label="Palavras na régua da avaliação" hidden={unusable || eff !== 'strip'} bind:this={stripEl} onclick={background}>
        {#if empty}
          <div class="empty">Nenhum termo neste recorte.</div>
        {:else if strip && eff === 'strip'}
          {#if !strip.dots.length}
            <div class="empty">Nenhuma palavra com avaliação suficiente neste recorte.</div>
          {:else}
            {#if stripMean !== null}<div class="strip-mean-row"><span class="strip-mean" style:--pos="{((strip.x(stripMean) - STRIP_PAD) / Math.max(1, stripW - 2 * STRIP_PAD)) * 100}%">média da pessoa {signed(stripMean)}</span></div>{/if}
            <svg class="strip-svg" width={stripW} height={strip.height} viewBox="0 0 {stripW} {strip.height}" role="group" aria-label="Palavras na régua da avaliação"><line class="strip-axis" x1={STRIP_PAD} x2={stripW - STRIP_PAD} y1={strip.half} y2={strip.half}/>{#each strip.ticks as t (t)}<line class="strip-tick" x1={strip.x(t)} x2={strip.x(t)} y1={strip.half - 5} y2={strip.half + 5}/>{/each}{#if stripMean !== null}<line class="strip-overall" x1={strip.x(stripMean)} x2={strip.x(stripMean)} y1="4" y2={strip.height - 4}/>{/if}{#each strip.dots as d (d.id)}{@const s = states.get(d.id)}<g class="strip-dot" class:is-selected={s?.on} class:is-neighbor={s?.neighbor} class:is-dim={s?.dim} class:is-match={s?.match} data-node={d.id} style:--tone={d.tone} role="button" tabindex="0" aria-pressed={!!s?.on} aria-label="{d.term}, avaliação {signed(d.score)} em {fmt(d.count)} {d.count === 1 ? 'texto' : 'textos'}" onclick={() => pick(d.id)} onkeydown={activate(() => pick(d.id))}><title>{d.term} · avaliação {signed(d.score)} em {fmt(d.count)} {d.count === 1 ? 'texto' : 'textos'}</title><circle class="dot-halo" cx={d.x} cy={strip.half + d.y} r={d.r + 5}/><circle class="dot-face" cx={d.x} cy={strip.half + d.y} r={d.r}/></g>{/each}</svg>
            <div class="strip-axis-labels"><span>{signed(strip.domainMin)} contra</span><span>{signed(strip.domainMax)} a favor</span></div>
          {/if}
        {/if}
      </figure>
      <p class="note" id="stripHiddenNote" hidden={!strip || stripHidden === 0 || eff !== 'strip'}>{stripNote}</p>
      <div class="legend" id="legend">{#if view === 'data' && shown}{#if empty}Sem dados para desenhar.{:else if eff === 'strip'}<span><span class="type-scale" aria-hidden="true"><span>Aa</span><span>Aa</span></span>Tamanho = quantos textos</span><span>Tab + Enter para selecionar</span>{@render maskLegend()}{:else}{#if eff === 'scatter'}<span>Eixo x = documentos, escala log · eixo y = PMI bruto · Tab + Enter para selecionar</span>{:else}<span>Barra = {scoreName(viewSort)}</span>{#if noReach}<span>Nenhum documento do Bluesky neste recorte tem alcance registrado: as barras ficam vazias.</span>{/if}{/if}{@render maskLegend()}<span id="themeLegend" hidden={mask !== 'tema'}>{ranking.size > 0 ? 'Cor = tema: palavras que caminharam juntas nesta construção do grafo. Os números não têm nome e não são comparáveis entre construções.' : 'Esta construção não tem temas calculados para este recorte.'}</span>{/if}{/if}</div>
    </div>
    <aside class="inspector" id="inspector" aria-label="Detalhes da pessoa ou da palavra">
      {#if failed || view === 'error'}
        Use tentar novamente quando a API estiver disponível.
      {:else if noPeople}
        Cadastre pessoas em seed.json e rode o índice.
      {:else if ghosting}
        <div class="ghost-field" aria-hidden="true"><p class="eyebrow"><span class="ghost ghost-kicker"></span></p><span class="ghost ghost-title"></span><dl class="metric stat"><div><dt><span class="ghost ghost-stat"></span></dt><dd><span class="ghost ghost-stat"></span></dd></div><div><dt><span class="ghost ghost-stat"></span></dt><dd><span class="ghost ghost-stat"></span></dd></div></dl><span class="ghost ghost-line"></span><span class="ghost ghost-line is-short"></span></div>
      {:else if view === 'data' && shown}
        {#if !chosen}
          <p class="eyebrow">A pessoa</p><h3>{personName}</h3><dl class="metric stat"><div><dt>documentos sobre a pessoa</dt><dd>{fmt(about)}</dd></div><div><dt>termos no recorte</dt><dd>{nodes.length}</dd></div></dl><p class="eyebrow">Comece por · {scoreName(viewSort)}</p><div class="related">{@render related_(nodes.slice(0, 5).map((node) => ({ node })), false)}</div>
        {:else}
          <p class="eyebrow">{kinds[chosen.kind] || chosen.kind || 'Tipo desconhecido'} em foco</p><h3 tabindex="-1" id="termHeading">{label(chosen)}</h3><dl class="metric stat"><div><dt>documentos</dt><dd>{fmt(chosen.count)}</dd></div><div><dt>PMI bruto</dt><dd>{fmt(chosen.pmi)}</dd></div></dl><p><strong class="score-highlight">{fmt(score(chosen, viewSort))}</strong> {scoreName(viewSort)} · medida da barra.</p>
          {#if reading && personScore !== null}<p>Textos com este termo: <strong class="score-highlight">{signed(reading.t.score)}</strong> de avaliação em {fmt(reading.t.n)} {reading.t.n === 1 ? 'texto' : 'textos'}, contra {signed(personScore)} da pessoa no recorte. {reading.text}.</p>{/if}
          {#if spark}
            {#if spark.state === 'error'}
              <div class="sparkline" aria-hidden="true"></div>
            {:else}
              <div class="sparkline" class:ghost-field={spark.state === 'loading'} role="img" aria-label="Documentos com esta palavra nos últimos 7 dias">{#if spark.state === 'loading'}{#each { length: SPARK_BARS } as _bar}<span class="ghost spark-ghost"></span>{/each}{:else}{#each bars as h}<div class="spark-bar" style:--h="{h}px"></div>{/each}{/if}</div><p class="note">Últimos 7 dias corridos, não o período escolhido acima.</p>
            {/if}
          {/if}
          <p>{personName} · {DAYS_LABELS[shown.days] ?? ''}.</p><p class="eyebrow">Aparece junto com · docs</p><div class="related">{#if chosenRelated.length}{@render related_(chosenRelated, true)}{:else}<p class="empty-note">Nenhuma relação retornada neste recorte.</p>{/if}</div>
          {#if communityMates.length}<p class="eyebrow">No mesmo tema</p><div class="related">{@render related_(communityMates.map((node) => ({ node })), false)}</div>{/if}
        {/if}
      {/if}
    </aside>
  </div>
</section>
<div id="selectionNote" class="sr-only" role="status">{selectionNote}</div>
