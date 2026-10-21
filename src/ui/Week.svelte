<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import * as api from './api.js'
  import { bootData } from './boot.svelte.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import { fmt, kinds, label, SOURCE_SEGMENTS, sourceLabels, weekDayIso, weekDayLabel, type Week } from './format.js'
  import { heatLevel, weekRows } from './layout.js'
  import { seedFor } from './seed.js'

  type Picked = { day: string; term: string; kind: string }

  const LIMITS = ['5', '8', '12']
  const GHOST_WIDTHS = ['', 'is-mid', 'is-short']

  let mounted = $state(false)
  let chartEl: HTMLElement | undefined = $state()
  let person = $state('')
  let source = $state(SOURCE_SEGMENTS[0][0])
  let limit = $state('8')
  let selected = $state.raw<Picked | null>(null)
  let started = false
  let lastData: Week | undefined

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

  const count = (n: number) => `${fmt(n)} ${n === 1 ? 'documento' : 'documentos'}`

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

  // The limit each payload was asked with, kept beside the payload so a memo hit carries it too.
  const limitOf = new WeakMap<Week, string>()

  const figure = createFigure<Week>({
    name: 'week',
    params,
    fetch: async (qp, signal) => {
      const result = await api.loadWeek(qp.get('person')!, api.weekParams({ source: qp.get('source')!, limit: qp.get('limit')! }), signal)
      limitOf.set(result, qp.get('limit')!)
      return result
    },
    ghost: () => {},
    paint: (result) => {
      if (result !== lastData) dropStalePick()
      lastData = result
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

  // The select may already say another limit while the data on screen is still the old one.
  const shownLimit = $derived((figure.data && limitOf.get(figure.data)) ?? limit)

  const table = $derived.by(() => {
    const data = figure.data
    if (!data) return null
    const { rows, top } = weekRows(data.buckets)
    const days = data.buckets.map((bucket) => ({ bucket, day: weekDayIso(bucket.start), label: weekDayLabel(bucket.start), short: bucket.terms.length < Number(shownLimit) }))
    return { rows, top, days }
  })

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
</script>

<section class="figure week" class:is-loading={dimmed} id="week" aria-labelledby="weekTitle">
  <header class="figure-head">
    <div class="figure-title"><span class="eyebrow">Gráfico 5</span><h2 id="weekTitle">A semana</h2></div>
    <p class="figure-sub">Quais palavras ocuparam cada dia dos últimos sete. <a href="/como-ler#semana">Como ler</a>.</p>
    <dl class="figure-key">
      <div><dt>Palavra</dt><dd>uma linha por palavra; a ordem é o total da semana</dd></div>
      <div><dt><span class="ink-scale" aria-hidden="true"></span>Célula</dt><dd>a tinta é o número de textos no dia</dd></div>
      <div><dt><span class="week-gap-swatch" aria-hidden="true"></span>Vazia</dt><dd>fora das {shownLimit} mais citadas do dia; não é zero</dd></div>
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
  <figure class="week-chart" id="weekChart" aria-label="Palavras da semana, uma linha por palavra e uma coluna por dia" aria-busy={ghost} hidden={!shown} bind:this={chartEl}>
    {#if ghost}
      <div class="week-ghost ghost-field" aria-hidden="true">
        {#each [0, 1, 2, 3, 4, 5] as i (i)}
          <div class="week-ghost-row">
            <span class="ghost ghost-outlet-d {GHOST_WIDTHS[i % 3]}"></span>
            {#each Array(7) as _, j (j)}<span class="week-cell ghost"></span>{/each}
          </div>
        {/each}
      </div>
      <p class="sr-only">Lendo a semana.</p>
    {:else if table && !emptyWeek}
      <div class="week-scroll">
        <table class="week-table">
          <caption class="sr-only">Palavras por dia da semana</caption>
          <thead>
            <tr>
              <th scope="col"></th>
              {#each table.days as { bucket, day, label: dayLabel } (bucket.start)}
                <th scope="col" class="week-day-head" data-day={day}><dl class="stat"><div><dt>{dayLabel}</dt><dd>{fmt(bucket.about)}</dd></div></dl></th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each table.rows as row (row.kind + '\u0000' + row.term)}
              {@const text = label(row)}
              <tr>
                <th scope="row" class="week-term" title="{text} · {kinds[row.kind] || row.kind || 'Tipo desconhecido'} · {count(row.total)} na semana">{text}</th>
                {#each row.cells as cell, i (table.days[i].day)}
                  {@const d = table.days[i]}
                  <td class="week-c">
                    {#if cell === null}
                      {@const gap = `${text}, ${d.label}: ${d.short ? 'não apareceu neste dia' : `fora das ${shownLimit} mais citadas do dia`}`}
                      <span class="week-cell is-gap" data-gap="1" data-day={d.day} role="img" aria-label={gap} title={gap}></span>
                    {:else}
                      {@const on = isSelected(d.day, row)}
                      <button
                        type="button"
                        class="week-cell"
                        class:is-selected={on}
                        data-lv={heatLevel(cell, table.top)}
                        data-term={row.term}
                        data-kind={row.kind}
                        data-day={d.day}
                        aria-pressed={on}
                        aria-label="{text}, {d.label}: {count(cell)}"
                        onclick={() => pick(d.day, row.term, row.kind)}>{fmt(cell)}</button>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </figure>
  <p class="note" id="weekNote">{note}</p>
</section>
