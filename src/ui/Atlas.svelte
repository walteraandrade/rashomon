<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import * as api from './api.js'
  import { docsQuery, layoutKey, scopeKeys } from './atlas-model.js'
  import { bootData } from './boot.svelte.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import {
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
    type Layout,
    type MaskState,
    type Measure,
    type Sparkline,
    type Term,
  } from './format.js'
  import { centerLabel, pack, routesFrom, STRIP_PAD, termStripLayout } from './layout.js'
  import { seedFor } from './seed.js'
  import { createCanvasMeasure } from './render.js'

  const OWNER = 'atlas'
  const DAYS = ['7', '30', '60']
  const DAYS_LABELS: Record<string, string> = { '7': 'últimos 7 dias', '30': 'últimos 30 dias', '60': 'últimos 60 dias' }
  const SORTS = ['count', 'pmi', 'reach']
  const LIMITS = ['12', '18', '24']
  const SOURCES = SOURCE_SEGMENTS.map(([value]) => value)
  const MASK_CYCLE: MaskState[] = ['avaliacao', 'tema', 'off']
  const MASK_LABELS: Record<MaskState, string> = { avaliacao: 'Colorir por avaliação', tema: 'Colorir por tema', off: 'Sem cor' }
  const SPARK_BARS = 7
  const SPARK_HEIGHT = 34
  const ZOOM_STEP = 0.25
  const GHOST_WORDS: [number, number, number, number][] = [
    [-118, -92, 96, 22],
    [88, -128, 72, 18],
    [168, -28, 110, 24],
    [124, 86, 68, 18],
    [18, 156, 90, 20],
    [-96, 138, 58, 16],
    [-176, 36, 100, 22],
    [-158, -156, 52, 14],
    [36, -188, 80, 18],
    [196, 64, 60, 16],
    [-36, 48, 44, 14],
    [8, -48, 76, 20],
    [-210, -70, 64, 16],
    [150, 150, 54, 16],
  ]

  type Shown = { graph: Graph; sort: string; limit: string; days: string; source: string; person: string }
  type View = 'idle' | 'ghost' | 'data' | 'error'

  let mounted = $state(false)
  let viewportEl: HTMLElement | undefined = $state()
  let stripEl: HTMLElement | undefined = $state()
  let personEl: HTMLSelectElement | undefined = $state()
  let daysEl: HTMLSelectElement | undefined = $state()
  let sourceEl: HTMLSelectElement | undefined = $state()
  let sortEl: HTMLSelectElement | undefined = $state()
  let limitEl: HTMLSelectElement | undefined = $state()
  let person = $state('')
  let days = $state('30')
  let source = $state('all')
  let sort = $state('pmi')
  let limit = $state('18')
  let mode = $state<'map' | 'columns' | 'strip'>('map')
  let mask = $state<MaskState>('avaliacao')
  let zoom = $state(1)
  let search = $state('')
  let selected = $state<string | null>(null)
  let selectionNote = $state('')
  let spark = $state.raw<Sparkline | undefined>(undefined)
  let view = $state<View>('idle')
  let shown = $state.raw<Shown | null>(null)
  let dim = $state(false)
  let viewportWidth = $state(0)
  let stripWidth = $state(0)
  let fontsTick = $state(0)
  let started = false
  let measure: Measure | null = null
  let sparkController: AbortController | null = null
  const layoutCache = new Map<string, Layout>()

  const measured = () => (measure ??= createCanvasMeasure())
  const aborted = (e: unknown) => e instanceof Error && e.name === 'AbortError'

  // The server ranks by count and packing, the list and the inspector all follow array order,
  // so a word sized by reach has to lead them too.
  const byReach = (list: Term[], by: string) =>
    by === 'reach' ? [...list].sort((a, b) => score(b, 'reach') - score(a, 'reach') || a.term.localeCompare(b.term) || a.kind.localeCompare(b.kind)) : list

  const failed = $derived(Boolean(bootData.peopleError))
  const noPeople = $derived(bootData.ready && !failed && !bootData.people.length)
  // /api/people is fetched once by app.ts, so only a page reload can retry a people outage.
  const retry = () => (failed ? location.reload() : void figure.load())
  const unusable = $derived(failed || noPeople || view === 'error')
  const ghosting = $derived(!unusable && view !== 'data')
  const eff = $derived(view === 'data' ? mode : 'map')

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
  const searchNote = $derived(query ? `${matches} ${matches === 1 ? 'termo encontrado' : 'termos encontrados'} no recorte. A busca não muda as posições.` : '')

  const layout = $derived.by(() => {
    void fontsTick
    if (eff !== 'map' || !shown || !nodes.length) return null
    const key = layoutKey(shown.graph.person, nodes, shown.sort, shown.limit)
    if (!layoutCache.has(key)) layoutCache.set(key, pack(measured(), nodes, centerLabel(measured(), shown.graph.person.name), shown.sort))
    return layoutCache.get(key) as Layout
  })
  const edges = $derived.by(() => {
    if (!selected || !layout) return []
    const routes = routesFrom(layout, selected)
    const maxCount = Math.max(1, ...links.map((l) => l.count))
    return links
      .filter((l) => l.source === selected || l.target === selected)
      .flatMap((l) => {
        const d = routes.get(l.source === selected ? l.target : l.source)
        return d ? [{ d, w: 0.8 + (1.8 * l.count) / maxCount, key: l.source + '>' + l.target }] : []
      })
  })
  const routeNote = $derived(selected && edges.length < related.size ? `${edges.length} de ${related.size} relações no mapa; lista completa no painel.` : '')
  const noReach = $derived(viewSort === 'reach' && nodes.every((n) => score(n, 'reach') === 0))
  const mapWidth = $derived(Math.max(640, Math.min(900, viewportWidth - 24)) * zoom)

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

  // A click on empty space releases the selection; a word, a column and the person's own entry
  // point are excluded so opening her card does not close itself by bubbling into this.
  const background = (event: MouseEvent) => {
    if (!selected) return
    if ((event.target as Element | null)?.closest('[data-node], [data-col], [data-person-docs]')) return
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

  const setMode = (next: 'map' | 'columns' | 'strip') => {
    mode = next
    docsCard.close()
  }

  const setZoom = (value: number) => {
    const vp = viewportEl
    const center = vp ? (vp.scrollLeft + vp.clientWidth / 2) / Math.max(1, vp.scrollWidth) : 0.5
    zoom = Math.max(1, Math.min(2, value))
    void tick().then(() => {
      if (vp) vp.scrollLeft = center * vp.scrollWidth - vp.clientWidth / 2
    })
  }

  const toMap = () => setMode('map')
  const toColumns = () => setMode('columns')
  const toStrip = () => setMode('strip')
  const zoomIn = () => setZoom(zoom + ZOOM_STEP)
  const zoomOut = () => setZoom(zoom - ZOOM_STEP)
  const zoomReset = () => setZoom(1)
  const atMin = $derived(zoom <= 1)
  const atMax = $derived(zoom >= 2)

  const toggleMask = () => {
    mask = MASK_CYCLE[(MASK_CYCLE.indexOf(mask) + 1) % MASK_CYCLE.length]
  }

  const centre = () => {
    if (viewportEl) viewportEl.scrollLeft = Math.max(0, (viewportEl.scrollWidth - viewportEl.clientWidth) / 2)
  }

  const measureMap = () => {
    if (viewportEl && viewportEl.clientWidth !== viewportWidth) viewportWidth = viewportEl.clientWidth
  }

  // New data drops whatever the reader picked on the old recorte, whether or not the word survives.
  const dropStale = () => {
    const open = selected !== null || docsCard.isOpen()
    sparkController?.abort()
    spark = undefined
    selected = null
    search = ''
    zoom = 1
    selectionNote = ''
    layoutCache.clear()
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
    const vp = viewportEl
    const st = stripEl
    const mapObserver = new ResizeObserver(() => {
      measureMap()
      void tick().then(centre)
    })
    const stripObserver = new ResizeObserver(() => {
      if (eff !== 'strip' || !shown || !nodes.length || !st) return
      const width = st.clientWidth
      if (width && width !== stripWidth) stripWidth = width
    })
    if (vp) mapObserver.observe(vp)
    if (st) stripObserver.observe(st)
    void document.fonts?.ready?.then(() => {
      layoutCache.clear()
      fontsTick++
    })
    return () => {
      mapObserver.disconnect()
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

  // The map centres and measures once its own DOM is in place.
  $effect(() => {
    void layout
    if (eff !== 'map') return
    untrack(() => {
      measureMap()
      centre()
    })
  })

  // Strip width is read after the strip is unhidden, or a hidden element measures 0.
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

{#snippet outage()}
  <div class="empty"><img class="pet" src="/pet-caracara-perched.png" alt="" width="26" height="37">Falha de rede ou base indisponível.<br>Nenhum grafo fictício será exibido.<br><br><button class="quiet-button" id="retry" onclick={retry}>Tentar novamente</button></div>
{/snippet}

<section class="figure workspace" id="workspace" aria-labelledby="atlasTitle" class:is-loading={dim}>
  <header class="figure-head">
    <div class="figure-title"><span class="eyebrow">Gráfico 1</span><h2 id="atlasTitle">Atlas de palavras <b id="atlasStats">{stats}</b></h2></div>
    <p class="figure-sub">Palavras nos textos que citam a pessoa. A posição só evita colisão. <a href="/como-ler#atlas">Como ler</a>.</p>
    <dl class="figure-key" id="keyDefault" hidden={eff === 'strip'}>
      <div><dt><span class="type-scale" aria-hidden="true"><span>Aa</span><span>Aa</span></span>Tamanho</dt><dd>frequência, PMI ou alcance, o que a frase escolhe</dd></div>
      <div id="keyDefaultColor" hidden={mask === 'tema'}><dt><span class="mask-scale" aria-hidden="true"></span>Cor</dt><dd>avaliação contra a média desta pessoa</dd></div>
      <div><dt>Posição</dt><dd>só evita colisão</dd></div>
      <div><dt>Tracejado</dt><dd>organização citada no texto, só no GDELT</dd></div>
      <div><dt>Clique</dt><dd>textos da palavra; no centro e na lista, textos da pessoa</dd></div>
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
      <p class="sentence-line">Palavras ligadas a <span class="pick"><select id="person" aria-label="Pessoa" bind:this={personEl} onchange={onControl((v) => (person = v))}>{#each bootData.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span> nos <span class="keep"><span class="pick"><select id="days" aria-label="Período" bind:this={daysEl} onchange={onControl((v) => (days = v))}><option value="7">últimos 7 dias</option><option value="30" selected>últimos 30 dias</option><option value="60">últimos 60 dias</option></select></span>,</span> em <span class="keep"><span class="pick"><select id="source" aria-label="Fonte" bind:this={sourceEl} onchange={onControl((v) => (source = v))}>{#each SOURCE_SEGMENTS as [value, text] (value)}<option {value}>{sourceLabels[value] ?? text}</option>{/each}</select></span>,</span> por <span class="keep"><span class="pick"><select id="sort" aria-label="Tamanho por" bind:this={sortEl} onchange={onControl((v) => (sort = v))}><option value="count">frequência</option><option value="pmi" selected>PMI ponderado</option><option value="reach">alcance</option></select></span>.</span> Mostrar <span class="pick"><select id="limit" aria-label="Quantidade de palavras" bind:this={limitEl} onchange={onControl((v) => (limit = v))}><option>12</option><option selected>18</option><option>24</option></select></span> palavras.</p>
      <p class="status-row"><span class="status" id="status" role="status" class:error={failed || view === 'error'}>{status}</span></p>
    </div>
  </header>
  <div class="map-tools"><label class="search"><input id="search" type="search" placeholder="Encontrar uma palavra no recorte…" aria-label="Encontrar uma palavra no recorte" bind:value={search}></label><div class="segment" role="group" aria-label="Modo de leitura"><button id="modeMap" aria-pressed={eff === 'map'} onclick={toMap}>Mapa</button><button id="modeColumns" aria-pressed={eff === 'columns'} onclick={toColumns}>Lista</button><button id="modeStrip" aria-pressed={eff === 'strip'} onclick={toStrip}>Avaliação</button></div><button id="mask" class="quiet-button toggle" aria-pressed={mask !== 'off'} hidden={eff === 'strip'} onclick={toggleMask}>{MASK_LABELS[mask]}</button><div class="zoom" id="zoomGroup" aria-label="Zoom do mapa" hidden={eff === 'strip'}><button id="zoomOut" class="quiet-button" aria-label="Diminuir zoom" disabled={atMin} onclick={zoomOut}>−</button><button id="zoomReset" class="quiet-button" aria-label="Restaurar zoom" onclick={zoomReset}>{Math.round(zoom * 100)}%</button><button id="zoomIn" class="quiet-button" aria-label="Aumentar zoom" disabled={atMax} onclick={zoomIn}>+</button></div><button id="clear" class="quiet-button" onclick={clear}>Limpar seleção</button></div>
  <div class="figure-body">
    <div class="canvas">
      <p class="mobile-hint">Arraste o mapa para os lados para ver o círculo inteiro.</p>
      <div id="searchNote" class="search-note" role="status">{searchNote}</div>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="viewport" id="viewport" role="region" aria-label="Mapa circular interativo. Use Tab para navegar pelas palavras; em telas pequenas, role horizontalmente." tabindex="0" aria-busy={ghosting || figure.loading} hidden={!mounted || (!unusable && eff !== 'map')} style:--map-width={view === 'data' && eff === 'map' && nodes.length ? mapWidth + 'px' : null} bind:this={viewportEl} onclick={background}>
        {#if failed || view === 'error'}
          {@render outage()}
        {:else if noPeople}
          <div class="empty">A lista de pessoas está vazia.<br>Cadastre pessoas em seed.json e rode o índice.<br><br><button class="quiet-button" id="retry" onclick={() => location.reload()}>Tentar novamente</button></div>
        {:else if ghosting}
          <div class="map-stage" aria-hidden="true"><svg class="map-svg" viewBox="-430 -402 860 804"><defs><radialGradient id="halo"><stop class="halo-in" offset="0"/><stop class="halo-out" offset="1"/></radialGradient></defs><circle r="350" fill="url(#halo)"/><circle class="boundary" r="360"/><path d="M-7,-360 H7 M-7,360 H7 M-360,-7 V7 M360,-7 V7" stroke="var(--accent)" stroke-width="2" opacity=".7"/><g class="ghost-field">{#each GHOST_WORDS as [x, y, w, h]}<rect class="ghost" x={x - w / 2} y={y - h / 2} width={w} height={h} rx="6"/>{/each}<rect class="ghost" x="-72" y="-26" width="144" height="52" rx="10"/></g></svg></div>
        {:else if empty}
          <div class="empty">Nenhum termo neste recorte.<br>Experimente outra pessoa ou um período maior.</div>
        {:else if view === 'data' && layout}
          {@const c = layout.center}
          <div class="map-stage"><svg class="map-svg" class:is-masked={masked} class:is-themed={themed} viewBox="-430 -402 860 804" aria-label="Mapa de palavras associadas a {personName}"><defs><radialGradient id="halo"><stop class="halo-in" offset="0"/><stop class="halo-out" offset="1"/></radialGradient></defs><circle r="350" fill="url(#halo)"/><circle class="boundary" r="360"/><path d="M-7,-360 H7 M-7,360 H7 M-360,-7 V7 M360,-7 V7" stroke="var(--accent)" stroke-width="2" opacity=".7"/><g id="edges">{#each edges as e (e.key)}<path class="edge" d={e.d} stroke-linejoin="round" stroke-width={e.w}/>{/each}</g><g class="center-label" data-person-docs role="button" tabindex="0" aria-label="Ler os {fmt(about)} documentos sobre {personName}" onclick={showPerson} onkeydown={activate(showPerson)}><rect class="center-hit" x={-c.w / 2} y={-c.h / 2} width={c.w} height={c.h} rx="10"/><text class="micro" text-anchor="middle" y={-c.h / 2 + 23}>NO CENTRO DA CONVERSA</text><text class="person-name" style:--size="{c.size}px" text-anchor="middle" dominant-baseline="central">{#each c.lines as line, i}<tspan x="0" y={-((c.lines.length - 1) * c.lineHeight) / 2 + i * c.lineHeight}>{line}</tspan>{/each}</text><path d="M-18,{c.h / 2 - 35} H18" stroke="var(--accent)" opacity=".65"/><text class="center-note" text-anchor="middle" y={c.h / 2 - 10}>{fmt(about)} documentos</text></g><g id="words">{#each layout.placed as p (p.id)}{@const s = states.get(p.id)}{@const tone = termMask(p, personScore)}{@const theme = themeMask(p, ranking)}<g class="atlas-word" class:is-selected={s?.on} class:is-neighbor={s?.neighbor} class:is-dim={s?.dim} class:is-match={s?.match} data-kind={p.kind} transform="translate({p.x},{p.y})" style:--size="{p.size}px" style:--mask={tone} style:--theme={theme} data-node={p.id} role="button" tabindex="0" aria-pressed={!!s?.on} aria-label="{label(p)}, {fmt(p.count)} documentos; {scoreName(viewSort)}: {fmt(p.score)}" onclick={() => pick(p.id)} onkeydown={activate(() => pick(p.id))}><title>{label(p)} · {kinds[p.kind] || p.kind || 'Tipo desconhecido'} · {fmt(p.count)} documentos · {scoreName(viewSort)}: {fmt(p.score)}{p.testimony ? ` · avaliação ${signed(p.testimony.score)} em ${fmt(p.testimony.n)} textos` : ''}</title><rect class="atlas-glow" x={-p.w / 2 - 4} y={-p.h / 2 - 3} width={p.w + 8} height={p.h + 6}/><rect class="atlas-hit" x={-p.w / 2} y={-p.h / 2} width={p.w} height={p.h}/><text class="atlas-text" text-anchor="middle" dominant-baseline="central">{#each p.lines as line, i}<tspan x="0" y={(i - (p.lines.length - 1) / 2) * p.lineHeight}>{line}</tspan>{/each}</text><line class="underline" x1={-Math.min(p.w * 0.35, 40)} x2={Math.min(p.w * 0.35, 40)} y1={p.h / 2 - 2} y2={p.h / 2 - 2}/></g>{/each}</g><text class="micro" x="0" y="392" text-anchor="middle">UM RECORTE DA CONVERSA · NÃO UM JUÍZO DE VALOR</text></svg></div>
        {/if}
      </div>
      <div class="overflow" id="overflow" hidden={!layout || !layout.overflow.length}>
        {#if layout && layout.overflow.length}
          <p>{layout.overflow.length} {layout.overflow.length === 1 ? 'termo não coube' : 'termos não couberam'} sem reduzir a legibilidade. Todos continuam selecionáveis aqui:</p>
          {#each layout.overflow as n (n.id)}
            {@const s = states.get(n.id)}
            <button class="quiet-button" class:is-selected={s?.on} class:is-neighbor={s?.neighbor} class:is-dim={s?.dim} class:is-match={s?.match} data-node={n.id} aria-pressed={!!s?.on} onclick={() => pick(n.id)}>{label(n)}</button>
          {/each}
        {/if}
      </div>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div id="columns" class="columns" class:is-masked={masked} class:is-themed={themed} hidden={unusable || eff !== 'columns'} onclick={background}>
        {#if empty}
          <div class="empty">Nenhum termo neste recorte.</div>
        {:else if view === 'data' && eff === 'columns' && nodes.length}
          <div class="column-person" data-person-docs role="button" tabindex="0" aria-label="Ler os {fmt(about)} documentos sobre {personName}" onclick={showPerson} onkeydown={activate(showPerson)}><span>No centro da conversa · {fmt(about)} documentos</span><strong>{personName}</strong></div>
          {#each nodes as n, i (n.id)}
            {@const s = states.get(n.id)}
            <button class="column-card" class:is-selected={selected === n.id} class:is-dim={s?.dim} data-col={n.id} style:--mask={termMask(n, personScore)} style:--theme={themeMask(n, ranking)} onclick={() => pick(n.id)}><span>{String(i + 1).padStart(2, '0')} · {kinds[n.kind] || n.kind || 'Tipo desconhecido'} · {fmt(n.count)} docs · {scoreName(viewSort)}: {fmt(score(n, viewSort))}{n.testimony ? ` · avaliação ${signed(n.testimony.score)}` : ''}</span><strong>{label(n)}</strong></button>
          {/each}
        {/if}
      </div>
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
      <div class="legend" id="legend">{#if view === 'data' && shown}{#if empty}Sem dados para desenhar.{:else if eff === 'strip'}<span><span class="type-scale" aria-hidden="true"><span>Aa</span><span>Aa</span></span>Tamanho = quantos textos</span><span>Tab + Enter para selecionar</span>{@render maskLegend()}{:else}<span><span class="type-scale"><span>Aa</span><span>Aa</span></span>Tamanho = {scoreName(viewSort)}</span>{#if noReach}<span>Nenhum documento do Bluesky neste recorte tem alcance registrado: as palavras ficam do mesmo tamanho.</span>{/if}<span><i></i>Linha = documentos em comum; só aparece ao selecionar</span><span>Tab + Enter para selecionar · zoom e rolagem para ampliar</span><span id="routeNote">{routeNote}</span>{@render maskLegend()}<span id="themeLegend" hidden={mask !== 'tema'}>{ranking.size > 0 ? 'Cor = tema: palavras que caminharam juntas nesta construção do grafo. Os números não têm nome e não são comparáveis entre construções.' : 'Esta construção não tem temas calculados para este recorte.'}</span>{/if}{/if}</div>
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
          <p class="eyebrow">A pessoa no centro</p><h3>{personName}</h3><dl class="metric stat"><div><dt>documentos sobre a pessoa</dt><dd>{fmt(about)}</dd></div><div><dt>termos no recorte</dt><dd>{nodes.length}</dd></div></dl><p>Sem seleção, o atlas mostra um campo limpo: nenhuma ligação termo-termo fica visível.</p><p class="eyebrow">Comece por · {scoreName(viewSort)}</p><div class="related">{@render related_(nodes.slice(0, 5).map((node) => ({ node })), false)}</div>
        {:else}
          <p class="eyebrow">{kinds[chosen.kind] || chosen.kind || 'Tipo desconhecido'} em foco</p><h3 tabindex="-1" id="termHeading">{label(chosen)}</h3><dl class="metric stat"><div><dt>documentos</dt><dd>{fmt(chosen.count)}</dd></div><div><dt>PMI bruto</dt><dd>{fmt(chosen.pmi)}</dd></div></dl><p><strong class="score-highlight">{fmt(score(chosen, viewSort))}</strong> {scoreName(viewSort)} · score usado no tamanho.</p>
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
