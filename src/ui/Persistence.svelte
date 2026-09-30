<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import * as api from './api.js'
  import { bootData } from './boot.svelte.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import { fmt, kinds, seriesWeeks, shiftDate, sinceLabel, todayBrt, weekHeadLabel, weekSpanLabel, type Persistence } from './format.js'
  import { persistenceLayout } from './layout.js'
  import { seedFor } from './seed.js'

  const OWNER = 'persistence'
  const WEEKS = ['4', '12', '26']
  const LIMITS = ['20', '40', '60']
  const GHOST_WIDTHS = ['', 'is-mid', 'is-short']

  type Selection = { week: string; term: string; kind: string }

  let chart: HTMLElement | undefined = $state()
  let personId = $state('')
  let weeks = $state('12')
  let limit = $state('40')
  let selected: Selection | null = $state(null)
  let mounted = $state(false)
  let shown: Persistence | undefined

  const failure = $derived(!bootData.ready ? '' : bootData.peopleError ? 'Falha de rede ou base indisponível.' : !bootData.people.length ? 'Nenhuma pessoa cadastrada.' : '')

  const params = (): URLSearchParams | null => {
    if (failure) return null
    const qp = api.persistenceParams({ weeks, limit })
    qp.set('person', personId)
    return qp
  }

  // A pick made while the next fetch was pending belongs to data that is no longer on screen.
  const dropStalePick = () => {
    if (docsCard.openedBy(OWNER)) docsCard.close()
    selected = null
  }

  onMount(() => {
    mounted = true
  })

  const figure = createFigure<Persistence>({
    name: 'persistence',
    params,
    fetch: (qp, signal) => api.loadPersistence(qp.get('person')!, api.persistenceParams({ weeks: qp.get('weeks')!, limit: qp.get('limit')! }), signal),
    ghost: () => {},
    paint: (d) => {
      if (d !== shown) dropStalePick()
      shown = d
    },
    paintError: () => {
      shown = undefined
      dropStalePick()
    },
    detail: (_data, qp) => ({ person: qp.get('person') }),
    el: () => chart,
    markSelector: '[data-week]',
    onRelease: () => {
      selected = null
    },
  })

  $effect(() => {
    if (!bootData.ready) return
    untrack(() => {
      const seed = seedFor('persistence', ['person', ['weeks', null], 'limit'], bootData.search)
      const people = bootData.people
      personId = seed.person && people.some((p) => p.id === seed.person) ? seed.person : (people[0]?.id ?? '')
      if (seed.weeks !== undefined && WEEKS.includes(seed.weeks)) weeks = seed.weeks
      if (seed.limit !== undefined && LIMITS.includes(seed.limit)) limit = seed.limit
      void figure.load()
    })
  })

  const onControlChange = (e: Event, set: (v: string) => void) => {
    set((e.currentTarget as HTMLSelectElement).value)
    figure.release()
    figure.reload()
  }

  const showDocs = (word: Selection) => {
    const person = bootData.people.find((p) => p.id === personId)
    docsCard.open({
      owner: OWNER,
      kicker: `Documentos com ${kinds[word.kind] ? kinds[word.kind].toLowerCase() : 'o termo'} · ${weekSpanLabel(word.week)}`,
      title: word.term,
      sides: [
        {
          personId,
          personName: person?.name ?? personId,
          label: person?.name ?? personId,
          query: api.docsParams({ days: String(figure.data?.horizon ?? ''), source: 'all', term: word.term, kind: word.kind, week: word.week }),
        },
      ],
    })
  }

  const pick = (week: string, term: string, kind: string) => {
    if (selected && selected.week === week && selected.term === term && selected.kind === kind) {
      figure.release()
      return
    }
    selected = { week, term, kind }
    showDocs(selected)
  }

  const data = $derived(figure.data)
  const ghosting = $derived(!failure && (!bootData.ready || (!data && (figure.loading || !figure.error))))
  const dimmed = $derived(figure.loading && !!data)
  const showError = $derived(!failure && !ghosting && !data && !!figure.error)
  const rows = $derived(data ? persistenceLayout(data).rows : [])
  const oldestPickable = $derived(data ? shiftDate(todayBrt(), -data.horizon) : '')
  const hidden = $derived(!mounted || !!failure || (!ghosting && !(data && data.terms.length)))

  const seriesNote = $derived.by(() => {
    if (!data) return ''
    const n = seriesWeeks(data.first_week)
    if (n === null) return 'Ainda sem série: a primeira semana é gravada na próxima atualização.'
    if (n < 4) return `${n} ${n === 1 ? 'semana' : 'semanas'} de série; a leitura começa a valer com quatro.`
    return ''
  })
  const note = $derived(
    failure ||
      (ghosting ? '' : showError ? 'Não foi possível carregar a persistência.' : data ? seriesNote || (data.terms.length ? '' : 'Nenhuma palavra ficou nesta janela.') : ''),
  )
  const since = $derived(data ? sinceLabel(data.since) : 'a série começa em 9 de set. de 2026')

  const isSelected = (week: string, row: { term: string; kind: string }) => !!selected && selected.week === week && selected.term === row.term && selected.kind === row.kind
</script>

<section class="figure persistence" id="persistence" class:is-loading={dimmed} aria-labelledby="persistenceTitle">
  <header class="figure-head">
    <div class="figure-title"><span class="eyebrow">Gráfico 10</span><h2 id="persistenceTitle">Persistência</h2></div>
    <p class="figure-sub">Quais palavras grudaram na pessoa semana após semana, e quais sumiram. <a href="/como-ler#persistencia">Como ler</a>.</p>
    <dl class="figure-key">
      <div><dt>Palavra</dt><dd>uma linha por palavra, das que ficaram mais tempo às que ficaram menos</dd></div>
      <div><dt><span class="ink-scale" aria-hidden="true"></span>Célula</dt><dd>uma semana; a tinta é o número de documentos</dd></div>
      <div><dt><span class="persistence-gap-swatch" aria-hidden="true"></span>Vazia</dt><dd>fora das 50 palavras mais fortes da semana; não é zero</dd></div>
      <div><dt>Sequência</dt><dd>semanas seguidas com a palavra, até agora</dd></div>
      <div><dt>Meia-vida</dt><dd>semanas do pico até cair à metade; &ldquo;sem queda&rdquo; se ainda não caiu</dd></div>
      <div><dt>Clique</dt><dd>os textos daquela semana</dd></div>
      <div><dt>Início</dt><dd id="persistenceSince">{since}</dd></div>
    </dl>
    <div class="sentence">
      <p class="sentence-line">
        As palavras que ficaram com <span class="keep"><span class="pick"><select id="persistencePerson" aria-label="Pessoa (persistência)" value={personId} onchange={(e) => onControlChange(e, (v) => (personId = v))}>{#each bootData.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span>,</span> nas últimas
        <span class="keep"><span class="pick"><select id="persistenceWeeks" aria-label="Semanas (persistência)" value={weeks} onchange={(e) => onControlChange(e, (v) => (weeks = v))}><option value="4">4 semanas</option><option value="12">12 semanas</option><option value="26">26 semanas</option></select></span>.</span>
        Mostrar <span class="pick"><select id="persistenceLimit" aria-label="Quantidade de palavras (persistência)" value={limit} onchange={(e) => onControlChange(e, (v) => (limit = v))}><option value="20">20</option><option value="40">40</option><option value="60">60</option></select></span> palavras.
      </p>
    </div>
  </header>
  <figure class="persistence-chart" id="persistenceChart" aria-label="Palavras por semana, com sequência e meia-vida" aria-busy={ghosting} {hidden} bind:this={chart}>
    {#if ghosting}
      <div class="persistence-ghost ghost-field" aria-hidden="true">
        {#each [0, 1, 2, 3, 4, 5] as i (i)}
          <div class="persistence-ghost-row">
            <span class="ghost ghost-outlet-d {GHOST_WIDTHS[i % 3]}"></span>
            {#each Array(12) as _, j (j)}<span class="persistence-cell ghost"></span>{/each}
          </div>
        {/each}
      </div>
      <p class="sr-only">Lendo a persistência.</p>
    {:else if data && data.terms.length}
      <div class="persistence-scroll">
        <table class="persistence-table">
          <caption class="sr-only">Palavras por semana, com sequência e meia-vida</caption>
          <thead>
            <tr>
              <th scope="col"></th>
              {#each rows[0]?.cells ?? [] as c, i (c.week)}
                <th scope="col" class="persistence-week">{#if i === 0 || c.week.slice(8) <= '07'}<span>{weekHeadLabel(c.week)}</span>{/if}</th>
              {/each}
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row, i (row.kind + row.term)}
              <tr>
                <th scope="row" class="persistence-term" title={row.term}>{row.term}</th>
                {#each row.cells as cell (cell.week)}
                  <td class="persistence-c">
                    {#if cell.count === null}
                      {@const noData = !data.first_week || cell.week < data.first_week}
                      {@const text = noData ? 'sem dados' : 'fora das 50 mais fortes'}
                      <span class="persistence-cell {noData ? 'is-nodata' : 'is-gap'}" data-gap="1" title={text} role="img" aria-label={text}></span>
                    {:else if cell.week < oldestPickable}
                      <span class="persistence-cell is-expired" data-lv={cell.level} data-expired="1" title="documentos fora do período guardado" role="img" aria-label="documentos fora do período guardado">{fmt(cell.count)}</span>
                    {:else}
                      <button
                        type="button"
                        class="persistence-cell"
                        class:is-selected={isSelected(cell.week, row)}
                        data-lv={cell.level}
                        data-week={cell.week}
                        data-term={row.term}
                        data-kind={row.kind}
                        aria-pressed={isSelected(cell.week, row)}
                        aria-label="{row.term}, semana {weekSpanLabel(cell.week)}: {fmt(cell.count)} {cell.count === 1 ? 'documento' : 'documentos'}"
                        onclick={() => pick(cell.week, row.term, row.kind)}>{fmt(cell.count)}</button>
                    {/if}
                  </td>
                {/each}
                <td class="persistence-stats">
                  <dl class="stat"><div><dt>sequência</dt><dd>{fmt(data.terms[i].streak)}</dd></div></dl><dl class="stat"><div><dt>meia-vida</dt><dd>{data.terms[i].half_life === null ? 'sem queda' : fmt(data.terms[i].half_life)}</dd></div></dl>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </figure>
  <p class="note" id="persistenceNote">{note}</p>
</section>
