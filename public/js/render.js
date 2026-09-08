// DOM layer: paints the map, the inspector, the outlet list and the docs panel. Every
// function here reads/writes the document directly (that is its job); the data it paints
// and the callbacks it wires (onChoose, onShowDocs, onPick) all come in as parameters, so
// this module never reaches into public/js/state.js on its own.

import { domainSuffix, esc, fmt, kinds, label, matching, normalize, relatedTo, safeDocUrl, score, scoreName, toneColor, trendOf } from './format.js'
import { FONT_SANS, routesFrom } from './layout.js'

/** @typedef {import('./format.js').Candidate} Candidate */
/** @typedef {import('./format.js').Doc} Doc */
/** @typedef {import('./format.js').Graph} Graph */
/** @typedef {import('./format.js').Layout} Layout */
/** @typedef {import('./format.js').Link} Link */
/** @typedef {import('./format.js').OutletRow} OutletRow */
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

/** @param {PlacedTerm} p @param {string} sort */
export const wordMarkup = (p, sort) =>
  `<g class="word-button" transform="translate(${p.x},${p.y})" data-node="${esc(p.id)}" role="button" tabindex="0" aria-pressed="false" aria-label="${esc(label(p))}, ${fmt(p.count)} documentos; ${scoreName(sort)}: ${fmt(p.score)}"><title>${esc(label(p))} · ${esc(kinds[p.kind] || p.kind || 'Tipo desconhecido')} · ${fmt(p.count)} documentos · ${scoreName(sort)}: ${fmt(p.score)}</title><rect class="word-hit" x="${-p.w / 2}" y="${-p.h / 2}" width="${p.w}" height="${p.h}" rx="5"/><text class="word" text-anchor="middle" dominant-baseline="central" style="--size:${p.size}px">${p.lines.map((line, i) => `<tspan x="0" y="${(i - (p.lines.length - 1) / 2) * p.lineHeight}">${esc(line)}</tspan>`).join('')}</text><line class="underline" x1="${-Math.min(p.w * 0.35, 40)}" x2="${Math.min(p.w * 0.35, 40)}" y1="${p.h / 2 - 2}" y2="${p.h / 2 - 2}"/></g>`

// Draws the SVG map plus the overflow list and legend; wires each word's click/keydown to
// `onChoose`. Does not resize, scroll or paint the selection state — the caller sequences
// those right after, same order as before the split.
/** @param {{ layout: Layout, personName: string, about: number | undefined, mode: string, sort: string, onChoose: (id: string) => void }} args */
export const drawMap = ({ layout, personName, about, mode, sort, onChoose }) => {
  const { placed, overflow, center: c } = layout
  const textY = -((c.lines.length - 1) * c.lineHeight) / 2
  $('viewport').innerHTML =
    `<div class="map-stage"><svg class="map-svg" viewBox="-430 -402 860 804" aria-label="Mapa de palavras associadas a ${esc(personName)}"><defs><radialGradient id="halo"><stop offset="0" stop-color="#e2c47c" stop-opacity=".045"/><stop offset="1" stop-color="#e2c47c" stop-opacity="0"/></radialGradient></defs><circle r="350" fill="url(#halo)"/><circle class="boundary" r="360"/><path d="M-7,-360 H7 M-7,360 H7 M-360,-7 V7 M360,-7 V7" stroke="var(--accent)" stroke-width="2" opacity=".7"/><g id="edges"></g>` +
    `<g class="center-label" aria-label="Pessoa central: ${esc(personName)}"><text class="micro" text-anchor="middle" y="${-c.h / 2 + 23}">NO CENTRO DA CONVERSA</text><text class="person-name" style="--size:${c.size}px" text-anchor="middle" dominant-baseline="central">${c.lines.map((line, i) => `<tspan x="0" y="${textY + i * c.lineHeight}">${esc(line)}</tspan>`).join('')}</text><path d="M-18,${c.h / 2 - 35} H18" stroke="var(--accent)" opacity=".65"/><text class="center-note" text-anchor="middle" y="${c.h / 2 - 10}">${fmt(about)} documentos</text></g>` +
    `<g id="words">${placed.map((p) => wordMarkup(p, sort)).join('')}</g><text class="micro" x="0" y="392" text-anchor="middle">UM RECORTE DA CONVERSA · NÃO UM JUÍZO DE VALOR</text></svg></div>`
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
    `<span><i></i>Linha = documentos em comum; só aparece ao selecionar</span><span>Tab + Enter para selecionar · zoom e rolagem para ampliar</span><span id="routeNote"></span>`
}

// Repaints selection classes on every word/column, the search note, the edge routes for the
// selected term, and (by calling paintColumns at the end) the columns view — mirrors the
// original single paintSelection, split only across two exported functions.
/** @param {{ nodes: Term[], links: Link[], selected: string | null, search: string, layout: Layout | null, mode: string, sort: string, onChoose: (id: string) => void }} args */
export const paintSelection = ({ nodes, links, selected, search, layout, mode, sort, onChoose }) => {
  const related = new Set(selected ? relatedTo(nodes, links, selected).map((r) => r.node.id) : [])
  const normalizedSearch = normalize(search)
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
  paintColumns({ nodes, links, selected, search, sort, mode, onChoose })
}

/** @param {{ nodes: Term[], links: Link[], selected: string | null, search: string, sort: string, mode: string, onChoose: (id: string) => void }} args */
export const paintColumns = ({ nodes, links, selected, search, sort, mode, onChoose }) => {
  if (mode !== 'columns' || !nodes.length) return
  const related = new Set(selected ? relatedTo(nodes, links, selected).map((r) => r.node.id) : [])
  const normalizedSearch = normalize(search)
  $('columns').innerHTML = nodes
    .map((n, i) => {
      const dim = normalizedSearch ? !matching(n, search) : selected && n.id !== selected && !related.has(n.id)
      return `<button class="column-card ${selected === n.id ? 'is-selected' : ''} ${dim ? 'is-dim' : ''}" data-col="${esc(n.id)}"><span>${String(i + 1).padStart(2, '0')} · ${esc(kinds[n.kind] || n.kind || 'Tipo desconhecido')} · ${fmt(n.count)} docs · ${scoreName(sort)}: ${fmt(score(n, sort))}</span><strong>${esc(label(n))}</strong></button>`
    })
    .join('')
  queryAll('[data-col]', $('columns')).forEach((el) => el.addEventListener('click', () => onChoose(String(el.dataset.col))))
}

/** @param {{ node: Term, count?: number }[]} items @param {string} sort @param {boolean} [counts] */
const relatedButtons = (items, sort, counts = true) =>
  items.map(({ node: n, count }) => `<button data-related="${esc(n.id)}"><span>${esc(label(n))}</span><b>${fmt(counts ? count : score(n, sort))}</b></button>`).join('')

// Paints the inspector for the current selection (or the person summary when nothing is
// selected) and triggers the docs panel via `onShowDocs`, matching the original's own call
// to loadDocs from inside inspect().
/** @param {{ graph: Graph | null, nodes: Term[], links: Link[], selected: string | null, sort: string, daysLabel: string, onChoose: (id: string) => void, onShowDocs: (n: Term | null) => void }} args */
export const inspect = ({ graph, nodes, links, selected, sort, daysLabel, onChoose, onShowDocs }) => {
  const n = nodes.find((n) => n.id === selected)
  if (!n) {
    $('inspector').innerHTML =
      `<div class="eyebrow">A pessoa no centro</div><h3>${esc(graph?.person?.name || '')}</h3><div class="metric"><div><strong>${fmt(graph?.stats?.about)}</strong><span>documentos sobre a pessoa</span></div><div><strong>${nodes.length}</strong><span>termos no recorte</span></div></div><p>Sem seleção, o atlas mostra um campo limpo: nenhuma ligação termo-termo fica visível.</p>` +
      `<div class="eyebrow">Comece por · ${scoreName(sort)}</div><div class="related">${relatedButtons(nodes.slice(0, 5).map((node) => ({ node })), sort, false)}</div><div id="docs" aria-live="polite"></div>`
    onShowDocs(null)
  } else {
    const related = relatedTo(nodes, links, n.id)
    $('inspector').innerHTML =
      `<div class="eyebrow">${esc(kinds[n.kind] || n.kind || 'Tipo desconhecido')} em foco</div><h3 tabindex="-1" id="termHeading">${esc(label(n))}</h3><div class="metric"><div><strong>${fmt(n.count)}</strong><span>documentos</span></div><div><strong>${fmt(n.pmi)}</strong><span>PMI bruto</span></div></div><p><strong class="score-highlight">${fmt(score(n, sort))}</strong> ${scoreName(sort)} · score usado no tamanho.</p><p>${esc(graph?.person.name ?? '')} · ${daysLabel}.</p>` +
      `<div class="eyebrow">Aparece junto com · docs</div><div class="related">${related.length ? relatedButtons(related, sort) : '<p class="empty-note">Nenhuma relação retornada neste recorte.</p>'}</div><details class="docs-toggle" id="termDocs"><summary>Ler documentos deste termo</summary><div id="docs" aria-live="polite"></div></details>`
    // The documents live inside the <details>, so opening them grows the panel in place
    // instead of pushing the rest of the inspector down. The fetch is deferred to the first
    // open, and `loaded` keeps a close/open cycle from refetching what is already painted.
    const termDocs = $('termDocs')
    termDocs?.addEventListener('toggle', () => {
      const summary = termDocs.querySelector('summary')
      if (summary) summary.textContent = termDocs.open ? 'Ocultar documentos' : 'Ler documentos deste termo'
      if (termDocs.open && !termDocs.dataset.loaded) {
        termDocs.dataset.loaded = '1'
        onShowDocs(n)
      }
    })
  }
  queryAll('[data-related]', $('inspector')).forEach((el) =>
      el.addEventListener('click', () => {
        onChoose(String(el.dataset.related))
        $('termHeading')?.focus({ preventScroll: true })
      }),
    )
}

/** @param {{ rows: OutletRow[], domain: string, onPick: (domain: string) => void }} args */
export const paintOutlets = ({ rows, domain, onPick }) => {
  $('domainLabel').textContent = domainSuffix(domain)
  const all = [{ domain: 'all', label: 'todas', docs: rows.reduce((a, r) => a + r.docs, 0), tone: null }, ...rows]
  $('outletList').innerHTML =
    all
      .map(
        (r) =>
          `<button class="outlet ${r.domain === domain ? 'is-active' : ''}" data-domain="${esc(r.domain ?? '')}" title="${esc(r.source ?? '')}" aria-pressed="${String(r.domain === domain)}"><span class="d">${esc(r.label ?? r.domain ?? r.source ?? 'desconhecido')}</span><span class="n">${fmt(r.docs)}</span><span class="t" style="--tone:${toneColor(r.tone)}">${r.tone === null || r.tone === undefined ? '' : fmt(r.tone)}</span></button>`,
      )
      .join('') + '<p class="note">Um veículo restringe o recorte inteiro. O tom só existe em fontes GDELT.</p>'
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

export const paintDocsLoading = () => {
  const box = $('docs')
  if (box) box.textContent = 'Carregando documentos…'
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
