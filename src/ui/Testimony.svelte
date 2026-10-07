<script lang="ts">
  import { untrack } from 'svelte'
  import * as api from './api.js'
  import { bootData } from './boot.svelte.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import {
    domainSuffix,
    fmt,
    mergeOutlets,
    signed,
    SOURCE_SEGMENTS,
    sourceLabels,
    testimonyClass,
    testimonyColor,
    testimonyFocus,
    testimonyPosition,
    type OutletRow,
    type Testimony,
  } from './format.js'
  import { STRIP_PAD, stripLayout } from './strip-model.js'
  import { seedFor } from './seed.js'

  type Merged = ReturnType<typeof mergeOutlets>[number]
  type Phase = 'ghost' | 'data' | 'error'

  const GHOST_DOTS: [number, number][] = [
    [92, 11],
    [210, 8],
    [348, 17],
    [430, 10],
    [528, 21],
    [656, 9],
    [768, 14],
  ]
  const TICKS = [-10, -5, 0, 5, 10]
  const DAYS = ['7', '21']
  const WIDEST = DAYS.at(-1)
  const GHOST_WIDTHS = ['', 'is-mid', 'is-short']

  let person = $state('')
  let days = $state('21')
  let source = $state('all')
  let outlet = $state('all')
  let started = false
  // A pick made while either fetch is dimmed points at data about to be replaced; only that pick is dropped when new data lands.
  let stalePick = false

  let testimony = $state.raw<Testimony | null>(null)
  let testimonyDays = $state('')
  let rows = $state.raw<OutletRow[] | null>(null)
  let testimonyPhase = $state<Phase>('ghost')
  let outletsPhase = $state<Phase>('ghost')
  let testimonyDim = $state(false)
  let outletsDim = $state(false)
  let stripWidth = $state(860)

  let stripEl: HTMLElement | undefined = $state()
  let listEl: HTMLElement | undefined = $state()
  let outletListEl: HTMLElement | undefined = $state()

  const people = $derived(bootData.people)
  const unavailable = $derived(bootData.ready && (!!bootData.peopleError || !bootData.people.length))

  const controlValues = () => ({ days, sort: 'count', limit: '18', source })

  const asGraphOpts = (qp: URLSearchParams) => ({
    days: qp.get('days')!,
    sort: qp.get('sort')!,
    limit: qp.get('limit')!,
    source: qp.get('source')!,
  })

  const outletsParams = (): URLSearchParams | null => {
    if (!bootData.ready || unavailable) return null
    const qp = api.sourcesParams(controlValues())
    qp.set('person', person)
    return qp
  }

  const testimonyParams = (): URLSearchParams | null => {
    if (!bootData.ready || unavailable) return null
    const qp = api.testimonyParams(controlValues())
    qp.set('person', person)
    return qp
  }

  const pickOutlet = (d: string) => {
    if (d === outlet) return
    if (d === 'all') {
      testimonyFigure.release()
      return
    }
    outlet = d
    stalePick = testimonyDim || outletsDim
    if (!person) return
    void docsCard.open({
      owner: 'testimony',
      kicker: 'Documentos de',
      title: d,
      sides: [
        {
          personId: person,
          personName: people.find((p) => p.id === person)?.name ?? person,
          query: api.docsParams({ days, source, domain: d }),
        },
      ],
    })
  }

  const toggle = (d: string | undefined) => pickOutlet(!d || d === outlet ? 'all' : d)

  const onStripKey = (event: KeyboardEvent, d: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggle(d)
    }
  }

  const dropStalePick = () => {
    if (!stalePick) return
    stalePick = false
    if (docsCard.openedBy('testimony')) docsCard.close()
    outlet = 'all'
  }

  const outletsFigure = createFigure<OutletRow[]>({
    name: 'outlets',
    // The memo bucket is the route this hits (/sources), not the figure name, or a hit would
    // record `api:outlets` instead of `api:sources`.
    scope: 'sources',
    params: outletsParams,
    fetch: (qp, signal) => api.loadSources(qp.get('person')!, api.sourcesParams(asGraphOpts(qp)), signal),
    ghost: () => {
      if (rows) outletsDim = true
      else outletsPhase = 'ghost'
    },
    paint: (data) => {
      dropStalePick()
      rows = data
      outletsPhase = 'data'
      outletsDim = false
    },
    paintError: () => {
      dropStalePick()
      rows = null
      outletsPhase = 'error'
      outletsDim = false
    },
    detail: (data, qp) => ({ person: qp.get('person'), rows: data.length }),
  })

  const testimonyFigure = createFigure<{ testimony: Testimony; days: string }>({
    name: 'testimony',
    params: testimonyParams,
    fetch: async (qp, signal) => ({ testimony: await api.loadTestimony(qp.get('person')!, api.testimonyParams(asGraphOpts(qp)), signal), days: qp.get('days')! }),
    ghost: () => {
      if (testimony) testimonyDim = true
      else testimonyPhase = 'ghost'
    },
    paint: (data) => {
      dropStalePick()
      // Read at paint time, never memoised, so a resize repaints at the current width.
      stripWidth = stripEl?.clientWidth || 860
      testimony = data.testimony
      testimonyDays = data.days
      testimonyPhase = 'data'
      testimonyDim = false
    },
    paintError: () => {
      dropStalePick()
      testimony = null
      testimonyDays = ''
      testimonyPhase = 'error'
      testimonyDim = false
    },
    detail: (_data, qp) => ({ person: qp.get('person') }),
    el: () => (stripEl && listEl && outletListEl ? [stripEl, listEl, outletListEl] : undefined),
    markSelector: '[data-domain], [data-testimony-domain], [data-strip-domain]',
    onRelease: () => {
      stalePick = false
      outlet = 'all'
    },
  })

  const onControlChange = () => {
    testimonyFigure.release()
    outletsFigure.reload()
    testimonyFigure.reload()
  }

  $effect(() => {
    if (!bootData.ready || started) return
    started = true
    untrack(() => {
      const seed = seedFor('testimony', ['person', 'days', 'source'], bootData.search)
      const list = bootData.people
      person = seed.person && list.some((p) => p.id === seed.person) ? seed.person : (list[0]?.id ?? '')
      if (seed.days && DAYS.includes(seed.days)) days = seed.days
      if (seed.source && SOURCE_SEGMENTS.some(([v]) => v === seed.source)) source = seed.source
      outlet = 'all'
      void outletsFigure.load()
      void testimonyFigure.load()
    })
  })

  const merged = $derived(mergeOutlets(rows ?? [], testimony?.by_domain ?? []))

  const byDocs = (a: Merged, b: Merged) => b.docs - a.docs || a.domain.localeCompare(b.domain)
  const docsOf = (g: Merged[]) => g.reduce((n, r) => n + r.docs, 0)

  // The field int is a build-local Louvain label, never a rank: groups order by their own docs.
  const groups = $derived.by(() => {
    const byField = new Map<number, Merged[]>()
    const ungrouped: Merged[] = []
    for (const r of merged) {
      if (r.field === null || r.field === undefined) ungrouped.push(r)
      else byField.set(r.field, [...(byField.get(r.field) ?? []), r])
    }
    const numbered = [...byField.values()]
      .map((g) => g.slice().sort(byDocs))
      .sort((a, b) => docsOf(b) - docsOf(a) || a[0].domain.localeCompare(b[0].domain))
      .map((g) => ({ eyebrow: `grupo · ${g.slice(0, 3).map((r) => r.domain).join(', ')}`, group: g }))
    return ungrouped.length ? [...numbered, { eyebrow: 'Sem agrupamento suficiente', group: ungrouped }] : numbered
  })

  const layout = $derived(testimony ? stripLayout(testimony.by_domain, stripWidth) : null)
  const overall = $derived(testimony?.overall.score ?? null)
  const stripShown = $derived(!unavailable && (testimonyPhase === 'ghost' || (testimonyPhase === 'data' && !!layout?.dots.length && overall !== null)))
  const hasScore = $derived(overall !== null && !!testimony?.overall.n)
  const focus = $derived(testimony ? testimonyFocus(testimony.by_domain, outlet) : null)
  const busy = (phase: Phase) => phase === 'ghost'
</script>

<section class="figure testimony" id="testimony" aria-labelledby="testimonyTitle">
  <header class="figure-head">
    <div class="figure-title"><span class="eyebrow">Gráfico 2</span><h2 id="testimonyTitle">Avaliação por veículo <b id="testimonyLabel">{testimonyPhase === 'data' && hasScore && !unavailable ? signed(overall) : ''}</b></h2></div>
    <p class="figure-sub">Compare veículos falando da mesma pessoa. Nunca compare pessoas. <a href="/como-ler#avaliacao">Como ler</a>.</p>
    <dl class="figure-key">
      <div><dt>Posição</dt><dd>nota do kikori, um modelo treinado para ler se o texto é contra (−10) ou a favor (+10)</dd></div>
      <div><dt>Tamanho</dt><dd>quantos textos o veículo tem</dd></div>
      <div><dt>Clique</dt><dd>textos daquele veículo, só neste gráfico</dd></div>
    </dl>
    <div class="sentence"><p class="sentence-line">Avaliação por veículo sobre <span class="pick"><select id="testimonyPerson" aria-label="Pessoa (avaliação por veículo)" value={person} onchange={(e) => { person = e.currentTarget.value; onControlChange() }}>{#each people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span> nos <span class="keep"><span class="pick"><select id="testimonyDays" aria-label="Período (avaliação por veículo)" value={days} onchange={(e) => { days = e.currentTarget.value; onControlChange() }}><option value="7">últimos 7 dias</option><option value="21">últimos 21 dias</option></select></span>,</span> em <span class="keep"><span class="pick"><select id="testimonySource" aria-label="Fonte (avaliação por veículo)" value={source} onchange={(e) => { source = e.currentTarget.value; onControlChange() }}>{#each SOURCE_SEGMENTS as [value, text] (value)}<option {value}>{sourceLabels[value] ?? text}</option>{/each}</select></span>.</span></p></div>
  </header>
  <figure class="strip" class:is-loading={testimonyDim} id="strip" aria-label="Veículos na régua da avaliação" aria-busy={busy(testimonyPhase)} hidden={!stripShown} bind:this={stripEl}>
    {#if testimonyPhase === 'ghost' && !unavailable}
      <div class="ghost-field" aria-hidden="true"><div class="strip-mean-row"></div><svg class="strip-svg" viewBox="0 0 860 96" width="860" height="96"><line class="strip-axis" x1={STRIP_PAD} x2={860 - STRIP_PAD} y1="48" y2="48"/>{#each TICKS as s (s)}{@const gx = STRIP_PAD + ((s + 10) / 20) * (860 - 2 * STRIP_PAD)}<line class="strip-tick" x1={gx} x2={gx} y1="43" y2="53"/>{/each}{#each GHOST_DOTS as [gx, r] (gx)}<circle class="ghost" cx={gx} cy="48" r={r}/>{/each}</svg><div class="strip-axis-labels"><span>−10 contra</span><span>0</span><span>+10 a favor</span></div></div>
    {:else if stripShown && layout && overall !== null}
      {@const { dots, x, half, height } = layout}
      <div class="strip-mean-row"><span class="strip-mean" style:--pos="{testimonyPosition(overall)}%">média da pessoa {signed(overall)}</span></div>
      <svg class="strip-svg" viewBox="0 0 {stripWidth} {height}" width={stripWidth} {height} role="group" aria-label="Veículos na régua da avaliação, de −10 a +10"><line class="strip-axis" x1={STRIP_PAD} x2={stripWidth - STRIP_PAD} y1={half} y2={half}/>{#each TICKS as s (s)}<line class="strip-tick" x1={x(s)} x2={x(s)} y1={half - 5} y2={half + 5}/>{/each}<line class="strip-overall" x1={x(overall)} x2={x(overall)} y1="4" y2={height - 4}/>{#each dots as d (d.domain)}<g class="strip-dot {d.domain === outlet ? 'is-active' : ''}" style:--tone={testimonyColor(d.score)} data-strip-domain={d.domain} role="button" tabindex="0" aria-pressed={d.domain === outlet} aria-label="{d.domain}, {signed(d.score)} em {fmt(d.n)} textos" onclick={() => toggle(d.domain)} onkeydown={(e) => onStripKey(e, d.domain)}><title>{`${d.domain} · ${d.sources.map((s) => sourceLabels[s] ?? s).join(', ')} · ${signed(d.score)} em ${fmt(d.n)} ${d.n === 1 ? 'texto' : 'textos'}`}</title><circle class="dot-halo" cx={d.x} cy={half + d.y} r={d.r + 5}/><circle class="dot-face" cx={d.x} cy={half + d.y} r={d.r}/></g>{/each}</svg><div class="strip-axis-labels"><span>−10 contra</span><span>0</span><span>+10 a favor</span></div><p class="note">Uma bolinha por veículo com 3 ou mais textos avaliados; o tamanho é quantos textos. Toque numa bolinha para destacá-la aqui{outlet === 'all' ? '' : '; toque de novo, ou fora das bolinhas, para soltar'}. O atlas acima não muda.</p>
    {/if}
  </figure>
  <div class="testimony-lists" class:is-loading={testimonyDim} id="testimonyList" aria-busy={busy(unavailable ? 'data' : testimonyPhase)} bind:this={listEl}>
    {#if unavailable}
      {#if bootData.peopleError}
        <p class="note">Falha de rede ou base indisponível.<br>Nenhuma avaliação fictícia será exibida.<br><br><button class="quiet-button" id="testimonyRetry" onclick={() => location.reload()}>Tentar novamente</button></p>
      {:else}
        Nenhuma pessoa cadastrada.
      {/if}
    {:else if testimonyPhase === 'ghost'}
      <div class="ghost-field" aria-hidden="true"><dl class="verdict stat"><div><dt><span class="ghost ghost-kicker"></span></dt><dd><span class="ghost ghost-stat is-xl"></span></dd></div></dl><span class="ghost ghost-line is-short"></span><dl class="source-chips">{#each [0, 1, 2, 3] as i (i)}<div class="source-chip"><span class="ghost ghost-chip"></span></div>{/each}</dl></div><p class="sr-only">Lendo a avaliação.</p>
    {:else if testimonyPhase === 'error'}
      <p class="note">Não foi possível carregar a avaliação.</p>
    {:else if testimony && !hasScore}
      <div class="pet-empty"><img class="pet" src="/pet-caracara.png" alt="" width="106" height="78"><p class="note">Nenhum texto avaliado neste recorte (método {testimony.method}).<br>{testimonyDays === WIDEST ? 'Tente outra fonte.' : 'Tente um período maior ou outra fonte.'}</p></div>
    {:else if testimony && overall !== null}
      <dl class="verdict stat"><div><dt>Média do recorte</dt><dd style:--tone={testimonyColor(overall)}>{signed(overall)}</dd></div></dl><p class="verdict-class">{testimonyClass(overall)} · média de {fmt(testimony.overall.n)} {testimony.overall.n === 1 ? 'texto avaliado' : 'textos avaliados'}</p>
      {#if outlet !== 'all'}
        {#if focus}
          <p class="focus"><b>{outlet}</b>: <strong style:--tone={testimonyColor(focus.score)}>{signed(focus.score)}</strong> em {fmt(focus.n)} {focus.n === 1 ? 'texto' : 'textos'}. O número acima é o recorte inteiro.</p>
        {:else}
          <p class="focus"><b>{outlet}</b>: menos de 3 textos avaliados, sem média própria. O número acima é o recorte inteiro.</p>
        {/if}
      {/if}
      <dl class="source-chips">{#each testimony.by_source as r (r.source)}<div class="source-chip"><dt>{sourceLabels[r.source] ?? r.source}</dt><dd><span class="n">{fmt(r.n)}</span><span class="t" style:--tone={testimonyColor(r.score)}>{r.score === null || r.score === undefined ? '' : signed(r.score)}</span></dd></div>{/each}</dl>
    {/if}
  </div>
  <div class="outlets" id="outlets"><p class="eyebrow">Veículos do recorte <b id="domainLabel">{domainSuffix(outlet)}</b></p>
    <div id="outletList" class:is-loading={outletsDim} aria-busy={busy(unavailable ? 'data' : outletsPhase)} bind:this={outletListEl}>
      {#if unavailable}
        <!-- nothing -->
      {:else if outletsPhase === 'ghost'}
        <div class="outlet-grid ghost-field" aria-hidden="true">{#each [0, 1, 2, 3, 4, 5, 6, 7] as i (i)}<div class="outlet"><span class="d"><span class="ghost ghost-outlet-d {GHOST_WIDTHS[i % 3]}"></span></span><span class="n"><span class="ghost ghost-outlet-n"></span></span><span class="t"><span class="ghost ghost-outlet-n"></span></span></div>{/each}</div><p class="sr-only">Lendo os veículos.</p>
      {:else if outletsPhase === 'error'}
        <p class="note">Não foi possível carregar os veículos.</p>
      {:else if merged.length}
        {#each groups as g (g.eyebrow)}
          <p class="eyebrow">{g.eyebrow}</p>
          <div class="outlet-grid">
            {#each g.group as r (r.domain)}
              {#if r.sources.includes(r.domain)}
                <span class="outlet is-static" title="Textos sem veículo nesta fonte"><span class="d">{r.domain}</span><span class="n">{fmt(r.docs)}</span><span class="t">{r.score === null ? '' : signed(r.score)}</span></span>
              {:else}
                <button class="outlet {r.domain === outlet ? 'is-active' : ''}" data-domain={r.domain} aria-pressed={r.domain === outlet} style:--tone={testimonyColor(r.score)} title={r.sources.map((x) => sourceLabels[x] ?? x).join(', ')} onclick={() => toggle(r.domain)}><span class="d">{r.domain}</span><span class="n">{fmt(r.docs)}</span><span class="t">{r.score === null ? '' : signed(r.score)}</span></button>
              {/if}
              {#if r.domain === outlet}
                <dl class="metric stat"><div><dt>Vocabulário mais parecido com</dt><dd>{#if r.neighbors.length}{#each r.neighbors.slice(0, 5) as nb (nb.domain)}<span class="outlet-neighbor">{nb.domain} · <span class="n">{nb.similarity.toFixed(2)}</span></span>{/each}{:else}Nenhum veículo com vocabulário parecido neste recorte{/if}</dd></div></dl>
              {/if}
            {/each}
          </div>
        {/each}
        <p class="note">Documentos no recorte e, quando o veículo tem 3 ou mais textos avaliados, a nota de −10 a +10 que o kikori ({testimony?.method ?? ''}) dá a cada texto sobre a pessoa. Compare veículos falando da mesma pessoa; não compare pessoas entre si. Grupos e vocabulário parecido vêm da construção da janela, não da consulta ao vivo, e podem ficar desatualizados entre construções.</p>
      {:else}
        <p class="note">Nenhum veículo neste recorte.</p>
      {/if}
    </div>
  </div>
</section>
