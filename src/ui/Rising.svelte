<script lang="ts">
  import { untrack } from 'svelte'
  import Dumbbell from './Dumbbell.svelte'
  import * as api from './api.js'
  import { bootData } from './boot.svelte.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import { RARE_SHOWN, SOURCE_SEGMENTS, balanceColor, dumbbellModel, fmt, hasShares, kinds, label, rareRisers, shareBalance, sourceLabels, type Rising, type RisingAbout } from './format.js'
  import { seedFor } from './seed.js'

  const GHOST_ROWS: [number, number][] = [
    [18, 64],
    [32, 58],
    [12, 41],
    [44, 80],
    [24, 36],
    [52, 88],
    [16, 30],
    [38, 70],
  ]

  let person = $state('')
  let source = $state('all')

  let data = $state.raw<Rising | null>(null)
  let selected = $state.raw<{ term: string; kind: string } | null>(null)
  let errored = $state(false)
  let waiting = $state(true)
  let dimmed = $state(false)
  let chartEl: HTMLElement | undefined = $state()

  const peopleError = $derived(bootData.ready && !!bootData.peopleError)
  const noPeople = $derived(bootData.ready && !bootData.peopleError && bootData.people.length === 0)
  const showGhost = $derived(!bootData.ready || (!peopleError && !noPeople && waiting))

  // words_* are doc_terms rows (text-word pairs); a payload from before they existed says nothing about them.
  const aboutLine = (about: RisingAbout) => {
    const docs = `A pessoa: ${fmt(about.recent)} ${about.recent === 1 ? 'texto' : 'textos'} nos últimos 7 dias, ${fmt(about.baseline)} nos 14 dias antes`
    const pairs =
      Number.isFinite(about.words_recent) && Number.isFinite(about.words_baseline)
        ? `; ${fmt(about.words_recent!)} ${about.words_recent === 1 ? 'par texto-palavra' : 'pares texto-palavra'} agora, ${fmt(about.words_baseline!)} antes.`
        : '.'
    return docs + pairs
  }
  const aboutText = $derived(peopleError ? 'Falha de rede ou base indisponível.' : noPeople ? 'Nenhuma pessoa cadastrada.' : data && !showGhost ? aboutLine(data.about) : '')

  const model = $derived.by(() => {
    if (!data) return null
    const d = data
    const dumbbell = dumbbellModel(d)
    const rareAll = hasShares(d) ? rareRisers(d.terms, d.present).map((t) => ({ term: t.term, kind: t.kind, balance: shareBalance(t, d.about) })) : []
    if (!dumbbell.rows.length && !rareAll.length) return { empty: true as const }
    return { empty: false as const, dumbbell, rare: rareAll.slice(0, RARE_SHOWN), rareTotal: rareAll.length }
  })

  const rareCount = (m: { rare: unknown[]; rareTotal: number }) => (m.rareTotal > m.rare.length ? `${fmt(m.rare.length)} de ${fmt(m.rareTotal)} palavras` : `${fmt(m.rare.length)} ${m.rare.length === 1 ? 'palavra' : 'palavras'}`)

  const resolvePerson = (seeded: string | undefined) => (seeded && bootData.people.some((p) => p.id === seeded) ? seeded : (bootData.people[0]?.id ?? ''))

  // Always the last 7 days, never the 14-day baseline the figure also scores against.
  const showDocs = (word: { term: string; kind: string }) => {
    const found = bootData.people.find((p) => p.id === person)
    void docsCard.open({
      owner: 'rising',
      kicker: `Documentos com ${kinds[word.kind] ? kinds[word.kind].toLowerCase() : 'o termo'}`,
      title: word.term,
      sides: [{ personId: person, personName: found?.name ?? person, label: found?.name ?? person, query: api.docsParams({ days: '7', source, term: word.term, kind: word.kind }) }],
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
    if (docsCard.openedBy('rising')) docsCard.close()
    selected = null
  }

  const params = (): URLSearchParams | null => {
    if (bootData.peopleError || bootData.people.length === 0) return null
    const qp = api.risingParams({ source })
    qp.set('person', person)
    return qp
  }

  const figure = createFigure<Rising>({
    name: 'rising',
    params,
    fetch: (queryParams, signal) => api.loadRising(queryParams.get('person')!, api.risingParams({ source: queryParams.get('source')! }), signal),
    ghost: () => {
      if (data) dimmed = true
      else waiting = true
    },
    paint: (result) => {
      const isNewData = result !== data
      data = result
      if (isNewData) dropStalePick()
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
    el: () => chartEl,
    markSelector: '[data-term]',
    onRelease: () => {
      selected = null
    },
  })

  const change = (e: Event, set: (value: string) => void) => {
    set((e.currentTarget as HTMLSelectElement).value)
    figure.release()
    figure.reload()
  }

  let started = false
  $effect(() => {
    if (!bootData.ready || started) return
    started = true
    untrack(() => {
      const initial = seedFor('rising', ['person', 'source'], bootData.search)
      person = resolvePerson(initial.person)
      if (initial.source !== undefined && SOURCE_SEGMENTS.some(([value]) => value === initial.source)) source = initial.source
      void figure.load()
    })
  })
</script>

<section class="figure rising" id="rising" aria-labelledby="risingTitle" class:is-loading={dimmed}>
  <header class="figure-head">
    <div class="figure-title"><span class="eyebrow">Gráfico 4</span><h2 id="risingTitle">Em alta</h2></div>
    <p class="figure-sub">As 20 palavras mais presentes da semana, cada uma antes e agora, da que mais cresceu à que menos cresceu. <a href="/como-ler#em-alta">Como ler</a>.</p>
    <dl class="figure-key">
      <div><dt>Posição</dt><dd>antes e agora, em ocorrências a cada mil palavras escritas sobre a pessoa</dd></div>
      <div><dt><span class="key-pair" aria-hidden="true"></span>Cor</dt><dd>antes e agora</dd></div>
      <div><dt>Clique</dt><dd>textos da semana</dd></div>
      <div><dt>Lista</dt><dd>fora do gráfico, as que subiram de fato, da maior subida para a menor</dd></div>
    </dl>
    <div class="sentence"><p class="sentence-line">O que se escreve sobre <span class="pick"><select id="risingPerson" aria-label="Pessoa (em alta)" value={person} onchange={(e) => change(e, (v) => (person = v))}>{#each bootData.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span> nos últimos 7 dias, contra os 14 dias antes, em <span class="keep"><span class="pick"><select id="risingSource" aria-label="Fonte (em alta)" value={source} onchange={(e) => change(e, (v) => (source = v))}>{#each SOURCE_SEGMENTS as [value, text] (value)}<option {value}>{sourceLabels[value] ?? text}</option>{/each}</select></span>.</span></p></div>
  </header>
  <figure class="dumbbell" id="risingRuler" aria-label="Gráfico de termos em alta" aria-busy={showGhost ? 'true' : 'false'} hidden={peopleError || noPeople} bind:this={chartEl}>
    {#if showGhost}
      <div class="ghost-field" aria-hidden="true">
        {#each GHOST_ROWS as [before, now]}
          <div class="dumbbell-row">
            <span class="dumbbell-ghost-label"></span>
            <span class="dumbbell-plot">
              <span class="ghost dumbbell-dot" style:--x="{before}%"></span>
              <span class="ghost dumbbell-dot" style:--x="{now}%"></span>
            </span>
          </div>
        {/each}
      </div>
      <p class="sr-only">Lendo os termos em alta.</p>
    {:else if errored}
      <p class="note">Não foi possível carregar os termos em alta.</p>
    {:else if model?.empty}
      <p class="note">Nenhuma palavra neste recorte.</p>
    {:else if model}
      {#if model.dumbbell.rows.length}
        <Dumbbell model={model.dumbbell} {selected} onpick={pick} />
      {/if}
      {#if model.rare.length}
        <div class="dumbbell-rare">
          <p>Fora do gráfico, {rareCount(model)} com poucos textos na semana, mas mais que antes, da maior subida para a menor:</p>
          {#each model.rare as d (d.kind + ':' + d.term)}
            {@const isSelected = !!selected && selected.term === d.term && selected.kind === d.kind}
            <button class="quiet-button" class:is-selected={isSelected} data-term={d.term} data-kind={d.kind} aria-pressed={isSelected} style:--cmp={balanceColor(d.balance)} onclick={() => pick(d.term, d.kind)}>{label(d)}</button>
          {/each}
        </div>
      {/if}
    {/if}
  </figure>
  <p class="note" id="risingAbout">{aboutText}</p>
</section>
