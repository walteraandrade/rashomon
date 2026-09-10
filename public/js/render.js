// DOM layer: paints the map, the inspector, the outlet list and the docs panel. Every
// function here reads/writes the document directly (that is its job); the data it paints
// and the callbacks it wires (onChoose, onShowDocs, onPick) all come in as parameters, so
// this module never reaches into public/js/state.js on its own.

import { balanceColor, domainSuffix, esc, fmt, kinds, label, matching, mergeOutlets, normalize, relatedTo, safeDocUrl, score, scoreName, foldTestimonyDomains, MASK_MIN, signed, sourceLabels, termMask, testimonyClass, testimonyColor, testimonyFocus, testimonyPosition, trendOf } from './format.js'
import { FONT_SANS, RULER_PAD, rulerLayout, routesFrom, swarm } from './layout.js'

/** @typedef {import('./format.js').Candidate} Candidate */
/** @typedef {import('./format.js').Compare} Compare */
/** @typedef {import('./format.js').CompareSide} CompareSide */
/** @typedef {import('./format.js').CompareTerm} CompareTerm */
/** @typedef {import('./format.js').Doc} Doc */
/** @typedef {import('./format.js').Graph} Graph */
/** @typedef {import('./format.js').Layout} Layout */
/** @typedef {import('./format.js').Link} Link */
/** @typedef {import('./format.js').OutletRow} OutletRow */
/** @typedef {import('./format.js').PersonRef} PersonRef */
/** @typedef {import('./format.js').PlacedTerm} PlacedTerm */
/** @typedef {import('./format.js').Term} Term */
/** @typedef {import('./format.js').Testimony} Testimony */

// Elements this page owns by id. The markup in design-5.html guarantees each one exists, and
// the values read off them (select.value, button.disabled) are per-element, so this is typed
// loosely on purpose rather than casting at all ~100 call sites.
/** @type {(id: string) => any} */
const $ = (id) => document.getElementById(id)

// Every element matching a selector, typed as HTMLElement so `dataset` and `classList` are
// visible to `tsc`; the atlas only ever selects its own markup.
/** @type {(selector: string, root?: any) => NodeListOf<HTMLElement>} */
const queryAll = (selector, root = document) => root.querySelectorAll(selector)


// The browser canvas adapter that satisfies layout.js's injected `measure` parameter: the
// only place in this codebase that touches a <canvas> for text metrics, so layout.js itself
// stays DOM-free and testable with a fake measure function.
/** @returns {import('./format.js').Measure} */
export const createCanvasMeasure = () => {
  const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'))
  return (text, size, family = FONT_SANS, weight = 500) => {
    ctx.font = `${weight} ${size}px ${family}`
    const m = ctx.measureText(text)
    return Math.max(m.width, Math.abs(m.actualBoundingBoxLeft || 0) + Math.abs(m.actualBoundingBoxRight || 0))
  }
}

// `personScore` is the person's own testimony mean in this recorte; with it, the word carries
// a `--mask` colour (its texts' mean against the person's) that atlas.css only uses while the
// map is masked, so flipping the mask is a class toggle and never a redraw.
/** @param {PlacedTerm} p @param {string} sort @param {number | null} [personScore] */
export const wordMarkup = (p, sort, personScore = null) => {
  const mask = termMask(p, personScore)
  const t = p.testimony
  const testimonyNote = t ? ` · avaliação ${signed(t.score)} em ${fmt(t.n)} textos` : ''
  return `<g class="word-button" transform="translate(${p.x},${p.y})" data-node="${esc(p.id)}" role="button" tabindex="0" aria-pressed="false" aria-label="${esc(label(p))}, ${fmt(p.count)} documentos; ${scoreName(sort)}: ${fmt(p.score)}"><title>${esc(label(p))} · ${esc(kinds[p.kind] || p.kind || 'Tipo desconhecido')} · ${fmt(p.count)} documentos · ${scoreName(sort)}: ${fmt(p.score)}${testimonyNote}</title><rect class="word-hit" x="${-p.w / 2}" y="${-p.h / 2}" width="${p.w}" height="${p.h}" rx="5"/><text class="word" text-anchor="middle" dominant-baseline="central" style="--size:${p.size}px${mask ? `;--mask:${mask}` : ''}">${p.lines.map((line, i) => `<tspan x="0" y="${(i - (p.lines.length - 1) / 2) * p.lineHeight}">${esc(line)}</tspan>`).join('')}</text><line class="underline" x1="${-Math.min(p.w * 0.35, 40)}" x2="${Math.min(p.w * 0.35, 40)}" y1="${p.h / 2 - 2}" y2="${p.h / 2 - 2}"/></g>`
}

// The legend entry for the mask, hidden until the mask is on (paintSelection flips it).
/** @param {import('./format.js').PersonTestimony | undefined} person */
export const maskLegend = (person) =>
  person && person.score !== null
    ? `<span id="maskLegend" hidden><span class="mask-scale" aria-hidden="true"></span>Cor = avaliação dos textos com a palavra contra a média da pessoa (${signed(person.score)}): vermelho mais hostil, verde mais favorável, cinza igual ou com menos de ${MASK_MIN} textos avaliados</span>`
    : `<span id="maskLegend" hidden>Sem avaliação neste recorte para colorir as palavras.</span>`

// Draws the SVG map plus the overflow list and legend; wires each word's click/keydown to
// `onChoose`. Does not resize, scroll or paint the selection state — the caller sequences
// those right after, same order as before the split.
/** @param {{ layout: Layout, personName: string, about: number | undefined, mode: string, sort: string, onChoose: (id: string) => void, personTestimony?: import('./format.js').PersonTestimony }} args */
export const drawMap = ({ layout, personName, about, mode, sort, onChoose, personTestimony }) => {
  const { placed, overflow, center: c } = layout
  const textY = -((c.lines.length - 1) * c.lineHeight) / 2
  $('viewport').innerHTML =
    `<div class="map-stage"><svg class="map-svg" viewBox="-430 -402 860 804" aria-label="Mapa de palavras associadas a ${esc(personName)}"><defs><radialGradient id="halo"><stop class="halo-in" offset="0"/><stop class="halo-out" offset="1"/></radialGradient></defs><circle r="350" fill="url(#halo)"/><circle class="boundary" r="360"/><path d="M-7,-360 H7 M-7,360 H7 M-360,-7 V7 M360,-7 V7" stroke="var(--accent)" stroke-width="2" opacity=".7"/><g id="edges"></g>` +
    `<g class="center-label" aria-label="Pessoa central: ${esc(personName)}"><text class="micro" text-anchor="middle" y="${-c.h / 2 + 23}">NO CENTRO DA CONVERSA</text><text class="person-name" style="--size:${c.size}px" text-anchor="middle" dominant-baseline="central">${c.lines.map((line, i) => `<tspan x="0" y="${textY + i * c.lineHeight}">${esc(line)}</tspan>`).join('')}</text><path d="M-18,${c.h / 2 - 35} H18" stroke="var(--accent)" opacity=".65"/><text class="center-note" text-anchor="middle" y="${c.h / 2 - 10}">${fmt(about)} documentos</text></g>` +
    `<g id="words">${placed.map((p) => wordMarkup(p, sort, personTestimony?.score ?? null)).join('')}</g><text class="micro" x="0" y="392" text-anchor="middle">UM RECORTE DA CONVERSA · NÃO UM JUÍZO DE VALOR</text></svg></div>`
  $('overflow').hidden = mode !== 'map' || !overflow.length
  $('overflow').innerHTML = overflow.length
    ? `<p>${overflow.length} ${overflow.length === 1 ? 'termo não coube' : 'termos não couberam'} sem reduzir a legibilidade. Todos continuam selecionáveis aqui:</p>${overflow.map((n) => `<button class="quiet-button" data-node="${esc(n.id)}">${esc(label(n))}</button>`).join('')}`
    : ''
  for (const el of queryAll('#viewport [data-node], #overflow [data-node]')) {
    el.addEventListener('click', () => onChoose(String(el.dataset.node)))
    if (el.tagName.toLowerCase() === 'g')
      el.addEventListener('keydown', (event) => {
        const e = /** @type {KeyboardEvent} */ (event)
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onChoose(String(el.dataset.node))
        }
      })
  }
  $('legend').innerHTML =
    `<span><span class="type-scale"><span>Aa</span><span>Aa</span></span>Tamanho = ${sort === 'pmi' ? 'PMI × ln(1 + documentos)' : 'frequência em documentos'}</span>` +
    `<span><i></i>Linha = documentos em comum; só aparece ao selecionar</span><span>Tab + Enter para selecionar · zoom e rolagem para ampliar</span><span id="routeNote"></span>` +
    maskLegend(personTestimony)
}

// Repaints selection classes on every word/column, the search note, the edge routes for the
// selected term, and (by calling paintColumns at the end) the columns view — mirrors the
// original single paintSelection, split only across two exported functions.
/** @param {{ nodes: Term[], links: Link[], selected: string | null, search: string, layout: Layout | null, mode: string, sort: string, onChoose: (id: string) => void, mask?: boolean, personTestimony?: import('./format.js').PersonTestimony }} args */
export const paintSelection = ({ nodes, links, selected, search, layout, mode, sort, onChoose, mask = false, personTestimony }) => {
  const related = new Set(selected ? relatedTo(nodes, links, selected).map((r) => r.node.id) : [])
  const normalizedSearch = normalize(search)
  // The mask is a class on the two surfaces that draw words; the colours are already there.
  // With no person mean in the recorte there is nothing to compare against, so the class
  // stays off and the words keep their ink instead of all going grey.
  const masked = mask && personTestimony?.score !== null && personTestimony?.score !== undefined
  $('viewport').querySelector('svg')?.classList.toggle('is-masked', masked)
  $('columns').classList.toggle('is-masked', masked)
  if ($('maskLegend')) $('maskLegend').hidden = !mask
  for (const el of queryAll('[data-node]')) {
    const n = nodes.find((n) => n.id === el.dataset.node)
    if (!n) continue
    const isSelected = n.id === selected
    const isMatch = !!normalizedSearch && matching(n, search)
    el.classList.toggle('is-selected', isSelected)
    el.classList.toggle('is-neighbor', !normalizedSearch && !!selected && related.has(n.id))
    el.classList.toggle('is-dim', normalizedSearch ? !isMatch : !!selected && !isSelected && !related.has(n.id))
    el.classList.toggle('is-match', isMatch)
    el.setAttribute('aria-pressed', String(isSelected))
  }
  const matches = nodes.filter((n) => matching(n, search)).length
  $('searchNote').textContent = normalizedSearch ? `${matches} ${matches === 1 ? 'termo encontrado' : 'termos encontrados'} no recorte. A busca não muda as posições.` : ''
  const edges = $('edges')
  if (edges) {
    edges.innerHTML = ''
    if ($('routeNote')) $('routeNote').textContent = ''
    if (selected && layout) {
      const routes = routesFrom(layout, selected)
      const maxCount = Math.max(1, ...links.map((l) => l.count))
      edges.innerHTML = links
        .filter((l) => l.source === selected || l.target === selected)
        .map((l) => {
          const path = routes.get(l.source === selected ? l.target : l.source)
          return path ? `<path class="edge" d="${path}" stroke-linejoin="round" stroke-width="${0.8 + (1.8 * l.count) / maxCount}"/>` : ''
        })
        .join('')
      if ($('routeNote') && edges.childElementCount < related.size)
        $('routeNote').textContent = `${edges.childElementCount} de ${related.size} relações no mapa; lista completa no painel.`
    }
  }
  paintColumns({ nodes, links, selected, search, sort, mode, onChoose, personTestimony })
}

/** @param {{ nodes: Term[], links: Link[], selected: string | null, search: string, sort: string, mode: string, onChoose: (id: string) => void, personTestimony?: import('./format.js').PersonTestimony }} args */
export const paintColumns = ({ nodes, links, selected, search, sort, mode, onChoose, personTestimony }) => {
  if (mode !== 'columns' || !nodes.length) return
  const related = new Set(selected ? relatedTo(nodes, links, selected).map((r) => r.node.id) : [])
  const normalizedSearch = normalize(search)
  $('columns').innerHTML = nodes
    .map((n, i) => {
      const dim = normalizedSearch ? !matching(n, search) : selected && n.id !== selected && !related.has(n.id)
      const mask = termMask(n, personTestimony?.score ?? null)
      const t = n.testimony
      return `<button class="column-card ${selected === n.id ? 'is-selected' : ''} ${dim ? 'is-dim' : ''}" data-col="${esc(n.id)}"${mask ? ` style="--mask:${mask}"` : ''}><span>${String(i + 1).padStart(2, '0')} · ${esc(kinds[n.kind] || n.kind || 'Tipo desconhecido')} · ${fmt(n.count)} docs · ${scoreName(sort)}: ${fmt(score(n, sort))}${t ? ` · avaliação ${signed(t.score)}` : ''}</span><strong>${esc(label(n))}</strong></button>`
    })
    .join('')
  queryAll('[data-col]', $('columns')).forEach((el) => el.addEventListener('click', () => onChoose(String(el.dataset.col))))
}

// The selected term's testimony next to the person's, spelled out, whether or not the mask is
// on: the colour is a summary of exactly these two numbers.
/** @param {Term} n @param {import('./format.js').PersonTestimony | undefined} person */
export const testimonyLine = (n, person) => {
  const t = n.testimony
  if (!t || !person || person.score === null) return ''
  const delta = t.score - person.score
  const reading = t.n < MASK_MIN ? 'poucos textos para comparar' : delta <= -0.5 ? 'mais hostis que a média da pessoa' : delta >= 0.5 ? 'mais favoráveis que a média da pessoa' : 'na média da pessoa'
  return `<p>Textos com este termo: <strong class="score-highlight">${signed(t.score)}</strong> de avaliação em ${fmt(t.n)} ${t.n === 1 ? 'texto' : 'textos'}, contra ${signed(person.score)} da pessoa no recorte. ${reading}.</p>`
}

/** @param {{ node: Term, count?: number }[]} items @param {string} sort @param {boolean} [counts] */
const relatedButtons = (items, sort, counts = true) =>
  items.map(({ node: n, count }) => `<button data-related="${esc(n.id)}"><span>${esc(label(n))}</span><b>${fmt(counts ? count : score(n, sort))}</b></button>`).join('')

// Paints the inspector for the current selection (or the person summary when nothing is
// selected). Documents are never fetched from here: the one button hands the term (or null,
// for the person) to `onShowDocs`, and the caller opens the modal and loads on that click only.
/** @param {{ graph: Graph | null, nodes: Term[], links: Link[], selected: string | null, sort: string, daysLabel: string, onChoose: (id: string) => void, onShowDocs: (n: Term | null) => void }} args */
export const inspect = ({ graph, nodes, links, selected, sort, daysLabel, onChoose, onShowDocs }) => {
  const n = nodes.find((n) => n.id === selected)
  if (!n) {
    $('inspector').innerHTML =
      `<p class="eyebrow">A pessoa no centro</p><h3>${esc(graph?.person?.name || '')}</h3><dl class="metric stat"><div><dt>documentos sobre a pessoa</dt><dd>${fmt(graph?.stats?.about)}</dd></div><div><dt>termos no recorte</dt><dd>${nodes.length}</dd></div></dl><p>Sem seleção, o atlas mostra um campo limpo: nenhuma ligação termo-termo fica visível.</p>` +
      `<p class="eyebrow">Comece por · ${scoreName(sort)}</p><div class="related">${relatedButtons(nodes.slice(0, 5).map((node) => ({ node })), sort, false)}</div><button class="docs-open" id="docsOpen">Ler documentos sobre a pessoa</button>`
  } else {
    const related = relatedTo(nodes, links, n.id)
    $('inspector').innerHTML =
      `<p class="eyebrow">${esc(kinds[n.kind] || n.kind || 'Tipo desconhecido')} em foco</p><h3 tabindex="-1" id="termHeading">${esc(label(n))}</h3><dl class="metric stat"><div><dt>documentos</dt><dd>${fmt(n.count)}</dd></div><div><dt>PMI bruto</dt><dd>${fmt(n.pmi)}</dd></div></dl><p><strong class="score-highlight">${fmt(score(n, sort))}</strong> ${scoreName(sort)} · score usado no tamanho.</p>${testimonyLine(n, graph?.stats?.testimony)}<p>${esc(graph?.person.name ?? '')} · ${daysLabel}.</p>` +
      `<p class="eyebrow">Aparece junto com · docs</p><div class="related">${related.length ? relatedButtons(related, sort) : '<p class="empty-note">Nenhuma relação retornada neste recorte.</p>'}</div><button class="docs-open" id="docsOpen">Ler documentos deste termo</button>`
  }
  $('docsOpen')?.addEventListener('click', () => onShowDocs(n ?? null))
  queryAll('[data-related]', $('inspector')).forEach((el) =>
      el.addEventListener('click', () => {
        onChoose(String(el.dataset.related))
        $('termHeading')?.focus({ preventScroll: true })
      }),
    )
}

// The one outlet list on the page: /sources' document counts merged with /testimony's means
// (see mergeOutlets in format.js). It used to be two lists in the same figure — this one, and
// a second "por veículo" ranking inside paintTestimony — so every outlet was read twice. It
// lays out in as many columns as the figure is wide, which is what turns 80 outlets into a few
// hundred pixels instead of a screen and a half. The two payloads arrive on their own
// schedule; whichever has not landed yet simply contributes nothing.
/** @param {{ rows: OutletRow[], testimony: Testimony | null, domain: string, onPick: (domain: string) => void }} args */
export const paintOutlets = ({ rows, testimony, domain, onPick }) => {
  $('domainLabel').textContent = domainSuffix(domain)
  const merged = mergeOutlets(rows, testimony?.by_domain ?? [])
  $('outletList').innerHTML = merged.length
    ? '<div class="outlet-grid">' +
      merged
        .map(
          (r) =>
            `<button class="outlet ${r.domain === domain ? 'is-active' : ''}" data-domain="${esc(r.domain)}" aria-pressed="${String(r.domain === domain)}" title="${esc(r.sources.map((x) => sourceLabels[x] ?? x).join(', '))}"><span class="d">${esc(r.domain)}</span><span class="n">${fmt(r.docs)}</span><span class="t" style="--tone:${testimonyColor(r.score)}">${r.score === null ? '' : signed(r.score)}</span></button>`,
        )
        .join('') +
      `</div><p class="note">Documentos no recorte e, quando o veículo tem 3 ou mais textos avaliados, a nota de −10 a +10 que o modelo kikori (${esc(testimony?.method ?? '')}) dá a cada texto sobre a pessoa. Compare veículos falando da mesma pessoa; não compare pessoas entre si.</p>`
    : '<p class="note">Nenhum veículo neste recorte.</p>'
  queryAll('[data-domain]', $('outletList')).forEach((el) =>
    el.addEventListener('click', () => {
      const d = el.dataset.domain
      onPick(!d || d === domain ? 'all' : d)
    }),
  )
}

export const paintOutletsError = () => {
  $('outletList').innerHTML = '<p class="note">Não foi possível carregar os veículos.</p>'
}

// The testimony panel: kikori's -10..+10 score for the person in the current recorte, overall,
// per source and per outlet, all from one response so the three blocks can never describe
// different windows. Outlet rows narrow the recorte exactly like the outlet list does, so a
// reader goes from "this outlet is the harshest" to its words in one click. The `3` in the
// empty copy is api.js's narrowToTestimony `min`.
/** @param {{ data: Testimony, domain: string, onPick: (domain: string) => void }} args */
export const paintTestimony = ({ data, domain, onPick }) => {
  const { overall, by_source, by_domain, method } = data
  const score = overall.score
  if (score === null || score === undefined || !overall.n) {
    $('testimonyLabel').textContent = ''
    // The only place on the page a picture is allowed: there is no chart on screen to compete
    // with when this fires, and the outlet list below stays plain text so one empty recorte can
    // never put two birds up at once.
    $('testimonyList').innerHTML =
      `<div class="pet-empty"><img class="pet" src="/pet-caracara.png" alt="" width="106" height="78"><p class="note">Nenhum texto avaliado neste recorte (método ${esc(method)}).<br>Tente um período maior ou outra fonte.</p></div>`
    return
  }
  $('testimonyLabel').textContent = signed(score)
  // Picking an outlet is a reading inside this figure: it moves nothing above it, so this line
  // is where the chosen outlet's own number sits, next to the recorte's.
  const focus = testimonyFocus(by_domain, domain)
  const focusLine =
    domain === 'all'
      ? ''
      : focus
        ? `<p class="focus"><b>${esc(domain)}</b>: <strong style="--tone:${testimonyColor(focus.score)}">${signed(focus.score)}</strong> em ${fmt(focus.n)} ${focus.n === 1 ? 'texto' : 'textos'}. O número acima é o recorte inteiro.</p>`
        : `<p class="focus"><b>${esc(domain)}</b>: menos de 3 textos avaliados, sem média própria. O número acima é o recorte inteiro.</p>`
  // No second scale here: the strip above is already a −10..+10 ruler with every outlet on it,
  // and no outlet ranking either — the merged list in paintOutlets is the only one now. What is
  // left is the recorte's own number, the focused outlet's, and the per-source means as a strip
  // of chips rather than four full-width rows.
  $('testimonyList').innerHTML =
    `<dl class="verdict stat"><div><dt>Média do recorte</dt><dd style="--tone:${testimonyColor(score)}">${signed(score)}</dd></div></dl>` +
    `<p class="verdict-class">${testimonyClass(score)} · média de ${fmt(overall.n)} ${overall.n === 1 ? 'texto avaliado' : 'textos avaliados'}</p>` +
    focusLine +
    `<dl class="source-chips">${by_source
      .map((r) => `<div class="source-chip"><dt>${esc(sourceLabels[r.source] ?? r.source)}</dt><dd><span class="n">${fmt(r.n)}</span><span class="t" style="--tone:${testimonyColor(r.score)}">${r.score === null || r.score === undefined ? '' : signed(r.score)}</span></dd></div>`)
      .join('')}</dl>`
}

export const paintTestimonyLoading = () => {
  $('testimonyLabel').textContent = ''
  $('testimonyList').textContent = 'Carregando…'
  $('strip').hidden = true
}

export const paintTestimonyError = () => {
  $('testimonyList').innerHTML = '<p class="note">Não foi possível carregar a avaliação.</p>'
  $('strip').hidden = true
}

const STRIP_PAD = 28

// Dot radius from the number of scored texts: area grows with n, so 100 texts read as
// noticeably more than 10 without a single outlet swallowing the axis. On a narrow strip the
// dots shrink with it (down to 55%), or a phone would get a stack three times taller than
// the axis is wide.
/** @param {number} n @param {number} [width] */
export const stripRadius = (n, width = 860) => Math.min(1, Math.max(0.55, width / 860)) * Math.min(30, 4 + 2.8 * Math.sqrt(n))

// The strip never grows past this: a person with many outlets on similar scores (Lula: 148
// outlets in under half the axis) stacked a 1262px tower at full size. Past the cap the dots
// shrink together until the swarm fits, so every outlet stays, none overlap, and only the
// absolute size gives -- which is fine, the strip compares outlets of one person, never two
// people. STRIP_MIN_R is where shrinking stops and the height is allowed to grow again.
export const STRIP_MAX_HEIGHT = 320
export const STRIP_MIN_R = 3

// The geometry of the strip at a given pixel width: one circle per outlet on the -10..+10
// axis, stacked by `swarm` where they would overlap. Exported so a test can assert the
// placement without a document. `scale` is the shrink factor the cap forced (1 = none).
/** @param {import('./format.js').TestimonyDomainRow[]} rows @param {number} width */
export const stripLayout = (rows, width) => {
  const inner = Math.max(80, width - 2 * STRIP_PAD)
  /** @param {number} score */
  const x = (score) => STRIP_PAD + (testimonyPosition(score) / 100) * inner
  const folded = foldTestimonyDomains(rows).map((d) => ({ ...d, x: x(d.score), r: stripRadius(d.n, width) }))
  const smallest = folded.reduce((m, d) => Math.min(m, d.r), Infinity)
  const floor = smallest === Infinity ? 1 : Math.min(1, STRIP_MIN_R / smallest)
  let scale = 1
  /** @param {number} k */
  const attempt = (k) => {
    const dots = swarm(folded.map((d) => ({ ...d, r: d.r * k })))
    const reach = dots.reduce((m, d) => Math.max(m, Math.abs(d.y) + d.r), 0)
    return { dots, half: Math.max(44, Math.ceil(reach) + 6) }
  }
  let fit = attempt(scale)
  while (fit.half * 2 > STRIP_MAX_HEIGHT && scale > floor) {
    scale = Math.max(floor, scale * 0.92)
    fit = attempt(scale)
  }
  return { dots: fit.dots, x, half: fit.half, height: fit.half * 2, width, scale }
}

// The strip under the map: the same outlets as the panel's "Por veículo" block, drawn on the
// axis so the distance between two outlets is visible, which a list cannot show. Clicking a
// dot narrows the recorte exactly like the panel and the outlet list do. Text stays in HTML
// (the SVG only holds shapes), so labels never scale down with the axis on a narrow screen.
/** @param {{ data: Testimony, domain: string, onPick: (domain: string) => void, width?: number }} args */
export const paintStrip = ({ data, domain, onPick, width = 860 }) => {
  const strip = $('strip')
  const { dots, x, half, height } = stripLayout(data.by_domain, width)
  const overall = data.overall.score
  if (!dots.length || overall === null || overall === undefined) {
    strip.hidden = true
    strip.innerHTML = ''
    return
  }
  strip.hidden = false
  const tick = (/** @type {number} */ s) => `<line class="strip-tick" x1="${x(s)}" x2="${x(s)}" y1="${half - 5}" y2="${half + 5}"/>`
  strip.innerHTML =
    `<div class="strip-mean-row"><span class="strip-mean" style="--pos:${testimonyPosition(overall)}%">média da pessoa ${signed(overall)}</span></div>` +
    `<svg class="strip-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="Veículos na régua da avaliação, de −10 a +10">` +
    `<line class="strip-axis" x1="${STRIP_PAD}" x2="${width - STRIP_PAD}" y1="${half}" y2="${half}"/>${[-10, -5, 0, 5, 10].map(tick).join('')}` +
    `<line class="strip-overall" x1="${x(overall)}" x2="${x(overall)}" y1="4" y2="${height - 4}"/>` +
    dots
      .map(
        (d) =>
          `<g class="strip-dot ${d.domain === domain ? 'is-active' : ''}" data-strip-domain="${esc(d.domain)}" role="button" tabindex="0" aria-pressed="${String(d.domain === domain)}" aria-label="${esc(d.domain)}, ${signed(d.score)} em ${fmt(d.n)} textos"><title>${esc(d.domain)} · ${esc(d.sources.map((s) => sourceLabels[s] ?? s).join(', '))} · ${signed(d.score)} em ${fmt(d.n)} ${d.n === 1 ? 'texto' : 'textos'}</title><circle cx="${d.x}" cy="${half + d.y}" r="${d.r}" style="--tone:${testimonyColor(d.score)}"/></g>`,
      )
      .join('') +
    '</svg>' +
    '<div class="strip-axis-labels"><span>−10 contra</span><span>0</span><span>+10 a favor</span></div>' +
    `<p class="note">Uma bolinha por veículo com 3 ou mais textos avaliados; o tamanho é quantos textos. Toque numa bolinha para destacá-la aqui${domain === 'all' ? '' : '; toque de novo, ou fora das bolinhas, para soltar'}. O atlas acima não muda.</p>`
  for (const el of queryAll('[data-strip-domain]', strip)) {
    const pick = () => {
      const d = el.dataset.stripDomain
      onPick(!d || d === domain ? 'all' : d)
    }
    el.addEventListener('click', pick)
    el.addEventListener('keydown', (event) => {
      const e = /** @type {KeyboardEvent} */ (event)
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        pick()
      }
    })
  }
}

export const paintDocsLoading = () => {
  const box = $('docs')
  if (box) box.textContent = 'Carregando documentos…'
}

// The modal's own heading: which documents these are. Kicker and title are the two elements
// the markup gives the dialog, so this is the only painter that touches them.
/** @param {{ term: Term | null, personName: string }} args */
export const paintDocsTitle = ({ term, personName }) => {
  if ($('docsKicker')) $('docsKicker').textContent = term ? `Documentos com ${kinds[term.kind] ? kinds[term.kind].toLowerCase() : 'o termo'}` : 'Documentos sobre'
  if ($('docsTitle')) $('docsTitle').textContent = term ? label(term) : personName
}

/** @param {{ docs: Doc[], total: number }} data */
export const paintDocs = (data) => {
  const box = $('docs')
  if (!box) return
  box.innerHTML = data.docs.length
    ? `<p class="docs-summary">Mostrando ${data.docs.length} de ${fmt(data.total)} documentos.</p>` +
      data.docs
        .map((d) => {
          const href = safeDocUrl(d)
          return `<article class="doc"><p class="eyebrow">${esc(d.domain || d.source)}</p><p>${esc(d.text)}</p>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Abrir documento ↗</a>` : ''}</article>`
        })
        .join('')
    : '<p>Nenhum documento encontrado.</p>'
}

/** @param {() => void} onRetry */
export const paintDocsError = (onRetry) => {
  const box = $('docs')
  if (!box) return
  box.innerHTML = '<p>Não foi possível carregar documentos. <button class="quiet-button" id="retryDocs">Tentar novamente</button></p>'
  $('retryDocs').addEventListener('click', onRetry)
}

// The candidate queue: names nobody tracks yet. Each row toggles its own sample documents,
// so the panel stays one click deep and never navigates away from the atlas.
/** @param {{ candidates: Candidate[] }} data */
export const paintCandidates = (data) => {
  const list = data.candidates
  $('candidateLabel').textContent = list.length ? String(list.length) : ''
  if (!list.length) {
    $('candidateList').innerHTML = '<p class="note">Nenhum nome novo com 3 ou mais documentos neste período.</p>'
    return
  }
  $('candidateList').innerHTML =
    list
      .map((c, i) => {
        const t = trendOf(c)
        return `<div class="candidate"><button class="outlet" data-candidate="${i}" aria-expanded="false" aria-controls="candidateSamples${i}" title="Ver documentos de exemplo"><span class="d">${esc(c.name)}</span><span class="n">${fmt(c.count)} docs</span><span class="s">${fmt(c.sources)} ${c.sources === 1 ? 'fonte' : 'fontes'}</span><span class="t ${t.cls}">${esc(t.text)}</span></button><div class="samples" id="candidateSamples${i}" hidden>${c.samples.map((d) => `<article class="doc"><p class="eyebrow">${esc(d.source)} · doc ${esc(d.id)}</p><p>${esc(d.text)}</p></article>`).join('') || '<p class="note">Sem exemplos neste período.</p>'}</div></div>`
      })
      .join('') +
    '<p class="note">Nomes que ainda não estão em seed.json, comparados com o período anterior de mesmo tamanho. Para acompanhar um nome, adicione-o ao arquivo e rode o índice.</p>'
  queryAll('[data-candidate]', $('candidateList')).forEach((el) =>
      el.addEventListener('click', () => {
        const samples = /** @type {HTMLElement} */ (el.nextElementSibling)
        samples.hidden = !samples.hidden
        el.setAttribute('aria-expanded', String(!samples.hidden))
      }),
    )
}

export const paintCandidatesLoading = () => {
  $('candidateList').textContent = 'Carregando…'
}

/** @param {() => void} onRetry */
export const paintCandidatesError = (onRetry) => {
  $('candidateList').innerHTML = '<p class="note">Não foi possível carregar os candidatos. <button class="quiet-button" id="retryCandidates">Tentar novamente</button></p>'
  $('retryCandidates').addEventListener('click', onRetry)
}

// ---------- figure 3: the ruler (compare two people, issue #91) ----------

// A side with no docs at all (`null`) is structurally absent, not merely "weak": presence alone
// decides -1/+1 when only one side has any relationship to the term, regardless of that side's
// own score sign — a present-but-negative-PMI side must still read as "this word is A's," never
// flip toward a B that has literally nothing (spec §3's "found only on one side" case). When
// both sides are present, position comes from each side's clamped-positive pull against the
// *raw* combined magnitude, so a term with a real, opposite-signed relationship on both sides
// settles short of the ends instead of pinning to them the way an unclamped ratio would whenever
// the two raw scores merely differ in sign.
/** @param {CompareSide | 'name' | null} v @returns {v is CompareSide} */
const isPresent = (v) => v !== null && v !== 'name'

/** @param {CompareSide | 'name' | null} v */
const docsOf = (v) => (v && v !== 'name' ? v.count : 0)

// Drops a term that is either side's own name, and scores the rest against `measure`: position
// (`balance`, -1 all A .. 0 divided .. +1 all B) and `combined` (documents on both sides summed,
// never measure-dependent, per spec §3). `hiddenCount` is what #compareHiddenNote reports, so
// the omission is stated rather than silent.
/**
 * @param {CompareTerm[]} terms
 * @param {string} measure
 * @returns {{ items: (CompareTerm & { balance: number, combined: number })[], hiddenCount: number }}
 */
export const rulerTerms = (terms, measure) => {
  let hiddenCount = 0
  /** @type {(CompareTerm & { balance: number, combined: number })[]} */
  const items = []
  for (const t of terms) {
    if (t.a === 'name' || t.b === 'name') {
      hiddenCount++
      continue
    }
    const aPresent = isPresent(t.a)
    const bPresent = isPresent(t.b)
    let balance = 0
    if (aPresent !== bPresent) {
      balance = aPresent ? -1 : 1
    } else if (aPresent && bPresent) {
      const rawA = score(/** @type {CompareSide} */ (t.a), measure)
      const rawB = score(/** @type {CompareSide} */ (t.b), measure)
      const mag = Math.abs(rawA) + Math.abs(rawB)
      balance = mag === 0 ? 0 : Math.max(-1, Math.min(1, (Math.max(0, rawB) - Math.max(0, rawA)) / mag))
    }
    items.push({ ...t, balance, combined: docsOf(t.a) + docsOf(t.b) })
  }
  return { items, hiddenCount }
}

// A word on the ruler: the term itself, not a dot, in the same language figure 1 speaks. The
// transparent rect behind it is the hit area, so a 11px word is still comfortably clickable,
// and `--cmp` carries the side colour the way `--size` carries the type size (the only inline
// style this page allows, per CLAUDE.md).
/**
 * @param {{ term: string, kind: string, text: string, balance: number, combined: number, x: number, y: number, size: number, w: number, h: number }} d
 * @param {number} half
 * @param {boolean} isSelected
 */
const rulerWordMarkup = (d, half, isSelected) =>
  `<g class="ruler-word ${isSelected ? 'is-selected' : ''}" transform="translate(${d.x},${half + d.y})" data-term="${esc(d.term)}" data-kind="${esc(d.kind)}" role="button" tabindex="0" aria-pressed="${String(isSelected)}" aria-label="${esc(d.text)}, ${fmt(d.combined)} documentos"><title>${esc(d.text)} · ${esc(kinds[d.kind] || d.kind || 'Tipo desconhecido')} · ${fmt(d.combined)} documentos</title><rect class="ruler-hit" x="${-d.w / 2}" y="${-d.h / 2}" width="${d.w}" height="${d.h}" rx="4"/><text class="ruler-text" text-anchor="middle" dominant-baseline="central" style="--size:${d.size}px;--cmp:${balanceColor(d.balance)}">${esc(d.text)}</text></g>`

// The words that the strip could not hold without overlapping. Never dropped in silence: the
// count is stated and every one of them is still a button carrying the same data-term/data-kind
// the drawn words carry, so clicking one selects it exactly like clicking it on the ruler.
/**
 * @param {{ term: string, kind: string, text: string, balance: number }[]} overflow
 * @param {{ term: string, kind: string } | null} selected
 */
const rulerOverflowMarkup = (overflow, selected) =>
  overflow.length
    ? `<div class="ruler-overflow"><p>${fmt(overflow.length)} ${overflow.length === 1 ? 'palavra não coube' : 'palavras não couberam'} na régua sem cobrir as outras. Todas continuam clicáveis aqui:</p>` +
      overflow
        .map((d) => {
          const isSelected = !!selected && selected.term === d.term && selected.kind === d.kind
          return `<button class="quiet-button ${isSelected ? 'is-selected' : ''}" data-term="${esc(d.term)}" data-kind="${esc(d.kind)}" aria-pressed="${String(isSelected)}" style="--cmp:${balanceColor(d.balance)}">${esc(d.text)}</button>`
        })
        .join('') +
      '</div>'
    : ''

// The ruler itself: one word per shared or exclusive term between two people, written where it
// leans and set in the type size its combined document count earns. `metrics` is the injected
// text measurer layout.js needs (createCanvasMeasure in the browser, a stub in tests), the same
// contract figures/atlas.js already honours; `measure` next to it is the chosen medida
// (documentos or PMI) and only moves the words sideways. Returns the hidden-name count and how
// many words were drawn versus listed, so the caller can paint its notes without recomputing.
/**
 * @param {{ data: Compare, personA: PersonRef, personB: PersonRef, measure: string, metrics: import('./format.js').Measure, selected: { term: string, kind: string } | null, onPick: (term: string, kind: string) => void, width?: number }} args
 */
export const paintRuler = ({ data, personA, personB, measure, metrics, selected, onPick, width = 860 }) => {
  const ruler = $('compareRuler')
  const { items, hiddenCount } = rulerTerms(data.terms, measure)
  if (!items.length) {
    // Reachable with a non-empty `data.terms` when every term is one of the two people's own
    // name: the caller's own empty branch keys on terms.length and would leave the slot blank
    // with only #compareHiddenNote under it. Same note either way.
    ruler.hidden = false
    ruler.innerHTML = '<p class="note">Nenhuma palavra neste recorte.</p>'
    return { hiddenCount, shown: 0, overflowCount: 0 }
  }
  ruler.hidden = false
  const { words, overflow, x, half, height } = rulerLayout(metrics, items, width)
  const tick = (/** @type {number} */ b) => `<line class="ruler-tick" x1="${x(b)}" x2="${x(b)}" y1="${half - 5}" y2="${half + 5}"/>`
  ruler.innerHTML =
    `<div class="ruler-end-row"><span class="ruler-end cmp-a">${esc(personA.name)}</span><span class="ruler-end cmp-b">${esc(personB.name)}</span></div>` +
    `<svg class="ruler-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="Régua comparando ${esc(personA.name)} e ${esc(personB.name)}">` +
    `<line class="ruler-axis" x1="${RULER_PAD}" x2="${width - RULER_PAD}" y1="${half}" y2="${half}"/>${[-1, -0.5, 0, 0.5, 1].map(tick).join('')}` +
    words.map((d) => rulerWordMarkup(d, half, !!selected && selected.term === d.term && selected.kind === d.kind)).join('') +
    '</svg>' +
    `<div class="ruler-axis-labels"><span>Só de ${esc(personA.name)}</span><span>dividida</span><span>Só de ${esc(personB.name)}</span></div>` +
    `<p class="note">Cada palavra está escrita onde ela pende, e o tamanho dela é quantos documentos tem dos dois lados somados. Toque numa palavra para ver os números dos dois lados. Cada pessoa entra com as palavras mais frequentes e com as mais grudentas, então a régua costuma mostrar mais palavras do que o número escolhido na frase acima: ${fmt(items.length)} ${items.length === 1 ? 'palavra' : 'palavras'} neste recorte.</p>` +
    rulerOverflowMarkup(overflow, selected)
  for (const el of queryAll('[data-term]', ruler)) {
    const pick = () => onPick(String(el.dataset.term), String(el.dataset.kind))
    el.addEventListener('click', pick)
    // A <g> is not focusable-and-activatable on its own, so it needs the key handler; the
    // overflow list's real <button>s already turn Enter and Space into a click, and adding
    // one here would pick twice and cancel itself out.
    if (String(el.tagName || '').toLowerCase() !== 'button')
      el.addEventListener('keydown', (event) => {
        const e = /** @type {KeyboardEvent} */ (event)
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          pick()
        }
      })
  }
  return { hiddenCount, shown: words.length, overflowCount: overflow.length }
}

export const paintRulerError = () => {
  const ruler = $('compareRuler')
  ruler.hidden = false
  ruler.innerHTML = '<p class="note">Não foi possível carregar a comparação.</p>'
}

export const paintCompareLoading = () => {
  $('compareDetail').textContent = 'Carregando…'
}

// The selected word's own numbers on both sides, one line, same two-state wording the deleted
// compare.html's own detailHtml used: a real object reads as documents and PMI, a null side
// reads "nenhum documento" (a measured zero, never "outside the top list").
/** @param {{ term: CompareTerm | null, personA: PersonRef, personB: PersonRef }} args */
export const paintCompareDetail = ({ term, personA, personB }) => {
  const el = $('compareDetail')
  if (!el) return
  if (!term) {
    el.innerHTML = '<span class="empty-hint">Clique numa palavra para ver os números dos dois lados.</span>'
    return
  }
  /** @param {PersonRef} person @param {CompareSide | 'name' | null} v */
  const sideHtml = (person, v) =>
    v && v !== 'name'
      ? `<div><dt>${esc(person.name)}</dt><dd><b>${fmt(v.count)}</b> documentos · PMI <b>${fmt(v.pmi)}</b></dd></div>`
      : `<div><dt>${esc(person.name)}</dt><dd class="empty-hint">nenhum documento</dd></div>`
  el.innerHTML = `<span class="term">${esc(label(term))}</span><dl class="detail-sides">${sideHtml(personA, term.a)}${sideHtml(personB, term.b)}</dl>`
}
