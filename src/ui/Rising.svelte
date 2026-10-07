<script lang="ts">
  import { untrack } from 'svelte'
  import Ruler from './Ruler.svelte'
  import * as api from './api.js'
  import { bootData } from './boot.svelte.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import { RARE_SHOWN, SOURCE_SEGMENTS, balanceColor, fmt, hasShares, kinds, label, liftBalance, liftOfPerson, rareRisers, risingRulerItems, shareBalance, sourceLabels, type Measure, type Rising, type RisingAbout, type RisingTerm } from './format.js'
  import { rulerLayout, rulerModel } from './layout.js'
  import { createCanvasMeasure } from './measure.js'
  import { seedFor } from './seed.js'

  let { measure }: { measure?: Measure } = $props()

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
  let source = $state('all')

  let data = $state.raw<Rising | null>(null)
  let selected = $state.raw<{ term: string; kind: string } | null>(null)
  let width = $state(0)
  let errored = $state(false)
  let waiting = $state(true)
  let dimmed = $state(false)
  let rulerEl: HTMLElement | undefined = $state()

  let metrics: Measure | null = null
  const measured = () => measure ?? (metrics ??= createCanvasMeasure())

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
    const shares = hasShares(d)
    const balance = shares ? (t: RisingTerm) => shareBalance(t, d.about) : ((lp) => (t: RisingTerm) => liftBalance(t, lp))(liftOfPerson(d.about, d.days, d.baseline))
    const items = risingRulerItems(shares ? d.present : d.terms, balance)
    const rareAll = shares ? risingRulerItems(rareRisers(d.terms, d.present), balance) : []
    if (!items.length && !rareAll.length) return { empty: true as const }
    const laid = rulerModel(rulerLayout(measured(), items, width || 860))
    return {
      empty: false as const,
      rare: rareAll.slice(0, RARE_SHOWN),
      rareTotal: rareAll.length,
      layout: {
        ...laid,
        endA: 'antes (14 dias)',
        endB: 'agora (7 dias)',
        axisLabels: (shares ? ['Fatia menor que antes', 'mesma fatia', 'Fatia maior que antes'] : ['Mais devagar que a pessoa', 'no mesmo ritmo', 'Mais rápido que a pessoa']) as [string, string, string],
        ariaLabel: 'Régua de termos em alta',
        note: '',
      },
    }
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
    <p class="figure-sub">As palavras mais presentes na semana, e se cada uma ocupa fatia maior ou menor do que se escreve sobre a pessoa. <a href="/como-ler#em-alta">Como ler</a>.</p>
    <dl class="figure-key">
      <div><dt>Posição</dt><dd>fatia da palavra em tudo o que se escreve sobre a pessoa, agora contra antes; no meio, a mesma fatia</dd></div>
      <div><dt>Tamanho</dt><dd>textos nos 21 dias</dd></div>
      <div><dt><span class="key-pair" aria-hidden="true"></span>Cor</dt><dd>para que lado pende</dd></div>
      <div><dt>Clique</dt><dd>textos da semana</dd></div>
      <div><dt>Lista</dt><dd>fora da régua, as que subiram de fato, da maior subida para a menor</dd></div>
    </dl>
    <div class="sentence"><p class="sentence-line">O que se escreve sobre <span class="pick"><select id="risingPerson" aria-label="Pessoa (em alta)" value={person} onchange={(e) => change(e, (v) => (person = v))}>{#each bootData.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span> nos últimos 7 dias, contra os 14 dias antes, em <span class="keep"><span class="pick"><select id="risingSource" aria-label="Fonte (em alta)" value={source} onchange={(e) => change(e, (v) => (source = v))}>{#each SOURCE_SEGMENTS as [value, text] (value)}<option {value}>{sourceLabels[value] ?? text}</option>{/each}</select></span>.</span></p></div>
  </header>
  <figure class="ruler" id="risingRuler" aria-label="Régua de termos em alta" aria-busy={showGhost ? 'true' : 'false'} hidden={peopleError || noPeople} bind:this={rulerEl}>
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
      <p class="sr-only">Lendo os termos em alta.</p>
    {:else if errored}
      <p class="note">Não foi possível carregar os termos em alta.</p>
    {:else if model?.empty}
      <p class="note">Nenhuma palavra neste recorte.</p>
    {:else if model}
      <Ruler {...model.layout} {selected} onpick={pick}>
        {#snippet tail()}
          {#if model.rare.length}
            <div class="ruler-overflow ruler-rare">
              <p>Fora da régua, {rareCount(model)} com poucos textos na semana, mas mais que antes, da maior subida para a menor:</p>
              {#each model.rare as d (d.kind + ':' + d.term)}
                {@const isSelected = !!selected && selected.term === d.term && selected.kind === d.kind}
                <button class="quiet-button" class:is-selected={isSelected} data-term={d.term} data-kind={d.kind} aria-pressed={isSelected} style:--cmp={balanceColor(d.balance)} onclick={() => pick(d.term, d.kind)}>{label(d)}</button>
              {/each}
            </div>
          {/if}
        {/snippet}
      </Ruler>
    {/if}
  </figure>
  <p class="note" id="risingAbout">{aboutText}</p>
</section>
