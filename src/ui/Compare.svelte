<script lang="ts">
  import { untrack } from 'svelte'
  import Butterfly from './Butterfly.svelte'
  import * as api from './api.js'
  import { bootData } from './boot.svelte.js'
  import { butterflyRows } from './butterfly-model.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import { SOURCE_SEGMENTS, applyBridges, bridgeIds, fmt, hasBridges, isBridge, kinds, label, scoreName, sourceLabels, type Compare, type CompareSide, type CompareTerm } from './format.js'
  import { seedFor, type SeedKey } from './seed.js'

  const KEYS: SeedKey[] = [['a', 'person'], ['b', null], 'days', 'source', 'limit', ['measure', null]]
  const DAYS = ['7', '21']
  const MEASURES = ['count', 'pmi']
  const LIMITS = ['20', '40', '60', '100']
  const GHOST_BARS: [number, number][] = [[62, 38], [48, 20], [30, 54], [74, 12], [22, 66], [56, 44], [36, 28], [18, 50]]

  let a = $state('')
  let b = $state('')
  let days = $state('21')
  let source = $state('all')
  let measure = $state('count')
  let limit = $state('20')

  let data = $state.raw<Compare | null>(null)
  let selected = $state.raw<{ term: string; kind: string } | null>(null)
  let shownLimit = $state(20)
  let version = $state(0)
  let errored = $state(false)
  let waiting = $state(true)
  let dimmed = $state(false)
  let rulerEl: HTMLElement | undefined = $state()

  const peopleError = $derived(bootData.ready && !!bootData.peopleError)
  const noPeople = $derived(bootData.ready && !bootData.peopleError && bootData.people.length === 0)
  const showGhost = $derived(!bootData.ready || (!peopleError && !noPeople && waiting && !errored))
  const sameSelf = $derived(!showGhost && !!a && a === b && !errored && !peopleError && !noPeople)

  const model = $derived.by(() => {
    void version
    return data ? butterflyRows(data.terms, data.a.about, data.b.about, shownLimit, measure) : null
  })

  const hiddenCount = $derived(model?.hiddenCount ?? 0)
  const hiddenText = $derived(hiddenCount ? `${hiddenCount} ${hiddenCount === 1 ? 'palavra deixada' : 'palavras deixadas'} de fora por ser o próprio nome de uma das duas pessoas.` : '')

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

  const showDocs = (word: { term: string; kind: string }) => {
    if (!data) return
    const values = { days, source, term: word.term, kind: word.kind }
    const side = (person: { id: string; name: string }) => ({ personId: person.id, personName: person.name, label: person.name, query: api.docsParams(values) })
    void docsCard.open({
      owner: 'compare',
      kicker: `Documentos com ${kinds[word.kind] ? kinds[word.kind].toLowerCase() : 'o termo'}`,
      title: word.term,
      sides: [side(data.a.person), side(data.b.person)],
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

  let bridgesAbort: AbortController | null = null
  const loadBridges = (result: Compare) => {
    bridgesAbort?.abort()
    const ids = bridgeIds(result.terms)
    if (hasBridges(result.terms) || !ids.length) return
    const controller = new AbortController()
    bridgesAbort = controller
    api
      .loadCompareBridges(api.bridgeParams(api.compareParams({ a, b, days, source, limit }), ids), controller.signal)
      .then((r: { bridges?: Record<string, number> } | undefined) => {
        if (data !== result || !r?.bridges) return
        applyBridges(result.terms, r.bridges)
        version++
      })
      .catch(() => {})
  }

  const params = (): URLSearchParams | null => {
    if (bootData.peopleError || bootData.people.length === 0) return null
    return api.compareParams({ a, b, days, source, limit })
  }

  const figure = createFigure<Compare>({
    name: 'compare',
    params,
    fetch: (queryParams, signal) => api.loadCompare(queryParams, signal),
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
      shownLimit = Number(limit)
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
    el: () => rulerEl,
    markSelector: '[data-term]',
    onRelease: () => {
      selected = null
    },
  })

  const change = (e: Event, set: (value: string) => void) => {
    set((e.currentTarget as HTMLSelectElement).value)
    bridgesAbort?.abort()
    figure.release()
    figure.reload()
  }
  let started = false
  $effect(() => {
    if (!bootData.ready || started) return
    started = true
    untrack(() => {
      const initial = seedFor('compare', KEYS, bootData.search)
      a = resolvePerson(initial.a)
      b = resolveOther(initial.b, a)
      days = seeded(initial.days, DAYS, days)
      source = seeded(initial.source, SOURCE_SEGMENTS.map(([value]) => value), source)
      limit = seeded(initial.limit, LIMITS, limit)
      measure = seeded(initial.measure, MEASURES, measure)
      void figure.load()
    })
  })

  $effect(() => () => bridgesAbort?.abort())
</script>

<section class="figure compare" id="compare" aria-labelledby="compareTitle" class:is-loading={dimmed}>
  <header class="figure-head">
    <div class="figure-title"><span class="eyebrow">Gráfico 3</span><h2 id="compareTitle">Duas pessoas, palavra a palavra</h2></div>
    <p class="figure-sub">Cada barra é a fatia dos textos de cada pessoa que traz a palavra. <a href="/como-ler#comparar">Como ler</a>.</p>
    <dl class="figure-key">
      <div><dt>Barra</dt><dd>fatia dos textos de cada pessoa</dd></div>
      <div><dt><span class="key-pair" aria-hidden="true"></span>Cor</dt><dd>de quem</dd></div>
      <div><dt><span class="butterfly-bridge-mark" aria-hidden="true"></span>Ponte</dt><dd>liga os dois vocabulários</dd></div>
      <div><dt>Clique</dt><dd>textos das duas pessoas, neste gráfico</dd></div>
    </dl>
    <div class="sentence"><p class="sentence-line">Comparar <span class="pick"><select id="compareA" aria-label="Pessoa A" value={a} onchange={(e) => change(e, (v) => (a = v))}>{#each bootData.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span> com <span class="pick"><select id="compareB" aria-label="Pessoa B" value={b} onchange={(e) => change(e, (v) => (b = v))}>{#each bootData.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span> nos <span class="keep"><span class="pick"><select id="compareDays" aria-label="Período" value={days} onchange={(e) => change(e, (v) => (days = v))}><option value="7">últimos 7 dias</option><option value="21" selected>últimos 21 dias</option></select></span>,</span> em <span class="keep"><span class="pick"><select id="compareSource" aria-label="Fonte" value={source} onchange={(e) => change(e, (v) => (source = v))}>{#each SOURCE_SEGMENTS as [value, text] (value)}<option {value}>{sourceLabels[value] ?? text}</option>{/each}</select></span>,</span> por <span class="keep"><span class="pick"><select id="compareMeasure" aria-label="Medida" value={measure} onchange={(e) => (measure = e.currentTarget.value)}><option value="count">documentos</option><option value="pmi">{scoreName('pmi')}</option></select></span>.</span> Mostrar <span class="pick"><select id="compareLimit" aria-label="Quantidade de palavras" value={limit} onchange={(e) => change(e, (v) => (limit = v))}>{#each LIMITS as n (n)}<option value={n}>{n}</option>{/each}</select></span> palavras por pessoa.</p></div>
  </header>
  <p class="status" id="compareStatus" role="status" hidden={!sameSelf}>Os dois lados mostram a mesma pessoa.</p>
  <figure class="butterfly" id="compareRuler" aria-label="Barras comparando as duas pessoas" aria-busy={showGhost ? 'true' : 'false'} hidden={peopleError || noPeople} bind:this={rulerEl}>
    {#if showGhost}
      <div class="ghost-field butterfly-ghost" aria-hidden="true">
        {#each GHOST_BARS as [left, right]}
          <div class="butterfly-ghost-row"><span class="ghost butterfly-ghost-bar is-a" style:--bar={left / 100}></span><span class="butterfly-ghost-gap"></span><span class="ghost butterfly-ghost-bar is-b" style:--bar={right / 100}></span></div>
        {/each}
      </div>
      <p class="sr-only">Lendo as barras.</p>
    {:else if errored}
      <p class="note">Não foi possível carregar a comparação.</p>
    {:else if model && !model.groups.length}
      <p class="note">Nenhuma palavra neste recorte.</p>
    {:else if model && data}
      <Butterfly groups={model.groups} scale={model.scale} labelA={data.a.person.name} labelB={data.b.person.name} {selected} onpick={pick} ariaLabel={`Barras comparando ${data.a.person.name} e ${data.b.person.name}`} />
    {/if}
  </figure>
  <div class="detail" id="compareDetail">
    {#if peopleError}
      <span class="empty-hint">Falha de rede ou base indisponível. <button class="quiet-button" id="compareRetry" onclick={() => location.reload()}>Tentar novamente</button></span>
    {:else if noPeople}
      <span class="empty-hint">Nenhuma pessoa cadastrada.</span>
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
        {@render side(data.a.person.name, term.a)}
        {@render side(data.b.person.name, term.b)}
      </dl>
      {#if isBridge(term)}<p class="detail-bridge">ponte: liga os dois vocabulários</p>{/if}
    {:else}
      <span class="empty-hint">Clique numa palavra para ver os números dos dois lados.</span>
    {/if}
  </div>
  <p class="note" id="compareHiddenNote" hidden={hiddenCount === 0}>{hiddenText}</p>
</section>

{#snippet side(name: string, s: CompareSide | 'name' | null)}
  {#if s && s !== 'name'}
    <div><dt>{name}</dt><dd><b>{fmt(s.count)}</b> documentos · PMI <b>{fmt(s.pmi)}</b></dd></div>
  {:else}
    <div><dt>{name}</dt><dd class="empty-hint">nenhum documento</dd></div>
  {/if}
{/snippet}
