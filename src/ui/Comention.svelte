<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import * as api from './api.js'
  import { bootData } from './boot.svelte.js'
  import * as docsCard from './docs-card.svelte.js'
  import { createFigure } from './figure.svelte.js'
  import { fmt, personInitials, sourceLabels, SOURCE_SEGMENTS, type Comention } from './format.js'
  import { matrixLayout } from './layout.js'
  import { seedFor } from './seed.js'

  const OWNER = 'comention'
  const DEFAULT_WIDTH = 860
  const GHOST_N = 27
  const LIST_GHOST_N = 6
  const DAYS = ['7', '21']
  const LEANS = ['all', 'left', 'center', 'right']
  const MINS = ['1', '2', '3', '5']
  const SOURCES = SOURCE_SEGMENTS.map(([value]) => value)

  let mounted = $state(false)
  let matrixEl: HTMLElement | undefined = $state()
  let daysEl: HTMLSelectElement | undefined = $state()
  let sourceEl: HTMLSelectElement | undefined = $state()
  let leanEl: HTMLSelectElement | undefined = $state()
  let minEl: HTMLSelectElement | undefined = $state()
  let days = $state('21')
  let source = $state(SOURCE_SEGMENTS[0][0])
  let lean = $state('all')
  let min = $state('3')
  type View = 'idle' | 'ghost' | 'data' | 'error'
  let view = $state<View>('idle')
  let shown = $state.raw<Comention | null>(null)
  let selected = $state.raw<{ a: string; b: string } | null>(null)
  let dim = $state(false)
  let width = $state(DEFAULT_WIDTH)
  let started = false

  const failed = $derived(Boolean(bootData.peopleError))
  const ghosting = $derived(!failed && (!bootData.ready || view === 'ghost'))
  const layout = $derived(shown ? matrixLayout(shown.persons, shown.pairs, width) : null)
  const cellAt = $derived(new Map((layout?.cells ?? []).map((c) => [`${c.a}\u0000${c.b}`, c])))
  const ranked = $derived(shown ? [...shown.pairs].sort((a, b) => b.count - a.count) : [])
  const about = $derived(
    failed
      ? 'Falha de rede ou base indisponível.'
      : view === 'data' && shown
        ? shown.pairs.length
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

  const showDocs = (a: string, b: string) => {
    const nameOf = (id: string) => bootData.people.find((p) => p.id === id)?.name ?? id
    docsCard.open({
      owner: OWNER,
      kicker: 'Documentos com as duas pessoas',
      title: `${nameOf(a)} e ${nameOf(b)}`,
      sides: [{ personId: a, personName: nameOf(a), label: nameOf(a), query: api.docsParams({ days, source, lean, withId: b }) }],
    })
  }

  const pick = (a: string, b: string) => {
    const [x, y] = normalize(a, b)
    if (selected && selected.a === x && selected.b === y) {
      figure.release()
      return
    }
    selected = { a: x, b: y }
    showDocs(x, y)
  }

  const dropStalePick = () => {
    if (docsCard.openedBy(OWNER)) docsCard.close()
    selected = null
  }

  const figure = createFigure<Comention>({
    name: 'comention',
    params: () => (failed ? null : api.comentionParams({ days, source, lean, min })),
    fetch: (params, signal) => api.loadComention(params, signal),
    ghost: () => {
      if (shown) dim = true
      else view = 'ghost'
    },
    paint: (result) => {
      if (result !== shown) dropStalePick()
      shown = result
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
  })

  $effect(() => {
    if (!bootData.ready || started) return
    started = true
    untrack(() => {
      if (bootData.peopleError) return
      const seed = seedFor('comention', ['days', 'source', ['lean', null], ['min', null]], bootData.search)
      days = write(daysEl, among(DAYS, seed.days) ?? days)
      source = write(sourceEl, among(SOURCES, seed.source) ?? source)
      lean = write(leanEl, among(LEANS, seed.lean) ?? lean)
      min = write(minEl, among(MINS, seed.min) ?? min)
      void figure.load()
    })
  })

  const onChange = (set: (value: string) => void) => (event: Event) => {
    set((event.currentTarget as HTMLSelectElement).value)
    figure.release()
    figure.reload()
  }
</script>

<section class="figure comention" id="comention" aria-labelledby="comentionTitle" class:is-loading={dim}>
  <header class="figure-head">
    <div class="figure-title"><span class="eyebrow">Gráfico 9</span><h2 id="comentionTitle">Quem aparece junto</h2></div>
    <p class="figure-sub">Quantos textos citam duas pessoas rastreadas ao mesmo tempo, na mesma janela. <a href="/como-ler#junto">Como ler</a>.</p>
    <dl class="figure-key">
      <div><dt>Célula</dt><dd>textos que citam as duas pessoas juntas na janela</dd></div>
      <div><dt>Cor</dt><dd>mais clara, mais textos; nunca é avaliação</dd></div>
      <div><dt>Clique</dt><dd>os textos daquele par</dd></div>
      <div><dt>Nota</dt><dd>aparecer junto não é concordar</dd></div>
    </dl>
    <div class="sentence"><p class="sentence-line">Pares de pessoas citadas juntas nos <span class="keep"><span class="pick"><select id="comentionDays" aria-label="Período (quem aparece junto)" bind:this={daysEl} onchange={onChange((v) => (days = v))}><option value="7">últimos 7 dias</option><option value="21" selected>últimos 21 dias</option></select></span>,</span> em <span class="keep"><span class="pick"><select id="comentionSource" aria-label="Fonte (quem aparece junto)" bind:this={sourceEl} onchange={onChange((v) => (source = v))}>{#each SOURCE_SEGMENTS as [value, text] (value)}<option {value}>{sourceLabels[value] ?? text}</option>{/each}</select></span>,</span> por <span class="keep"><span class="pick"><select id="comentionLean" aria-label="Viés (quem aparece junto)" bind:this={leanEl} onchange={onChange((v) => (lean = v))}><option value="all" selected>todo o viés</option><option value="left">esquerda</option><option value="center">centro</option><option value="right">direita</option></select></span>.</span> Mostrar pares com <span class="pick"><select id="comentionMin" aria-label="Mínimo de textos em comum" bind:this={minEl} onchange={onChange((v) => (min = v))}><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="5">5</option></select></span> textos em comum ou mais.</p></div>
  </header>
  <figure class="comention-body" id="comentionMatrix" aria-label="Matriz de pares de pessoas citadas juntas" aria-busy={ghosting} hidden={failed || !mounted} bind:this={matrixEl}>
    {#if failed}
      <!-- matrix stays empty -->
    {:else if ghosting}
      <div class="ghost-field" aria-hidden="true">
        <div class="comention-grid is-ghost">
          {#each { length: GHOST_N } as _row}
            <div class="comention-row">
              {#each { length: GHOST_N } as _cell}<span class="comention-cell ghost"></span>{/each}
            </div>
          {/each}
        </div>
        <ol class="comention-list is-ghost">
          {#each { length: LIST_GHOST_N } as _item}<li><span class="comention-listitem ghost"></span></li>{/each}
        </ol>
      </div>
      <p class="sr-only">Lendo quem aparece junto.</p>
    {:else if view === 'error'}
      <p class="note">Não foi possível carregar quem aparece junto.</p>
    {:else if view === 'data' && shown && layout}
      {@const persons = shown.persons}
      <div class="comention-grid" style:--cell="{layout.cellSize}px">
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
                  <button type="button" class="comention-cell" class:is-selected={on} style:--w={cell.ink} data-a={cell.a} data-b={cell.b} aria-pressed={on} aria-label="{row.name} e {col.name}: {fmt(cell.count)} textos juntos" onclick={() => pick(cell.a, cell.b)}>{fmt(cell.count)}</button>
                {/if}
              {/if}
            {/each}
          </div>
        {/each}
      </div>
      <ol class="comention-list">
        {#each ranked as pair (pair.a + '\u0000' + pair.b)}
          {@const on = isSelected(pair.a, pair.b)}
          <li><button type="button" class="comention-listitem" class:is-selected={on} data-a={pair.a} data-b={pair.b} aria-pressed={on} onclick={() => pick(pair.a, pair.b)}><b>{fmt(pair.count)}</b> {persons.find((p) => p.id === pair.a)?.name ?? pair.a} × {persons.find((p) => p.id === pair.b)?.name ?? pair.b}</button></li>
        {/each}
      </ol>
    {/if}
  </figure>
  <p class="note" id="comentionAbout">{about}</p>
</section>
