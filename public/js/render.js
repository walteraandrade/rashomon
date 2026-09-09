// DOM layer: paints the map, the inspector, the outlet list and the docs panel. Every
// function here reads/writes the document directly (that is its job); the data it paints
// and the callbacks it wires (onChoose, onShowDocs, onPick) all come in as parameters, so
// this module never reaches into public/js/state.js on its own.

import { esc, fmt, kinds, label, matching, normalize, relatedTo, safeDocUrl, score, scoreName, MASK_MIN, signed, termMask, trendOf } from './format.js'
import { FONT_SANS, routesFrom } from './layout.js'

/** @typedef {import('./format.js').Candidate} Candidate */
/** @typedef {import('./format.js').Doc} Doc */
/** @typedef {import('./format.js').Graph} Graph */
/** @typedef {import('./format.js').Layout} Layout */
/** @typedef {import('./format.js').Link} Link */
/** @typedef {import('./format.js').PlacedTerm} PlacedTerm */
/** @typedef {import('./format.js').Term} Term */

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
      `<div class="eyebrow">A pessoa no centro</div><h3>${esc(graph?.person?.name || '')}</h3><div class="metric"><div><strong>${fmt(graph?.stats?.about)}</strong><span>documentos sobre a pessoa</span></div><div><strong>${nodes.length}</strong><span>termos no recorte</span></div></div><p>Sem seleção, o atlas mostra um campo limpo: nenhuma ligação termo-termo fica visível.</p>` +
      `<div class="eyebrow">Comece por · ${scoreName(sort)}</div><div class="related">${relatedButtons(nodes.slice(0, 5).map((node) => ({ node })), sort, false)}</div><button class="docs-open" id="docsOpen">Ler documentos sobre a pessoa</button>`
  } else {
    const related = relatedTo(nodes, links, n.id)
    $('inspector').innerHTML =
      `<div class="eyebrow">${esc(kinds[n.kind] || n.kind || 'Tipo desconhecido')} em foco</div><h3 tabindex="-1" id="termHeading">${esc(label(n))}</h3><div class="metric"><div><strong>${fmt(n.count)}</strong><span>documentos</span></div><div><strong>${fmt(n.pmi)}</strong><span>PMI bruto</span></div></div><p><strong class="score-highlight">${fmt(score(n, sort))}</strong> ${scoreName(sort)} · score usado no tamanho.</p>${testimonyLine(n, graph?.stats?.testimony)}<p>${esc(graph?.person.name ?? '')} · ${daysLabel}.</p>` +
      `<div class="eyebrow">Aparece junto com · docs</div><div class="related">${related.length ? relatedButtons(related, sort) : '<p class="empty-note">Nenhuma relação retornada neste recorte.</p>'}</div><button class="docs-open" id="docsOpen">Ler documentos deste termo</button>`
  }
  $('docsOpen')?.addEventListener('click', () => onShowDocs(n ?? null))
  queryAll('[data-related]', $('inspector')).forEach((el) =>
      el.addEventListener('click', () => {
        onChoose(String(el.dataset.related))
        $('termHeading')?.focus({ preventScroll: true })
      }),
    )
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
          return `<article class="doc"><div class="eyebrow">${esc(d.domain || d.source)}</div><p>${esc(d.text)}</p>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Abrir documento ↗</a>` : ''}</article>`
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
        return `<div class="candidate"><button class="outlet" data-candidate="${i}" aria-expanded="false" aria-controls="candidateSamples${i}" title="Ver documentos de exemplo"><span class="d">${esc(c.name)}</span><span class="n">${fmt(c.count)} docs</span><span class="s">${fmt(c.sources)} ${c.sources === 1 ? 'fonte' : 'fontes'}</span><span class="t ${t.cls}">${esc(t.text)}</span></button><div class="samples" id="candidateSamples${i}" hidden>${c.samples.map((d) => `<article class="doc"><div class="eyebrow">${esc(d.source)} · doc ${esc(d.id)}</div><p>${esc(d.text)}</p></article>`).join('') || '<p class="note">Sem exemplos neste período.</p>'}</div></div>`
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
