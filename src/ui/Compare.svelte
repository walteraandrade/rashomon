<script lang="ts" module>
  // What a payload was asked for, so a click, its bridges and its chart label never read the
  // controls as they stand after the payload left the network (a memo hit returns the same object).
  type Asked = { person: string; days: string; source: string; limit: string }
  const asked = new WeakMap<object, Asked>()
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import Butterfly from './Butterfly.svelte'
  import Combobox from './Combobox.svelte'
  import * as api from './api.js'
  import { bootData } from './boot.svelte.js'
  import { butterflyRows } from './butterfly-model.js'
  import { compareModeFor, thinNoteText, type CompareMode } from './compare-model.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import { SOURCE_SEGMENTS, applyBridges, bridgeIds, fmt, hasBridges, isBridge, kinds, label, lensLabel, scoreName, sourceLabels, type Compare, type CompareSide, type CompareTerm, type Lenses, type OutletRow } from './format.js'
  import { seedFor, type SeedKey } from './seed.js'

  type Payload = Compare | Lenses

  const KEYS: SeedKey[] = [['a', 'person'], ['b', null], 'days', 'source', 'limit', ['measure', null], ['mode', null]]
  // The legacy figure id stays only as the seed prefix of the old `lenses.*` links.
  const LENS_KEYS: SeedKey[] = ['person', ['a', null], ['b', null], 'days', 'limit']
  const DAYS = ['7', '21']
  const MEASURES = ['count', 'pmi']
  const LIMITS = ['20', '40', '60', '100']
  const DEFAULT_LENS_A = 'source:bluesky'
  const DEFAULT_LENS_B = 'source:gnews'
  const GHOST_BARS: [number, number][] = [[62, 38], [48, 20], [30, 54], [74, 12], [22, 66], [56, 44], [36, 28], [18, 50]]

  let mode = $state<CompareMode>('pessoas')
  let a = $state('')
  let b = $state('')
  let lensPerson = $state('')
  let days = $state('21')
  let source = $state('all')
  let measure = $state('count')
  let limit = $state('20')

  let data = $state.raw<Payload | null>(null)
  let selected = $state.raw<{ term: string; kind: string } | null>(null)
  let shownLimit = $state(20)
  let shownPerson = $state('')
  let version = $state(0)
  let errored = $state(false)
  let waiting = $state(true)
  let dimmed = $state(false)
  let rulerEl: HTMLElement | undefined = $state()
  let selA: HTMLSelectElement | undefined = $state()
  let selB: HTMLSelectElement | undefined = $state()
  let comboA: { sync: () => void } | undefined = $state()
  let comboB: { sync: () => void } | undefined = $state()

  const isLens = (d: Payload): d is Lenses => 'lens' in d.a

  const peopleError = $derived(bootData.ready && !!bootData.peopleError)
  const noPeople = $derived(bootData.ready && !bootData.peopleError && bootData.people.length === 0)
  const showGhost = $derived(!bootData.ready || (!peopleError && !noPeople && waiting && !errored))
  const sameSides = $derived.by(() => {
    if (showGhost || errored || peopleError || noPeople) return false
    if (mode === 'pessoas') return !!a && a === b
    return !!data && isLens(data) && data.a.lens === data.b.lens
  })

  const view = $derived.by(() => {
    void version
    if (!data) return null
    const shown = data
    const lens = isLens(shown)
    const sides = isLens(shown)
      ? [{ label: lensLabel(shown.a.lens), about: shown.a.about }, { label: lensLabel(shown.b.lens), about: shown.b.about }]
      : [{ label: shown.a.person.name, about: shown.a.about }, { label: shown.b.person.name, about: shown.b.about }]
    return { lens, sides, model: butterflyRows(shown.terms, sides[0].about, sides[1].about, shownLimit, lens ? 'pmi' : measure) }
  })

  const hiddenCount = $derived(view?.model.hiddenCount ?? 0)
  const hiddenText = $derived.by(() => {
    if (!hiddenCount) return ''
    const owner = view?.lens ? 'da pessoa' : 'de uma das duas pessoas'
    return `${hiddenCount} ${hiddenCount === 1 ? 'palavra deixada' : 'palavras deixadas'} de fora por ser o próprio nome ${owner}.`
  })
  const thinText = $derived(!showGhost && !errored && view?.lens ? thinNoteText(view.sides) : '')

  const personName = (id: string) => bootData.people.find((p) => p.id === id)?.name ?? id
  const chartLabel = $derived(view?.lens ? `Barras comparando ${view.sides[0].label} e ${view.sides[1].label} para ${personName(shownPerson)}` : `Barras comparando ${view?.sides[0].label ?? ''} e ${view?.sides[1].label ?? ''}`)
  const emptyHint = $derived(mode === 'recortes' ? 'Clique numa palavra para ver os números das duas lentes.' : 'Clique numa palavra para ver os números dos dois lados.')

  const term = $derived.by((): CompareTerm | null => {
    void version
    const current = selected
    if (!current || !data) return null
    return data.terms.find((t) => t.term === current.term && t.kind === current.kind) ?? null
  })

  const resolvePerson = (seeded: string | undefined) => (seeded && bootData.people.some((p) => p.id === seeded) ? seeded : (bootData.people[0]?.id ?? ''))
  const resolveOther = (seeded: string | undefined, first: string) => {
    if (seeded && bootData.people.some((p) => p.id === seeded)) return seeded
    return bootData.people.find((p) => p.id !== first)?.id ?? first
  }
  const seeded = (value: string | undefined, allowed: string[], fallback: string) => (value !== undefined && allowed.includes(value) ? value : fallback)
  const hasOption = (select: HTMLSelectElement, value: string) => [...select.options].some((o) => o.value === value)
  const applySeed = (select: HTMLSelectElement | undefined, value: string | undefined) => {
    if (value === undefined || !select) return
    if (hasOption(select, value)) select.value = value
  }
  const isDomainSeed = (v: string | undefined): v is string => typeof v === 'string' && v.startsWith('domain:')
  const lensA = () => selA?.value ?? DEFAULT_LENS_A
  const lensB = () => selB?.value ?? DEFAULT_LENS_B
  const syncCombos = () => {
    comboA?.sync()
    comboB?.sync()
  }

  const lensDocsQuery = (lens: string, window: string, word: string, kind: string) => {
    if (lens.startsWith('domain:')) return api.docsParams({ days: window, source: 'all', domain: lens.slice('domain:'.length), term: word, kind })
    if (lens.startsWith('lean:')) return api.docsParams({ days: window, source: 'all', lean: lens.slice('lean:'.length), term: word, kind })
    if (lens.startsWith('source:')) return api.docsParams({ days: window, source: lens.slice('source:'.length), term: word, kind })
    return api.docsParams({ days: window, source: 'all', term: word, kind })
  }

  const showDocs = (word: { term: string; kind: string }) => {
    const shown = data
    if (!shown) return
    const was = asked.get(shown)
    const window = was?.days ?? days
    const sides = isLens(shown)
      ? [shown.a.lens, shown.b.lens].map((lens) => ({ personId: shownPerson, personName: personName(shownPerson), label: lensLabel(lens), query: lensDocsQuery(lens, window, word.term, word.kind) }))
      : [shown.a.person, shown.b.person].map((person) => ({ personId: person.id, personName: person.name, label: person.name, query: api.docsParams({ days: window, source: was?.source ?? source, term: word.term, kind: word.kind }) }))
    void docsCard.open({
      owner: 'compare',
      kicker: `Documentos com ${kinds[word.kind] ? kinds[word.kind].toLowerCase() : 'o termo'}`,
      title: word.term,
      sides,
    })
  }

  const pick = (pickedTerm: string, kind: string) => {
    if (selected && selected.term === pickedTerm && selected.kind === kind) {
      figure.release()
      return
    }
    selected = { term: pickedTerm, kind }
    showDocs(selected)
  }

  const dropStalePick = () => {
    if (docsCard.openedBy('compare')) docsCard.close()
    selected = null
  }

  let switchToken = 0
  let outletsGen = 0
  let outletsKey = ''
  let touchedA = false
  let touchedB = false
  let pendingA: string | undefined
  let pendingB: string | undefined

  const fillOutlets = (rows: OutletRow[]) => {
    const prevA = lensA()
    const prevB = lensB()
    const seen = new Set<string>()
    const domains = rows.filter((r) => r.domain && !seen.has(r.domain) && seen.add(r.domain))
    for (const select of [selA, selB]) {
      const group = select?.querySelector('optgroup[label="Veículo"]')
      if (!group) continue
      group.replaceChildren(
        ...domains.map((r) => {
          const option = document.createElement('option')
          option.value = `domain:${r.domain}`
          option.textContent = r.domain ?? ''
          return option
        }),
      )
    }
    if (selA) selA.value = hasOption(selA, prevA) ? prevA : 'all'
    if (selB) selB.value = hasOption(selB, prevB) ? prevB : 'all'
    if (!touchedA) applySeed(selA, pendingA)
    if (!touchedB) applySeed(selB, pendingB)
    pendingA = pendingB = undefined
    syncCombos()
  }

  // Lens mode only; skips when this person and window are already in the optgroups.
  const ensureOutlets = async (): Promise<void> => {
    if (mode !== 'recortes' || bootData.peopleError || !bootData.people.length || !lensPerson) return
    const id = lensPerson
    const window = days
    const key = `${id}|${window}`
    if (key === outletsKey) return
    const gen = ++outletsGen
    try {
      const rows: OutletRow[] = await api.loadSources(id, api.sourcesParams({ days: window, sort: 'count', limit: '80', source: 'all' }))
      if (gen !== outletsGen || lensPerson !== id || days !== window) return
      outletsKey = key
      fillOutlets(rows)
    } catch {
      return
    }
  }

  let bridgesAbort: AbortController | null = null
  const loadBridges = (result: Payload) => {
    bridgesAbort?.abort()
    const ids = bridgeIds(result.terms)
    if (hasBridges(result.terms) || !ids.length) return
    const controller = new AbortController()
    bridgesAbort = controller
    const was = asked.get(result) ?? { person: lensPerson, days, source, limit }
    const pending = isLens(result)
      ? api.loadLensBridges(was.person, api.bridgeParams(api.lensesParams({ a: result.a.lens, b: result.b.lens, days: was.days, limit: was.limit }), ids), controller.signal)
      : api.loadCompareBridges(api.bridgeParams(api.compareParams({ a: result.a.person.id, b: result.b.person.id, days: was.days, source: was.source, limit: was.limit }), ids), controller.signal)
    pending
      .then((r: { bridges?: Record<string, number> } | undefined) => {
        if (data !== result || !r?.bridges) return
        applyBridges(result.terms, r.bridges)
        version++
      })
      .catch(() => {})
  }

  const params = (): URLSearchParams | null => {
    if (bootData.peopleError || bootData.people.length === 0) return null
    if (mode === 'recortes') {
      const qp = api.lensesParams({ a: lensA(), b: lensB(), days, limit })
      qp.set('person', lensPerson)
      qp.set('mode', 'recortes')
      return qp
    }
    const qp = api.compareParams({ a, b, days, source, limit })
    qp.set('mode', 'pessoas')
    return qp
  }

  const request = async (queryParams: URLSearchParams, signal: AbortSignal): Promise<Payload> => {
    const was = { person: queryParams.get('person') ?? '', days: queryParams.get('days')!, source: queryParams.get('source') ?? 'all', limit: queryParams.get('limit')! }
    if (queryParams.get('mode') === 'recortes') {
      const lensQuery = api.lensesParams({ a: queryParams.get('a')!, b: queryParams.get('b')!, days: was.days, limit: was.limit })
      const result: Payload = await api.loadLenses(was.person, lensQuery, signal)
      asked.set(result, was)
      return result
    }
    const plain = new URLSearchParams(queryParams)
    plain.delete('mode')
    const result: Payload = await api.loadCompare(plain, signal)
    asked.set(result, was)
    return result
  }

  const figure = createFigure<Payload>({
    name: 'compare',
    scope: () => (mode === 'recortes' ? 'lenses' : 'compare'),
    params,
    fetch: request,
    ghost: () => {
      if (data) dimmed = true
      else {
        errored = false
        waiting = true
      }
    },
    paint: (result) => {
      const isNewData = result !== data
      data = result
      if (isNewData) {
        dropStalePick()
        loadBridges(result)
      }
      const was = asked.get(result)
      shownLimit = Number(was?.limit ?? limit)
      shownPerson = was?.person ?? lensPerson
      errored = false
      waiting = false
      dimmed = false
    },
    paintError: () => {
      data = null
      dropStalePick()
      errored = true
      waiting = false
      dimmed = false
    },
    detail: (_data, queryParams) => ({ mode: queryParams.get('mode') }),
    el: () => rulerEl,
    markSelector: '[data-term]',
    onRelease: () => {
      selected = null
    },
  })

  const settleChange = () => {
    bridgesAbort?.abort()
    figure.release()
  }

  const change = (e: Event, set: (value: string) => void) => {
    set((e.currentTarget as HTMLSelectElement).value)
    settleChange()
    figure.reload()
  }

  // The token guards a refill that a mode switch overtook: only the latest interaction reloads.
  const changeAfterOutlets = async (apply: () => void) => {
    apply()
    settleChange()
    // The request in flight was asked for the old person or window; it must not land under the new one.
    figure.abort()
    if (data) dimmed = true
    const token = switchToken
    await ensureOutlets()
    if (token === switchToken) figure.reload()
  }

  const onDays = (e: Event) => {
    const value = (e.currentTarget as HTMLSelectElement).value
    if (mode === 'recortes') return changeAfterOutlets(() => (days = value))
    days = value
    outletsKey = ''
    settleChange()
    figure.reload()
  }

  const onPerson = (e: Event) => {
    const value = (e.currentTarget as HTMLSelectElement).value
    return changeAfterOutlets(() => {
      lensPerson = value
      touchedA = true
      touchedB = true
    })
  }

  const onLens = (side: 'a' | 'b') => () => {
    if (side === 'a') touchedA = true
    else touchedB = true
    settleChange()
    figure.reload()
  }

  const onMode = async (e: Event) => {
    const next = (e.currentTarget as HTMLSelectElement).value as CompareMode
    if (next === mode) return
    const token = ++switchToken
    figure.abort()
    bridgesAbort?.abort()
    outletsGen++
    figure.release()
    mode = next
    data = null
    selected = null
    errored = false
    dimmed = false
    waiting = true
    if (next === 'recortes') await ensureOutlets()
    if (token !== switchToken) return
    figure.reload()
  }

  let started = false
  $effect(() => {
    if (!bootData.ready || started) return
    started = true
    untrack(() => {
      const search = bootData.search
      mode = compareModeFor(search)
      const own = seedFor('compare', KEYS, search)
      const lens = seedFor('lenses', LENS_KEYS, search)
      a = resolvePerson(own.a)
      b = resolveOther(own.b, a)
      lensPerson = resolvePerson(lens.person)
      const [first, second] = mode === 'recortes' ? [lens, own] : [own, lens]
      days = seeded(first.days, DAYS, seeded(second.days, DAYS, days))
      limit = seeded(first.limit, LIMITS, seeded(second.limit, LIMITS, limit))
      source = seeded(own.source, SOURCE_SEGMENTS.map(([value]) => value), source)
      measure = seeded(own.measure, MEASURES, measure)
      if (selA) selA.value = DEFAULT_LENS_A
      if (selB) selB.value = DEFAULT_LENS_B
      if (!isDomainSeed(lens.a)) applySeed(selA, lens.a)
      if (!isDomainSeed(lens.b)) applySeed(selB, lens.b)
      pendingA = isDomainSeed(lens.a) ? lens.a : undefined
      pendingB = isDomainSeed(lens.b) ? lens.b : undefined
      syncCombos()
      if (mode !== 'recortes') {
        void figure.load()
        return
      }
      const token = switchToken
      void ensureOutlets().then(() => {
        if (token === switchToken) void figure.load()
      })
    })
  })

  $effect(() => () => bridgesAbort?.abort())
</script>

<section class="figure compare" id="compare" aria-labelledby="compareTitle" class:is-loading={dimmed}>
  <header class="figure-head">
    <div class="figure-title"><span class="eyebrow">Gráfico 3</span><h2 id="compareTitle">Duas pessoas ou dois recortes</h2></div>
    <p class="figure-sub">Duas pessoas lidas pelas mesmas palavras, ou uma pessoa lida por dois recortes: um veículo, um viés ou uma fonte. <a href="/como-ler#comparar">Como ler</a>.</p>
    <dl class="figure-key">
      <div><dt>Barra</dt><dd>fatia dos textos de cada lado; o número no fim da barra é a contagem</dd></div>
      <div><dt><span class="key-pair" aria-hidden="true"></span>Cor</dt><dd>de que lado: pessoa ou recorte</dd></div>
      <div><dt><span class="butterfly-bridge-mark" aria-hidden="true"></span>Ponte</dt><dd>palavra que liga os dois vocabulários</dd></div>
      <div><dt>Clique</dt><dd>textos dos dois lados, neste gráfico</dd></div>
    </dl>
    <div class="sentence"><p class="sentence-line">Comparar <span class="pick"><select id="compareMode" aria-label="Modo da comparação" value={mode} onchange={onMode}><option value="pessoas">duas pessoas</option><option value="recortes">uma pessoa, dois recortes</option></select></span>: <span hidden={mode !== 'pessoas'}><span class="pick"><select id="compareA" aria-label="Pessoa A" value={a} onchange={(e) => change(e, (v) => (a = v))}>{#each bootData.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span> com <span class="pick"><select id="compareB" aria-label="Pessoa B" value={b} onchange={(e) => change(e, (v) => (b = v))}>{#each bootData.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span></span><span hidden={mode !== 'recortes'}><span class="pick"><select id="comparePerson" aria-label="Pessoa (recortes)" value={lensPerson} onchange={onPerson}>{#each bootData.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span> sob <span class="pick"><select id="compareLensA" aria-label="Lente A" hidden bind:this={selA} onchange={onLens('a')}>{@render groups('compareLensAOutlets')}</select><Combobox bind:this={comboA} select={selA} inputId="compareLensAInput" listId="compareLensAList" label="Lente A" listLabel="Opções da lente A" /></span> e <span class="keep"><span class="pick"><select id="compareLensB" aria-label="Lente B" hidden bind:this={selB} onchange={onLens('b')}>{@render groups('compareLensBOutlets')}</select><Combobox bind:this={comboB} select={selB} inputId="compareLensBInput" listId="compareLensBList" label="Lente B" listLabel="Opções da lente B" /></span>,</span></span> nos <span class="pick"><select id="compareDays" aria-label="Período" value={days} onchange={onDays}><option value="7">últimos 7 dias</option><option value="21" selected>últimos 21 dias</option></select></span><span hidden={mode !== 'pessoas'}>, em <span class="keep"><span class="pick"><select id="compareSource" aria-label="Fonte" value={source} onchange={(e) => change(e, (v) => (source = v))}>{#each SOURCE_SEGMENTS as [value, text] (value)}<option {value}>{sourceLabels[value] ?? text}</option>{/each}</select></span>,</span> por <span class="keep"><span class="pick"><select id="compareMeasure" aria-label="Medida" value={measure} onchange={(e) => (measure = e.currentTarget.value)}><option value="count">documentos</option><option value="pmi">{scoreName('pmi')}</option></select></span>.</span></span><span hidden={mode !== 'recortes'}>.</span> Mostrar <span class="pick"><select id="compareLimit" aria-label="Quantidade de palavras" value={limit} onchange={(e) => change(e, (v) => (limit = v))}>{#each LIMITS as n (n)}<option value={n}>{n}</option>{/each}</select></span> palavras <span hidden={mode !== 'pessoas'}>por pessoa.</span><span hidden={mode !== 'recortes'}>por recorte.</span></p></div>
  </header>
  <p class="status" id="compareStatus" role="status" hidden={!sameSides}>{mode === 'recortes' ? 'Os dois lados mostram o mesmo recorte.' : 'Os dois lados mostram a mesma pessoa.'}</p>
  <figure class="butterfly" id="compareRuler" aria-label={mode === 'recortes' ? 'Barras comparando dois recortes da mesma pessoa' : 'Barras comparando as duas pessoas'} aria-busy={showGhost ? 'true' : 'false'} hidden={peopleError || noPeople} bind:this={rulerEl}>
    {#if showGhost}
      <div class="ghost-field butterfly-ghost" aria-hidden="true">
        {#each GHOST_BARS as [left, right]}
          <div class="butterfly-ghost-row"><span class="ghost butterfly-ghost-bar is-a" style:--bar={left / 100}></span><span class="butterfly-ghost-gap"></span><span class="ghost butterfly-ghost-bar is-b" style:--bar={right / 100}></span></div>
        {/each}
      </div>
      <p class="sr-only">Lendo as barras.</p>
    {:else if errored}
      <p class="note">Não foi possível carregar a comparação.</p>
    {:else if view && !view.model.groups.length}
      <p class="note">Nenhuma palavra neste recorte.</p>
    {:else if view}
      <Butterfly groups={view.model.groups} scale={view.model.scale} labelA={view.sides[0].label} labelB={view.sides[1].label} {selected} onpick={pick} ariaLabel={chartLabel} />
    {/if}
  </figure>
  <div class="detail" id="compareDetail">
    {#if peopleError}
      <span class="empty-hint">Falha de rede ou base indisponível. <button class="quiet-button" id="compareRetry" onclick={() => location.reload()}>Tentar novamente</button></span>
    {:else if noPeople}
      <span class="empty-hint">Nenhuma pessoa cadastrada.</span>
    {:else if errored && !showGhost}
      <span class="empty-hint">{emptyHint} <button class="quiet-button" id="compareErrorRetry" onclick={() => void figure.load()}>Tentar novamente</button></span>
    {:else if showGhost}
      <div class="ghost-field" aria-hidden="true">
        <span class="ghost ghost-title"></span>
        <dl class="detail-sides">
          <div><dt><span class="ghost ghost-kicker"></span></dt><dd><span class="ghost ghost-line is-short"></span></dd></div>
          <div><dt><span class="ghost ghost-kicker"></span></dt><dd><span class="ghost ghost-line is-short"></span></dd></div>
        </dl>
      </div>
    {:else if term && data && view}
      <span class="term">{label(term)}</span>
      <dl class="detail-sides">
        {@render side(view.sides[0].label, term.a)}
        {@render side(view.sides[1].label, term.b)}
      </dl>
      {#if isBridge(term)}<p class="detail-bridge">{view.lens ? 'ponte: as duas lentes precisam dela' : 'ponte: liga os dois vocabulários'}</p>{/if}
    {:else}
      <span class="empty-hint">{emptyHint}</span>
    {/if}
  </div>
  <p class="note" id="compareHiddenNote" hidden={hiddenCount === 0}>{hiddenText}</p>
  <p class="note" id="compareThinNote" hidden={!thinText}>{thinText}</p>
</section>

{#snippet groups(outletsId: string)}
  <option value="all">Tudo</option>
  <optgroup label="Veículo" id={outletsId}></optgroup>
  <optgroup label="Viés"><option value="lean:left">Esquerda</option><option value="lean:center">Centro</option><option value="lean:right">Direita</option></optgroup>
  <optgroup label="Fonte"><option value="source:bluesky">Bluesky</option><option value="source:gdelt">GDELT</option><option value="source:rss">RSS</option><option value="source:gnews">Google News</option><option value="source:gkg">GKG</option><option value="source:camara">Câmara</option><option value="source:senado">Senado</option><option value="source:juridico">Jurídico</option><option value="source:oficial">Oficial</option><option value="source:nicho">Nicho</option></optgroup>
{/snippet}

{#snippet side(name: string, s: CompareSide | 'name' | null)}
  {#if s && s !== 'name'}
    <div><dt>{name}</dt><dd><b>{fmt(s.count)}</b> documentos · PMI <b>{fmt(s.pmi)}</b></dd></div>
  {:else}
    <div><dt>{name}</dt><dd class="empty-hint">nenhum documento</dd></div>
  {/if}
{/snippet}
