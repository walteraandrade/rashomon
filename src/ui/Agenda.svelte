<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import * as api from './api.js'
  import { bootData } from './boot.svelte.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import { agendaRows, fmt, LEAN_LABELS, SOURCE_SEGMENTS, sourceLabels, type Agenda } from './format.js'
  import { seedFor } from './seed.js'

  const DAY_CHOICES = ['7', '30', '60']
  const WIDTHS = ['', 'is-mid', 'is-short']

  let sectionEl: HTMLElement | undefined = $state()
  let mounted = $state(false)
  let days = $state('30')
  let source = $state('all')
  let selected = $state<{ person: string; domain: string } | null>(null)
  let started = false

  const figure = createFigure<Agenda>({
    name: 'agenda',
    params: () => api.agendaParams({ days, source }),
    fetch: (p, signal) => api.loadAgenda(p, signal),
    ghost: () => {},
    paint: () => {},
    paintError: () => {},
    detail: (d) => ({ domains: d.domains.length }),
    el: () => sectionEl,
    markSelector: '[data-person]',
    onRelease: () => {
      selected = null
    },
  })

  onMount(() => {
    mounted = true
  })

  $effect(() => {
    if (!bootData.ready || bootData.peopleError || started) return
    started = true
    const seed = seedFor('agenda', ['days', 'source'], bootData.search)
    if (seed.days && DAY_CHOICES.includes(seed.days)) days = seed.days
    if (seed.source && SOURCE_SEGMENTS.some(([v]) => v === seed.source)) source = seed.source
    void figure.load()
  })

  let previous: Agenda | undefined
  $effect(() => {
    const current = figure.data
    if (current === previous) return
    previous = current
    untrack(() => {
      if (docsCard.openedBy('agenda')) docsCard.close()
      selected = null
    })
  })

  const status = $derived(bootData.peopleError ? 'error' : bootData.ready ? 'ok' : 'pending')
  const ghosting = $derived(status === 'pending' || (status === 'ok' && figure.loading && figure.data === undefined))
  const view = $derived(status === 'error' ? 'unavailable' : ghosting ? 'ghost' : figure.error ? 'error' : figure.data === undefined ? 'ghost' : figure.data.domains.length === 0 ? 'empty' : 'grid')
  const rows = $derived(figure.data ? agendaRows(figure.data) : [])

  const onControl = () => {
    figure.release()
    figure.reload()
  }

  const pick = (person: string, name: string, domain: string) => {
    if (selected && selected.person === person && selected.domain === domain) {
      figure.release()
      return
    }
    const data = figure.data
    selected = { person, domain }
    if (!data) return
    docsCard.open({
      owner: 'agenda',
      kicker: 'Documentos de',
      title: domain,
      sides: [{ personId: person, personName: name, query: api.docsParams({ days: String(data.days), source, domain }) }],
    })
  }
</script>

<section class="figure agenda" id="agenda" aria-labelledby="agendaTitle" class:is-loading={figure.loading && figure.data !== undefined} bind:this={sectionEl}>
  <header class="figure-head">
    <div class="figure-title"><span class="eyebrow">Gráfico 8</span><h2 id="agendaTitle">Agenda por veículo</h2></div>
    <p class="figure-sub">Qual fatia da cobertura rastreada de cada veículo pertence a cada pessoa. <a href="/como-ler#agenda">Como ler</a>.</p>
    <dl class="figure-key">
      <div><dt><span class="ink-scale" aria-hidden="true"></span>Tinta</dt><dd>fatia da cobertura rastreada do veículo</dd></div>
      <div><dt>Posição</dt><dd>veículo na linha, pessoa na coluna</dd></div>
      <div><dt>Clique</dt><dd>documentos daquela pessoa naquele veículo</dd></div>
    </dl>
    <div class="sentence"><p class="sentence-line">Qual fatia da cobertura de cada veículo é sobre cada pessoa, nos <span class="keep"><span class="pick"><select id="agendaDays" aria-label="Período (agenda)" value={days} onchange={(e) => { days = e.currentTarget.value; onControl() }}><option value="7">últimos 7 dias</option><option value="30" selected>últimos 30 dias</option><option value="60">últimos 60 dias</option></select></span>,</span> em <span class="keep"><span class="pick"><select id="agendaSource" aria-label="Fonte (agenda)" value={source} onchange={(e) => { source = e.currentTarget.value; onControl() }}>{#each SOURCE_SEGMENTS as [value, text] (value)}<option {value}>{sourceLabels[value] ?? text}</option>{/each}</select></span>.</span></p></div>
  </header>
  <figure class="agenda-grid" id="agendaGrid" aria-label="Fatia de cobertura por veículo e por pessoa" hidden={!mounted} aria-busy={view === 'ghost' ? 'true' : 'false'}>
    {#if view === 'unavailable'}
      <p class="note">Falha de rede ou base indisponível.<br><br><button class="quiet-button" id="agendaRetry" onclick={() => location.reload()}>Tentar novamente</button></p>
    {:else if view === 'ghost'}
      <div class="agenda-ghost ghost-field" aria-hidden="true">
        {#each [0, 1, 2, 3, 4, 5] as i (i)}
          <div class="agenda-ghost-row"><span class="ghost ghost-outlet-d {WIDTHS[i % 3]}"></span>{#each [0, 1, 2, 3] as j (j)}<span class="ghost ghost-outlet-n"></span>{/each}</div>
        {/each}
      </div>
      <p class="sr-only">Lendo a agenda.</p>
    {:else if view === 'error'}
      <p class="note">Não foi possível carregar a agenda. <button class="quiet-button" id="agendaErrorRetry" onclick={() => figure.reload()}>Tentar novamente</button></p>
    {:else if view === 'empty'}
      <p class="note">Nenhum veículo atingiu o mínimo de {api.AGENDA_MIN} documentos rastreados nesta janela.</p>
    {:else if figure.data}
      {@const data = figure.data}
      <div class="agenda-scroll"><table class="agenda-table">
        <caption class="sr-only">Fatia da cobertura de cada veículo, por pessoa</caption>
        <thead><tr><th scope="col"></th>{#each data.persons as p (p.id)}<th scope="col">{p.name}</th>{/each}</tr></thead>
        <tbody>
          {#each rows as row (row.domain)}
            <tr><th scope="row"><span class="d">{row.domain}</span>{#if row.lean}<span class="lean-chip">{LEAN_LABELS[row.lean] ?? row.lean}</span>{/if}</th>
              {#each data.persons as p (p.id)}
                {@const cell = row.cells.get(p.id)}
                {#if !cell}
                  <td class="agenda-cell is-empty"><span class="sr-only">sem documentos</span></td>
                {:else}
                  {@const active = !!selected && selected.person === p.id && selected.domain === row.domain}
                  {@const pct = Math.round(cell.share * 100)}
                  <td class="agenda-cell"><button class="agenda-pick" class:is-active={active} data-person={p.id} data-domain={row.domain} aria-pressed={active} style:--share="{Math.max(pct, 1)}%" title="{fmt(cell.docs)} {cell.docs === 1 ? 'documento' : 'documentos'}" onclick={() => pick(p.id, p.name, row.domain)}>{cell.docs > 0 && pct === 0 ? '<1%' : `${pct}%`}</button></td>
                {/if}
              {/each}
            </tr>
          {/each}
        </tbody>
      </table></div>
      <p class="note">A fatia é da cobertura rastreada do próprio veículo, não da pessoa. A soma de uma linha pode passar de 100%: um documento que cita duas pessoas rastreadas conta para as duas.</p>
    {/if}
  </figure>
</section>
