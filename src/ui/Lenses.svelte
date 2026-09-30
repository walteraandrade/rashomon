<script lang="ts">
  import { untrack } from 'svelte'
  import Combobox from './Combobox.svelte'
  import Ruler from './Ruler.svelte'
  import * as api from './api.js'
  import { bootData } from './boot.svelte.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import { applyBridges, bridgeIds, fmt, hasBridges, isBridge, kinds, label, lensLabel, type CompareSide, type CompareTerm, type Lenses, type Measure, type OutletRow } from './format.js'
  import { rulerLayout, rulerModel } from './layout.js'
  import { createCanvasMeasure, rulerTerms } from './render.js'
  import { seedFor, type SeedKey } from './seed.js'

  const KEYS: SeedKey[] = ['person', ['a', null], ['b', null], 'days', 'limit']
  const DAYS = ['7', '30', '60']
  const LIMITS = ['20', '40', '60', '100']
  const GHOST_WORDS: [number, number, number, number][] = [
    [110, -14, 86, 20],
    [210, 12, 64, 16],
    [320, -8, 100, 22],
    [430, 0, 72, 18],
    [530, 16, 90, 20],
    [640, -12, 58, 16],
    [740, 8, 80, 18],
  ]
  const GHOST_TICKS = [-1, -0.5, 0, 0.5, 1].map((b) => 28 + ((b + 1) / 2) * (860 - 56))

  let person = $state('')
  let days = $state('30')
  let limit = $state('40')

  let data = $state.raw<Lenses | null>(null)
  let selected = $state.raw<{ term: string; kind: string } | null>(null)
  let width = $state(0)
  let version = $state(0)
  let errored = $state(false)
  let waiting = $state(true)
  let dimmed = $state(false)
  let rulerEl: HTMLElement | undefined = $state()
  let selA: HTMLSelectElement | undefined = $state()
  let selB: HTMLSelectElement | undefined = $state()
  let comboA: { sync: () => void } | undefined = $state()
  let comboB: { sync: () => void } | undefined = $state()

  let metrics: Measure | null = null
  const measured = () => (metrics ??= createCanvasMeasure())

  const peopleError = $derived(bootData.ready && !!bootData.peopleError)
  const noPeople = $derived(bootData.ready && !bootData.peopleError && bootData.people.length === 0)
  const showGhost = $derived(!bootData.ready || (!peopleError && !noPeople && waiting && !errored))
  const sameLens = $derived(!showGhost && !errored && !peopleError && !noPeople && !!data && data.a.lens === data.b.lens)

  const model = $derived.by(() => {
    void version
    if (!data) return null
    const { items, hiddenCount } = rulerTerms(data.terms, 'pmi')
    if (!items.length) return { hiddenCount, layout: null }
    const endA = lensLabel(data.a.lens)
    const endB = lensLabel(data.b.lens)
    const laid = rulerModel(rulerLayout(measured(), items, width || 860))
    return {
      hiddenCount,
      layout: {
        ...laid,
        endA,
        endB,
        axisLabels: [`Só de ${endA}`, 'dividida', `Só de ${endB}`] as [string, string, string],
        ariaLabel: `Régua comparando ${endA} e ${endB} para a mesma pessoa`,
        note: 'Cada palavra está escrita onde ela pende, e o tamanho dela é quantos documentos tem das duas lentes somados. Toque numa palavra para ver os números das duas lentes.',
      },
    }
  })

  const hiddenCount = $derived(model?.hiddenCount ?? 0)
  const hiddenText = $derived(hiddenCount ? `${hiddenCount} ${hiddenCount === 1 ? 'palavra deixada' : 'palavras deixadas'} de fora por ser o próprio nome da pessoa.` : '')

  const term = $derived.by((): CompareTerm | null => {
    void version
    const current = selected
    if (!current || !data) return null
    return data.terms.find((t) => t.term === current.term && t.kind === current.kind) ?? null
  })

  const resolvePerson = (seeded: string | undefined) => (seeded && bootData.people.some((p) => p.id === seeded) ? seeded : (bootData.people[0]?.id ?? ''))
  const seeded = (value: string | undefined, allowed: string[], fallback: string) => (value !== undefined && allowed.includes(value) ? value : fallback)
  const hasOption = (select: HTMLSelectElement, value: string) => [...select.options].some((o) => o.value === value)
  const applySeed = (select: HTMLSelectElement | undefined, value: string | undefined) => {
    if (value === undefined || !select) return
    if (hasOption(select, value)) select.value = value
  }
  const isDomainSeed = (v: string | undefined): v is string => typeof v === 'string' && v.startsWith('domain:')
  const lensA = () => selA?.value ?? 'all'
  const lensB = () => selB?.value ?? 'all'
  const syncCombos = () => {
    comboA?.sync()
    comboB?.sync()
  }

  const lensDocsQuery = (lens: string, term: string, kind: string) => {
    if (lens.startsWith('domain:')) return api.docsParams({ days, source: 'all', domain: lens.slice('domain:'.length), term, kind })
    if (lens.startsWith('lean:')) return api.docsParams({ days, source: 'all', lean: lens.slice('lean:'.length), term, kind })
    if (lens.startsWith('source:')) return api.docsParams({ days, source: lens.slice('source:'.length), term, kind })
    return api.docsParams({ days, source: 'all', term, kind })
  }

  const showDocs = (word: { term: string; kind: string }) => {
    if (!data) return
    const id = person
    const name = bootData.people.find((p) => p.id === id)?.name ?? id
    const side = (lens: string) => ({ personId: id, personName: name, label: lensLabel(lens), query: lensDocsQuery(lens, word.term, word.kind) })
    void docsCard.open({
      owner: 'lenses',
      kicker: `Documentos com ${kinds[word.kind] ? kinds[word.kind].toLowerCase() : 'o termo'}`,
      title: word.term,
      sides: [side(data.a.lens), side(data.b.lens)],
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
    if (docsCard.openedBy('lenses')) docsCard.close()
    selected = null
  }

  let outletsGen = 0
  const loadOutlets = async (): Promise<boolean> => {
    if (bootData.peopleError || !bootData.people.length || !person) return false
    const id = person
    const window = days
    const gen = ++outletsGen
    try {
      const rows: OutletRow[] = await api.loadSources(id, api.sourcesParams({ days: window, sort: 'count', limit: '80', source: 'all' }))
      if (gen !== outletsGen || person !== id || days !== window) return false
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
      return true
    } catch {
      return false
    }
  }

  let bridgesAbort: AbortController | null = null
  const loadBridges = (result: Lenses) => {
    bridgesAbort?.abort()
    const ids = bridgeIds(result.terms)
    if (hasBridges(result.terms) || !ids.length) return
    const controller = new AbortController()
    bridgesAbort = controller
    const qp = api.lensesParams({ a: lensA(), b: lensB(), days, limit })
    api
      .loadLensBridges(person, api.bridgeParams(qp, ids), controller.signal)
      .then((r: { bridges?: Record<string, number> } | undefined) => {
        if (data !== result || !r?.bridges) return
        applyBridges(result.terms, r.bridges)
        version++
      })
      .catch(() => {})
  }

  const params = (): URLSearchParams | null => {
    if (bootData.peopleError || bootData.people.length === 0) return null
    const qp = api.lensesParams({ a: lensA(), b: lensB(), days, limit })
    qp.set('person', person)
    return qp
  }

  const figure = createFigure<Lenses>({
    name: 'lenses',
    params,
    fetch: (queryParams, signal) =>
      api.loadLenses(
        queryParams.get('person')!,
        api.lensesParams({ a: queryParams.get('a')!, b: queryParams.get('b')!, days: queryParams.get('days')!, limit: queryParams.get('limit')! }),
        signal,
      ),
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
      width = rulerEl?.clientWidth || 0
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
    detail: (_data, queryParams) => ({ person: queryParams.get('person') }),
    el: () => rulerEl,
    markSelector: '[data-term]',
    onRelease: () => {
      selected = null
    },
  })

  let touchedA = false
  let touchedB = false

  const settleChange = () => {
    bridgesAbort?.abort()
    figure.release()
  }

  const onLensA = () => {
    touchedA = true
    settleChange()
    figure.reload()
  }
  const onLensB = () => {
    touchedB = true
    settleChange()
    figure.reload()
  }
  const onLimit = (e: Event) => {
    limit = (e.currentTarget as HTMLSelectElement).value
    settleChange()
    figure.reload()
  }

  const refreshOutletsPreserving = async () => {
    const prevA = lensA()
    const prevB = lensB()
    if (!(await loadOutlets()) || !selA || !selB) return
    selA.value = hasOption(selA, prevA) ? prevA : 'all'
    selB.value = hasOption(selB, prevB) ? prevB : 'all'
    syncCombos()
  }

  const onPerson = async (e: Event) => {
    person = (e.currentTarget as HTMLSelectElement).value
    touchedA = true
    touchedB = true
    settleChange()
    await refreshOutletsPreserving()
    figure.reload()
  }
  const onDays = async (e: Event) => {
    days = (e.currentTarget as HTMLSelectElement).value
    settleChange()
    await refreshOutletsPreserving()
    figure.reload()
  }

  let started = false
  $effect(() => {
    if (!bootData.ready || started) return
    started = true
    untrack(() => {
      const initial = seedFor('lenses', KEYS, bootData.search)
      person = resolvePerson(initial.person)
      days = seeded(initial.days, DAYS, days)
      limit = seeded(initial.limit, LIMITS, limit)
      if (!isDomainSeed(initial.a)) applySeed(selA, initial.a)
      if (!isDomainSeed(initial.b)) applySeed(selB, initial.b)
      syncCombos()
      void loadOutlets().then((applied) => {
        if (applied) {
          if (isDomainSeed(initial.a) && !touchedA) applySeed(selA, initial.a)
          if (isDomainSeed(initial.b) && !touchedB) applySeed(selB, initial.b)
          syncCombos()
        }
        void figure.load()
      })
    })
  })

  $effect(() => () => bridgesAbort?.abort())
</script>

<section class="figure lenses" id="lenses" aria-labelledby="lensesTitle" class:is-loading={dimmed}>
  <header class="figure-head">
    <div class="figure-title"><span class="eyebrow">Gráfico 6</span><h2 id="lensesTitle">Uma pessoa, duas lentes</h2></div>
    <p class="figure-sub">A mesma pessoa lida por dois recortes ao mesmo tempo: um veículo, um viés ou uma fonte contra outro. <a href="/como-ler#lentes">Como ler</a>.</p>
    <dl class="figure-key">
      <div><dt>Posição</dt><dd>de qual lente a palavra é mais</dd></div>
      <div><dt>Tamanho</dt><dd>documentos das duas lentes, somados</dd></div>
      <div><dt><span class="key-pair" aria-hidden="true"></span>Cor</dt><dd>para que lente ela pende</dd></div>
      <div><dt><span class="key-bridge" aria-hidden="true"></span>Ponte</dt><dd>palavra que liga o vocabulário das duas lentes</dd></div>
      <div><dt>Clique</dt><dd>textos das duas lentes, neste gráfico</dd></div>
    </dl>
    <div class="sentence"><p class="sentence-line">Comparar <span class="pick"><select id="lensesPerson" aria-label="Pessoa (lentes)" value={person} onchange={onPerson}>{#each bootData.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span> sob <span class="pick"><select id="lensesA" aria-label="Lente A" hidden bind:this={selA} onchange={onLensA}>{@render groups('lensesAOutlets')}</select><Combobox bind:this={comboA} select={selA} inputId="lensesAInput" listId="lensesAList" label="Lente A" listLabel="Opções da lente A" /></span> e <span class="keep"><span class="pick"><select id="lensesB" aria-label="Lente B" hidden bind:this={selB} onchange={onLensB}>{@render groups('lensesBOutlets')}</select><Combobox bind:this={comboB} select={selB} inputId="lensesBInput" listId="lensesBList" label="Lente B" listLabel="Opções da lente B" /></span>,</span> nos últimos <span class="keep"><span class="pick"><select id="lensesDays" aria-label="Período (lentes)" value={days} onchange={onDays}><option value="7">7 dias</option><option value="30">30 dias</option><option value="60">60 dias</option></select></span>.</span> Mostrar <span class="pick"><select id="lensesLimit" aria-label="Quantidade de palavras (lentes)" value={limit} onchange={onLimit}>{#each LIMITS as n (n)}<option value={n}>{n}</option>{/each}</select></span> palavras.</p></div>
  </header>
  <p class="status" id="lensesStatus" role="status" hidden={!sameLens}>Os dois lados mostram o mesmo recorte.</p>
  <figure class="ruler" id="lensesRuler" aria-label="Régua comparando duas lentes da mesma pessoa" aria-busy={showGhost ? 'true' : 'false'} hidden={peopleError || noPeople} bind:this={rulerEl}>
    {#if showGhost}
      <div class="ghost-field" aria-hidden="true">
        <div class="ruler-end-row"><span class="ghost ghost-name"></span><span class="ghost ghost-name"></span></div>
        <svg class="ruler-svg" width="860" height="88" viewBox="0 0 860 88">
          <line class="ruler-axis" x1="28" x2="832" y1="44" y2="44" />
          {#each GHOST_TICKS as tick}
            <line class="ruler-tick" x1={tick} x2={tick} y1="39" y2="49" />
          {/each}
          {#each GHOST_WORDS as [x, y, w, h]}
            <rect class="ghost" x={x - w / 2} y={44 + y - h / 2} width={w} height={h} rx="5" />
          {/each}
        </svg>
      </div>
      <p class="sr-only">Lendo as lentes.</p>
    {:else if errored}
      <p class="note">Não foi possível carregar as lentes.</p>
    {:else if model && !model.layout}
      <p class="note">Nenhuma palavra neste recorte.</p>
    {:else if model?.layout}
      <Ruler {...model.layout} {selected} onpick={pick} />
    {/if}
  </figure>
  <div class="detail" id="lensesDetail">
    {#if peopleError}
      <span class="empty-hint">Falha de rede ou base indisponível. <button class="quiet-button" id="lensesRetry" onclick={() => location.reload()}>Tentar novamente</button></span>
    {:else if noPeople}
      <span class="empty-hint">Nenhuma pessoa cadastrada.</span>
    {:else if errored && !showGhost}
      <span class="empty-hint">Clique numa palavra para ver os números das duas lentes. <button class="quiet-button" id="lensesRetry" onclick={() => void figure.load()}>Tentar novamente</button></span>
    {:else if showGhost}
      <div class="ghost-field" aria-hidden="true">
        <span class="ghost ghost-title"></span>
        <dl class="detail-sides">
          <div><dt><span class="ghost ghost-kicker"></span></dt><dd><span class="ghost ghost-line is-short"></span></dd></div>
          <div><dt><span class="ghost ghost-kicker"></span></dt><dd><span class="ghost ghost-line is-short"></span></dd></div>
        </dl>
      </div>
    {:else if term && data}
      <span class="term">{label(term)}</span>
      <dl class="detail-sides">
        {@render side(lensLabel(data.a.lens), term.a as CompareSide | null)}
        {@render side(lensLabel(data.b.lens), term.b as CompareSide | null)}
      </dl>
      {#if isBridge(term)}<p class="detail-bridge">ponte: as duas lentes precisam dela</p>{/if}
    {:else}
      <span class="empty-hint">Clique numa palavra para ver os números das duas lentes.</span>
    {/if}
  </div>
  <p class="note" id="lensesHiddenNote" hidden={hiddenCount === 0}>{hiddenText}</p>
</section>

{#snippet groups(outletsId: string)}
  <option value="all">Tudo</option>
  <optgroup label="Veículo" id={outletsId}></optgroup>
  <optgroup label="Viés"><option value="lean:left">Esquerda</option><option value="lean:center">Centro</option><option value="lean:right">Direita</option></optgroup>
  <optgroup label="Fonte"><option value="source:bluesky">Bluesky</option><option value="source:gdelt">GDELT</option><option value="source:rss">RSS</option><option value="source:gnews">Google News</option><option value="source:gkg">GKG</option><option value="source:camara">Câmara</option><option value="source:senado">Senado</option><option value="source:juridico">Jurídico</option><option value="source:oficial">Oficial</option><option value="source:nicho">Nicho</option></optgroup>
{/snippet}

{#snippet side(name: string, s: CompareSide | null)}
  {#if s}
    <div><dt>{name}</dt><dd><b>{fmt(s.count)}</b> documentos · PMI <b>{fmt(s.pmi)}</b></dd></div>
  {:else}
    <div><dt>{name}</dt><dd class="empty-hint">nenhum documento</dd></div>
  {/if}
{/snippet}
