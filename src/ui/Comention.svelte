<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import * as api from './api.js'
  import { bootData } from './boot.svelte.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import { cellCount, fmt, personInitials, sourceLabels, SOURCE_SEGMENTS, type Comention } from './format.js'
  import { matrixLayout } from './layout.js'
  import { seedFor } from './seed.js'

  const OWNER = 'comention'
  const DEFAULT_WIDTH = 860
  const GHOST_N = 27
  const LIST_GHOST_N = 6
  const TOP_PAIRS = 15
  const WIDE_QUERY = '(min-width: 900px)'
  const DAYS = ['7', '21']
  const LEANS = ['all', 'left', 'center', 'right']
  const MINS = ['1', '2', '3', '5']
  const SOURCES = SOURCE_SEGMENTS.map(([value]) => value)

  let mounted = $state(false)
  let matrixEl: HTMLElement | undefined = $state()
  let personEl: HTMLSelectElement | undefined = $state()
  let daysEl: HTMLSelectElement | undefined = $state()
  let sourceEl: HTMLSelectElement | undefined = $state()
  let leanEl: HTMLSelectElement | undefined = $state()
  let minEl: HTMLSelectElement | undefined = $state()
  let person = $state('')
  let days = $state('21')
  let source = $state(SOURCE_SEGMENTS[0][0])
  let lean = $state('all')
  let min = $state('3')
  type Row = { a: string; b: string; from: string; label: string; aria: string; count: number; w: number }
  type View = 'idle' | 'ghost' | 'data' | 'error'
  let view = $state<View>('idle')
  let shown = $state.raw<Comention | null>(null)
  let selected = $state.raw<{ a: string; b: string } | null>(null)
  let dim = $state(false)
  let width = $state(DEFAULT_WIDTH)
  let showMatrix = $state(false)
  let wide = $state(false)
  let shownMin = $state('3')
  let started = false
  const loadedMin = new WeakMap<object, string>()

  const failed = $derived(Boolean(bootData.peopleError))
  const ghosting = $derived(!failed && (!bootData.ready || view === 'ghost'))
  const layout = $derived(shown ? matrixLayout(shown.persons, shown.pairs, width) : null)
  const cellAt = $derived(new Map((layout?.cells ?? []).map((c) => [`${c.a}\u0000${c.b}`, c])))
  const matrixShown = $derived(mounted && wide && showMatrix)
  const nameOf = (id: string) => shown?.persons.find((p) => p.id === id)?.name ?? bootData.people.find((p) => p.id === id)?.name ?? id
  const byCount = (a: Row, b: Row) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR')
  const withScale = (rows: Row[]): Row[] => {
    const max = Math.max(1, ...rows.map((r) => r.count))
    return rows.map((r) => ({ ...r, w: r.count / max }))
  }
  const rows = $derived.by((): Row[] => {
    if (!shown) return []
    if (person) {
      const own = shown.pairs
        .filter((p) => p.a === person || p.b === person)
        .map((p) => {
          const partner = p.a === person ? p.b : p.a
          return { a: p.a, b: p.b, from: person, label: nameOf(partner), aria: `${nameOf(person)} e ${nameOf(partner)}`, count: p.count, w: 0 }
        })
      return withScale(own.sort(byCount))
    }
    const top = shown.pairs
      .map((p) => ({ a: p.a, b: p.b, from: p.a, label: `${nameOf(p.a)} × ${nameOf(p.b)}`, aria: `${nameOf(p.a)} e ${nameOf(p.b)}`, count: p.count, w: 0 }))
      .sort(byCount)
      .slice(0, TOP_PAIRS)
    return withScale(top)
  })
  const plural = (n: number) => `${fmt(n)} ${n === 1 ? 'parceiro' : 'parceiros'}`
  const about = $derived(
    failed
      ? 'Falha de rede ou base indisponível.'
      : view === 'data' && shown
        ? person
          ? `${nameOf(person)} tem ${plural(rows.length)} nos ${shown.days} dias, com ${shownMin} textos em comum ou mais.`
          : shown.pairs.length
            ? `${fmt(shown.pairs.length)} ${shown.pairs.length === 1 ? 'par' : 'pares'} de pessoas citadas juntas nos ${shown.days} dias.`
            : 'Ninguém apareceu junto o suficiente nesta janela.'
        : '',
  )

  // A grid cell keys a/b by row/column, the ranked list by id; normalize so a pair selected in
  // one markup reads as selected in the other.
  const normalize = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a])
  const isSelected = (a: string, b: string) => {
    if (!selected) return false
    const [x, y] = normalize(a, b)
    return selected.a === x && selected.b === y
  }

  const measure = () => {
    const w = matrixEl?.clientWidth
    if (w) width = Math.floor(w)
  }

  const showDocs = (from: string, to: string) => {
    docsCard.open({
      owner: OWNER,
      kicker: 'Documentos com as duas pessoas',
      title: `${nameOf(from)} e ${nameOf(to)}`,
      sides: [{ personId: from, personName: nameOf(from), label: nameOf(from), query: api.docsParams({ days, source, lean, withId: to }) }],
    })
  }

  // `from` is the side whose texts are asked for: the picked person in person mode, the smaller id otherwise.
  const pick = (a: string, b: string, picked?: string) => {
    const [x, y] = normalize(a, b)
    const from = picked ?? x
    if (selected && selected.a === x && selected.b === y) {
      figure.release()
      return
    }
    selected = { a: x, b: y }
    showDocs(from, from === x ? y : x)
  }

  const dropStalePick = () => {
    if (docsCard.openedBy(OWNER)) docsCard.close()
    selected = null
  }

  const figure = createFigure<Comention>({
    name: 'comention',
    params: () => (failed ? null : api.comentionParams({ days, source, lean, min })),
    fetch: async (params, signal) => {
      const result = await api.loadComention(params, signal)
      loadedMin.set(result, params.get('min') ?? '')
      return result
    },
    ghost: () => {
      if (shown) dim = true
      else view = 'ghost'
    },
    paint: (result) => {
      if (result !== shown) dropStalePick()
      shown = result
      shownMin = loadedMin.get(result) || min
      dim = false
      view = 'data'
      measure()
    },
    paintError: () => {
      shown = null
      dropStalePick()
      dim = false
      view = 'error'
    },
    el: () => matrixEl,
    markSelector: '[data-a]',
    onRelease: () => {
      selected = null
    },
  })

  const among = (options: string[], value: string | undefined) => (value !== undefined && options.includes(value) ? value : undefined)

  const write = (el: HTMLSelectElement | undefined, value: string) => {
    if (el) el.value = value
    return value
  }

  onMount(() => {
    mounted = true
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(WIDE_QUERY)
    wide = query.matches
    const onWide = (event?: { matches?: boolean }) => {
      wide = event?.matches ?? query.matches
    }
    query.addEventListener('change', onWide)
    return () => query.removeEventListener('change', onWide)
  })

  // The grid only exists once the toggle has flipped, so the width read while the list was on
  // screen is not the one the grid should lay out at.
  $effect(() => {
    if (matrixShown && matrixEl) untrack(measure)
  })

  $effect(() => {
    if (!bootData.ready || started) return
    started = true
    untrack(() => {
      if (bootData.peopleError) return
      const seed = seedFor('comention', ['person', 'days', 'source', ['lean', null], ['min', null]], bootData.search)
      person = write(personEl, seed.person && bootData.people.some((p) => p.id === seed.person) ? seed.person : person)
      days = write(daysEl, among(DAYS, seed.days) ?? days)
      source = write(sourceEl, among(SOURCES, seed.source) ?? source)
      lean = write(leanEl, among(LEANS, seed.lean) ?? lean)
      min = write(minEl, among(MINS, seed.min) ?? min)
      void figure.load()
    })
  })

  const onPerson = (event: Event) => {
    person = (event.currentTarget as HTMLSelectElement).value
    figure.release()
  }

  const onChange = (set: (value: string) => void) => (event: Event) => {
    set((event.currentTarget as HTMLSelectElement).value)
    figure.release()
    figure.reload()
  }
</script>

<section class="figure comention" id="comention" aria-labelledby="comentionTitle" class:is-loading={dim}>
  <header class="figure-head">
    <div class="figure-title"><span class="eyebrow">Gráfico 8</span><h2 id="comentionTitle">Quem aparece junto</h2></div>
    <p class="figure-sub">Quantos textos citam duas pessoas rastreadas ao mesmo tempo, na mesma janela. <a href="/como-ler#junto">Como ler</a>.</p>
    <dl class="figure-key">
      <div><dt>Linha</dt><dd>uma pessoa e quem aparece junto com ela, ou um par entre todas</dd></div>
      <div><dt>Barra</dt><dd>textos que citam as duas; a barra mais longa é o maior número mostrado, não uma fatia</dd></div>
      <div><dt>Clique</dt><dd>os textos daquele par</dd></div>
      <div><dt>Grade</dt><dd>a matriz inteira, em telas de 900px ou mais</dd></div>
      <div><dt>Nota</dt><dd>aparecer junto não é concordar</dd></div>
    </dl>
    <div class="sentence"><p class="sentence-line">Quem aparece junto de <span class="keep"><span class="pick"><select id="comentionPerson" aria-label="Pessoa (quem aparece junto)" bind:this={personEl} onchange={onPerson}><option value="">todas as pessoas</option>{#each bootData.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select></span>,</span> nos <span class="keep"><span class="pick"><select id="comentionDays" aria-label="Período (quem aparece junto)" bind:this={daysEl} onchange={onChange((v) => (days = v))}><option value="7">últimos 7 dias</option><option value="21" selected>últimos 21 dias</option></select></span>,</span> em <span class="keep"><span class="pick"><select id="comentionSource" aria-label="Fonte (quem aparece junto)" bind:this={sourceEl} onchange={onChange((v) => (source = v))}>{#each SOURCE_SEGMENTS as [value, text] (value)}<option {value}>{sourceLabels[value] ?? text}</option>{/each}</select></span>,</span> por <span class="keep"><span class="pick"><select id="comentionLean" aria-label="Viés (quem aparece junto)" bind:this={leanEl} onchange={onChange((v) => (lean = v))}><option value="all" selected>todo o viés</option><option value="left">esquerda</option><option value="center">centro</option><option value="right">direita</option></select></span>.</span> Mostrar pares com <span class="pick"><select id="comentionMin" aria-label="Mínimo de textos em comum" bind:this={minEl} onchange={onChange((v) => (min = v))}><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="5">5</option></select></span> textos em comum ou mais.</p></div>
  </header>
  {#if mounted && wide && !failed}
    <button type="button" class="comention-toggle" id="comentionToggle" aria-controls="comentionMatrix" onclick={() => (showMatrix = !showMatrix)}>{showMatrix ? 'ver a lista' : 'ver a grade inteira'}</button>
  {/if}
  <figure class="comention-body" id="comentionMatrix" aria-label="Pares de pessoas citadas juntas" aria-busy={ghosting} hidden={failed || !mounted} bind:this={matrixEl}>
    {#if failed}
      <!-- body stays empty -->
    {:else if ghosting}
      <div class="ghost-field" aria-hidden="true">
        {#if matrixShown}
          <div class="comention-grid is-ghost">
            {#each { length: GHOST_N } as _row}
              <div class="comention-row">
                {#each { length: GHOST_N } as _cell}<span class="comention-cell ghost"></span>{/each}
              </div>
            {/each}
          </div>
        {:else}
          <ol class="comention-list is-ghost">
            {#each { length: LIST_GHOST_N } as _item}<li><span class="comention-listitem ghost"></span></li>{/each}
          </ol>
        {/if}
      </div>
      <p class="sr-only">Lendo quem aparece junto.</p>
    {:else if view === 'error'}
      <p class="note">Não foi possível carregar quem aparece junto.</p>
    {:else if view === 'data' && shown && matrixShown && layout}
      {@const persons = shown.persons}
      <div class="comention-grid" style:--n={persons.length} style:--rowhead="{layout.rowhead}px" style:--pitch="{layout.pitch}px" style:--cell="{layout.cellSize}px" style:--gap="{layout.gap}px">
        <div class="comention-row comention-headrow">
          <div class="comention-rowhead" aria-hidden="true"></div>
          {#each persons as p (p.id)}<span class="comention-colhead" title={p.name}>{personInitials(p.name)}</span>{/each}
        </div>
        {#each persons as row, i (row.id)}
          <div class="comention-row">
            <div class="comention-rowhead">{row.name}</div>
            {#each persons as col, j (col.id)}
              {#if i >= j}
                <span class="comention-cell is-blank" aria-hidden="true"></span>
              {:else}
                {@const cell = cellAt.get(`${row.id}\u0000${col.id}`)}
                {#if !cell || cell.count === null}
                  <span class="comention-cell is-empty" aria-hidden="true"></span>
                {:else}
                  {@const on = isSelected(cell.a, cell.b)}
                  <button type="button" class="comention-cell" class:is-selected={on} style:--w={cell.ink} data-a={cell.a} data-b={cell.b} aria-pressed={on} title={fmt(cell.count)} aria-label="{row.name} e {col.name}: {fmt(cell.count)} textos juntos" onclick={() => pick(cell.a, cell.b)}>{cellCount(cell.count, layout.cellSize)}</button>
                {/if}
              {/if}
            {/each}
          </div>
        {/each}
      </div>
    {:else if view === 'data' && shown}
      {#if person && !rows.length}
        <p class="note">Ninguém apareceu junto com {nameOf(person)} em {shownMin} textos ou mais.</p>
      {:else}
        <ol class="comention-list">
          {#each rows as row (row.a + '\u0000' + row.b)}
            {@const on = isSelected(row.a, row.b)}
            <li><button type="button" class="comention-listitem" class:is-selected={on} data-a={row.a} data-b={row.b} aria-pressed={on} aria-label="{row.aria}: {fmt(row.count)} textos juntos" onclick={() => pick(row.a, row.b, row.from)}><span class="comention-name">{row.label}</span><span class="comention-bar" style:--w={row.w} aria-hidden="true"></span><span class="comention-count">{fmt(row.count)}</span></button></li>
          {/each}
        </ol>
      {/if}
    {/if}
  </figure>
  <p class="note" id="comentionAbout">{about}</p>
</section>
