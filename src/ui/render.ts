// DOM layer: painters only — all data and callbacks arrive as parameters.

import {
  balanceColor,
  domainSuffix,
  fmt,
  html,
  kinds,
  label,
  matching,
  mergeOutlets,
  normalize,
  relatedTo,
  safeDocUrl,
  score,
  scoreName,
  foldTestimonyDomains,
  MASK_MIN,
  signed,
  sourceLabels,
  termMask,
  testimonyClass,
  testimonyColor,
  testimonyFocus,
  testimonyPosition,
  trendOf,
  type Candidate,
  type Compare,
  type CompareSide,
  type CompareTerm,
  type Doc,
  type Graph,
  type Layout,
  type Link,
  type Measure,
  type OutletRow,
  type PersonRef,
  type PersonTestimony,
  type PlacedTerm,
  type Term,
  type Testimony,
  type TestimonyDomainRow,
} from './format.js'
import { FONT_SANS, RULER_PAD, rulerLayout, routesFrom, swarm } from './layout.js'

// Typed loosely on purpose: `dataset` and `classList` are visible without casting ~100 sites.
const $ = (id: string): any => document.getElementById(id)
const queryAll = (selector: string, root: any = document): NodeListOf<HTMLElement> => root.querySelectorAll(selector)

// The only place that touches a <canvas>; layout.ts stays DOM-free and testable without it.
export const createCanvasMeasure = (): Measure => {
  const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
  return (text, size, family = FONT_SANS, weight = 500) => {
    ctx.font = `${weight} ${size}px ${family}`
    const m = ctx.measureText(text)
    return Math.max(m.width, Math.abs(m.actualBoundingBoxLeft || 0) + Math.abs(m.actualBoundingBoxRight || 0))
  }
}

// `--mask` is set when personScore is provided; atlas.css only reads it when the mask is on.
export const wordMarkup = (p: PlacedTerm, sort: string, personScore: number | null = null) => {
  const mask = termMask(p, personScore)
  const t = p.testimony
  const testimonyNote = t ? ` · avaliação ${signed(t.score)} em ${fmt(t.n)} textos` : ''
  return html`<g class="word-button" transform="translate(${p.x},${p.y})" style="--size:${p.size}px${mask ? `;--mask:${mask}` : ''}" data-node="${p.id}" role="button" tabindex="0" aria-pressed="false" aria-label="${label(p)}, ${fmt(p.count)} documentos; ${scoreName(sort)}: ${fmt(p.score)}"><title>${label(p)} · ${kinds[p.kind] || p.kind || 'Tipo desconhecido'} · ${fmt(p.count)} documentos · ${scoreName(sort)}: ${fmt(p.score)}${testimonyNote}</title><rect class="word-glow" x="${-p.w / 2 - 4}" y="${-p.h / 2 - 3}" width="${p.w + 8}" height="${p.h + 6}" rx="9"/><rect class="word-hit" x="${-p.w / 2}" y="${-p.h / 2}" width="${p.w}" height="${p.h}" rx="6"/><text class="word" text-anchor="middle" dominant-baseline="central">${p.lines.map((line, i) => html`<tspan x="0" y="${(i - (p.lines.length - 1) / 2) * p.lineHeight}">${line}</tspan>`)}</text><line class="underline" x1="${-Math.min(p.w * 0.35, 40)}" x2="${Math.min(p.w * 0.35, 40)}" y1="${p.h / 2 - 2}" y2="${p.h / 2 - 2}"/></g>`
}

// The legend entry for the mask, hidden until the mask is on (paintSelection flips it).
const maskLegend = (person: PersonTestimony | undefined) =>
  person && person.score !== null
    ? html`<span id="maskLegend" hidden><span class="mask-scale" aria-hidden="true"></span>Cor = avaliação dos textos com a palavra contra a média da pessoa (${signed(person.score)}): vermelho mais hostil, verde mais favorável, cinza igual ou com menos de ${MASK_MIN} textos avaliados</span>`
    : html`<span id="maskLegend" hidden>Sem avaliação neste recorte para colorir as palavras.</span>`

// Plain elements need explicit keyboard handling that <button> would have provided automatically.
const wirePersonDocs = (el: Element, onShowPerson: () => void) => {
  el.addEventListener('click', () => onShowPerson())
  el.addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onShowPerson()
  })
}

// Draws the SVG map, overflow list and legend; wires click/keydown. Does not resize or paint
// selection state — the caller sequences those immediately after.
export const drawMap = ({
  layout,
  personName,
  about,
  mode,
  sort,
  onChoose,
  onShowPerson = () => {},
  personTestimony,
}: {
  layout: Layout
  personName: string
  about: number | undefined
  mode: string
  sort: string
  onChoose: (id: string) => void
  onShowPerson?: () => void
  personTestimony?: PersonTestimony
}) => {
  const { placed, overflow, center: c } = layout
  const textY = -((c.lines.length - 1) * c.lineHeight) / 2
  $('viewport').innerHTML = html`<div class="map-stage"><svg class="map-svg" viewBox="-430 -402 860 804" aria-label="Mapa de palavras associadas a ${personName}"><defs><radialGradient id="halo"><stop class="halo-in" offset="0"/><stop class="halo-out" offset="1"/></radialGradient></defs><circle r="350" fill="url(#halo)"/><circle class="boundary" r="360"/><path d="M-7,-360 H7 M-7,360 H7 M-360,-7 V7 M360,-7 V7" stroke="var(--accent)" stroke-width="2" opacity=".7"/><g id="edges"></g><g class="center-label" data-person-docs role="button" tabindex="0" aria-label="Ler os ${fmt(about)} documentos sobre ${personName}"><rect class="center-hit" x="${-c.w / 2}" y="${-c.h / 2}" width="${c.w}" height="${c.h}" rx="10"/><text class="micro" text-anchor="middle" y="${-c.h / 2 + 23}">NO CENTRO DA CONVERSA</text><text class="person-name" style="--size:${c.size}px" text-anchor="middle" dominant-baseline="central">${c.lines.map((line, i) => html`<tspan x="0" y="${textY + i * c.lineHeight}">${line}</tspan>`)}</text><path d="M-18,${c.h / 2 - 35} H18" stroke="var(--accent)" opacity=".65"/><text class="center-note" text-anchor="middle" y="${c.h / 2 - 10}">${fmt(about)} documentos</text></g><g id="words">${placed.map((p) => wordMarkup(p, sort, personTestimony?.score ?? null))}</g><text class="micro" x="0" y="392" text-anchor="middle">UM RECORTE DA CONVERSA · NÃO UM JUÍZO DE VALOR</text></svg></div>`
  $('overflow').hidden = mode !== 'map' || !overflow.length
  $('overflow').innerHTML = overflow.length
    ? html`<p>${overflow.length} ${overflow.length === 1 ? 'termo não coube' : 'termos não couberam'} sem reduzir a legibilidade. Todos continuam selecionáveis aqui:</p>${overflow.map((n) => html`<button class="quiet-button" data-node="${n.id}">${label(n)}</button>`)}`
    : ''
  for (const el of queryAll('#viewport [data-person-docs]')) wirePersonDocs(el, onShowPerson)
  for (const el of queryAll('#viewport [data-node], #overflow [data-node]')) {
    el.addEventListener('click', () => onChoose(String(el.dataset.node)))
    if (el.tagName.toLowerCase() === 'g')
      el.addEventListener('keydown', (event) => {
        const e = event as KeyboardEvent
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onChoose(String(el.dataset.node))
        }
      })
  }
  $('legend').innerHTML = html`<span><span class="type-scale"><span>Aa</span><span>Aa</span></span>Tamanho = ${sort === 'pmi' ? 'PMI × ln(1 + documentos)' : 'frequência em documentos'}</span><span><i></i>Linha = documentos em comum; só aparece ao selecionar</span><span>Tab + Enter para selecionar · zoom e rolagem para ampliar</span><span id="routeNote"></span>${maskLegend(personTestimony)}`
}

// Repaints selection classes, search note, edge routes and the columns view.
export const paintSelection = ({
  nodes,
  links,
  selected,
  search,
  layout,
  mode,
  sort,
  onChoose,
  onShowPerson,
  personName,
  about,
  mask = false,
  personTestimony,
}: {
  nodes: Term[]
  links: Link[]
  selected: string | null
  search: string
  layout: Layout | null
  mode: string
  sort: string
  onChoose: (id: string) => void
  onShowPerson?: () => void
  personName?: string
  about?: number
  mask?: boolean
  personTestimony?: PersonTestimony
}) => {
  const related = new Set(selected ? relatedTo(nodes, links, selected).map((r) => r.node.id) : [])
  const normalizedSearch = normalize(search)
  // The mask is a class on the surfaces; without a person mean there is nothing to compare.
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
      edges.innerHTML = html`${links
        .filter((l) => l.source === selected || l.target === selected)
        .map((l) => {
          const path = routes.get(l.source === selected ? l.target : l.source)
          return path ? html`<path class="edge" d="${path}" stroke-linejoin="round" stroke-width="${0.8 + (1.8 * l.count) / maxCount}"/>` : ''
        })}`
      if ($('routeNote') && edges.childElementCount < related.size)
        $('routeNote').textContent = `${edges.childElementCount} de ${related.size} relações no mapa; lista completa no painel.`
    }
  }
  // The list is repainted whole, so the person's own row must travel with it.
  paintColumns({ nodes, links, selected, search, sort, mode, onChoose, onShowPerson, personName, about, personTestimony })
}

export const paintColumns = ({
  nodes,
  links,
  selected,
  search,
  sort,
  mode,
  onChoose,
  onShowPerson = () => {},
  personName = '',
  about,
  personTestimony,
}: {
  nodes: Term[]
  links: Link[]
  selected: string | null
  search: string
  sort: string
  mode: string
  onChoose: (id: string) => void
  onShowPerson?: () => void
  personName?: string
  about?: number
  personTestimony?: PersonTestimony
}) => {
  if (mode !== 'columns' || !nodes.length) return
  const related = new Set(selected ? relatedTo(nodes, links, selected).map((r) => r.node.id) : [])
  const normalizedSearch = normalize(search)
  const personRow = html`<div class="column-person" data-person-docs role="button" tabindex="0" aria-label="Ler os ${fmt(about)} documentos sobre ${personName}"><span>No centro da conversa · ${fmt(about)} documentos</span><strong>${personName}</strong></div>`
  $('columns').innerHTML = html`${personRow}${nodes.map((n, i) => {
    const dim = normalizedSearch ? !matching(n, search) : selected && n.id !== selected && !related.has(n.id)
    const mask = termMask(n, personTestimony?.score ?? null)
    const t = n.testimony
    return html`<button class="column-card ${selected === n.id ? 'is-selected' : ''} ${dim ? 'is-dim' : ''}" data-col="${n.id}"${mask ? html` style="--mask:${mask}"` : ''}><span>${String(i + 1).padStart(2, '0')} · ${kinds[n.kind] || n.kind || 'Tipo desconhecido'} · ${fmt(n.count)} docs · ${scoreName(sort)}: ${fmt(score(n, sort))}${t ? ` · avaliação ${signed(t.score)}` : ''}</span><strong>${label(n)}</strong></button>`
  })}`
  queryAll('[data-col]', $('columns')).forEach((el) => el.addEventListener('click', () => onChoose(String(el.dataset.col))))
  queryAll('[data-person-docs]', $('columns')).forEach((el) => wirePersonDocs(el, onShowPerson))
}

// The selected term's testimony next to the person's own mean, whether or not the mask is on.
export const testimonyLine = (n: Term, person: PersonTestimony | undefined) => {
  const t = n.testimony
  if (!t || !person || person.score === null) return ''
  const delta = t.score - person.score
  const reading = t.n < MASK_MIN ? 'poucos textos para comparar' : delta <= -0.5 ? 'mais hostis que a média da pessoa' : delta >= 0.5 ? 'mais favoráveis que a média da pessoa' : 'na média da pessoa'
  return html`<p>Textos com este termo: <strong class="score-highlight">${signed(t.score)}</strong> de avaliação em ${fmt(t.n)} ${t.n === 1 ? 'texto' : 'textos'}, contra ${signed(person.score)} da pessoa no recorte. ${reading}.</p>`
}

const relatedButtons = (items: { node: Term; count?: number }[], sort: string, counts = true) =>
  items.map(({ node: n, count }) => html`<button data-related="${n.id}"><span>${label(n)}</span><b>${fmt(counts ? count : score(n, sort))}</b></button>`)

// Paints the inspector. No fetch: documents open only on pick, not from here.
export const inspect = ({
  graph,
  nodes,
  links,
  selected,
  sort,
  daysLabel,
  onChoose,
}: {
  graph: Graph | null
  nodes: Term[]
  links: Link[]
  selected: string | null
  sort: string
  daysLabel: string
  onChoose: (id: string) => void
}) => {
  const n = nodes.find((n) => n.id === selected)
  if (!n) {
    $('inspector').innerHTML = html`<p class="eyebrow">A pessoa no centro</p><h3>${graph?.person?.name || ''}</h3><dl class="metric stat"><div><dt>documentos sobre a pessoa</dt><dd>${fmt(graph?.stats?.about)}</dd></div><div><dt>termos no recorte</dt><dd>${nodes.length}</dd></div></dl><p>Sem seleção, o atlas mostra um campo limpo: nenhuma ligação termo-termo fica visível.</p><p class="eyebrow">Comece por · ${scoreName(sort)}</p><div class="related">${relatedButtons(nodes.slice(0, 5).map((node) => ({ node })), sort, false)}</div>`
  } else {
    const related = relatedTo(nodes, links, n.id)
    $('inspector').innerHTML = html`<p class="eyebrow">${kinds[n.kind] || n.kind || 'Tipo desconhecido'} em foco</p><h3 tabindex="-1" id="termHeading">${label(n)}</h3><dl class="metric stat"><div><dt>documentos</dt><dd>${fmt(n.count)}</dd></div><div><dt>PMI bruto</dt><dd>${fmt(n.pmi)}</dd></div></dl><p><strong class="score-highlight">${fmt(score(n, sort))}</strong> ${scoreName(sort)} · score usado no tamanho.</p>${testimonyLine(n, graph?.stats?.testimony)}<p>${graph?.person.name ?? ''} · ${daysLabel}.</p><p class="eyebrow">Aparece junto com · docs</p><div class="related">${related.length ? relatedButtons(related, sort) : html`<p class="empty-note">Nenhuma relação retornada neste recorte.</p>`}</div>`
  }
  queryAll('[data-related]', $('inspector')).forEach((el) =>
      el.addEventListener('click', () => {
        onChoose(String(el.dataset.related))
        $('termHeading')?.focus({ preventScroll: true })
      }),
    )
}

// /sources counts merged with /testimony means (mergeOutlets in format.ts). The two payloads
// arrive independently; whichever has not landed contributes nothing.
export const paintOutlets = ({
  rows,
  testimony,
  domain,
  onPick,
}: {
  rows: OutletRow[]
  testimony: Testimony | null
  domain: string
  onPick: (domain: string) => void
}) => {
  $('domainLabel').textContent = domainSuffix(domain)
  const merged = mergeOutlets(rows, testimony?.by_domain ?? [])
  $('outletList').innerHTML = merged.length
    ? html`<div class="outlet-grid">${merged.map(
        (r) =>
          html`<button class="outlet ${r.domain === domain ? 'is-active' : ''}" data-domain="${r.domain}" aria-pressed="${String(r.domain === domain)}" style="--tone:${testimonyColor(r.score)}" title="${r.sources.map((x) => sourceLabels[x] ?? x).join(', ')}"><span class="d">${r.domain}</span><span class="n">${fmt(r.docs)}</span><span class="t">${r.score === null ? '' : signed(r.score)}</span></button>`,
      )}</div><p class="note">Documentos no recorte e, quando o veículo tem 3 ou mais textos avaliados, a nota de −10 a +10 que o modelo kikori (${testimony?.method ?? ''}) dá a cada texto sobre a pessoa. Compare veículos falando da mesma pessoa; não compare pessoas entre si.</p>`
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

// Kikori's −10..+10 score overall, per source and per outlet from one response. The `3` in
// the empty copy is api.ts's narrowToTestimony `min`.
export const paintTestimony = ({ data, domain }: { data: Testimony; domain: string }) => {
  const { overall, by_source, by_domain, method } = data
  const score = overall.score
  if (score === null || score === undefined || !overall.n) {
    $('testimonyLabel').textContent = ''
    $('testimonyList').innerHTML = html`<div class="pet-empty"><img class="pet" src="/pet-caracara.png" alt="" width="106" height="78"><p class="note">Nenhum texto avaliado neste recorte (método ${method}).<br>Tente um período maior ou outra fonte.</p></div>`
    return
  }
  $('testimonyLabel').textContent = signed(score)
  const focus = testimonyFocus(by_domain, domain)
  const focusLine =
    domain === 'all'
      ? ''
      : focus
        ? html`<p class="focus"><b>${domain}</b>: <strong style="--tone:${testimonyColor(focus.score)}">${signed(focus.score)}</strong> em ${fmt(focus.n)} ${focus.n === 1 ? 'texto' : 'textos'}. O número acima é o recorte inteiro.</p>`
        : html`<p class="focus"><b>${domain}</b>: menos de 3 textos avaliados, sem média própria. O número acima é o recorte inteiro.</p>`
  $('testimonyList').innerHTML = html`<dl class="verdict stat"><div><dt>Média do recorte</dt><dd style="--tone:${testimonyColor(score)}">${signed(score)}</dd></div></dl><p class="verdict-class">${testimonyClass(score)} · média de ${fmt(overall.n)} ${overall.n === 1 ? 'texto avaliado' : 'textos avaliados'}</p>${focusLine}<dl class="source-chips">${by_source.map(
    (r) =>
      html`<div class="source-chip"><dt>${sourceLabels[r.source] ?? r.source}</dt><dd><span class="n">${fmt(r.n)}</span><span class="t" style="--tone:${testimonyColor(r.score)}">${r.score === null || r.score === undefined ? '' : signed(r.score)}</span></dd></div>`,
  )}</dl>`
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

// Area grows with n; dots shrink on narrow screens (floor 55%) to avoid a tall stack.
export const stripRadius = (n: number, width = 860) => Math.min(1, Math.max(0.55, width / 860)) * Math.min(30, 4 + 2.8 * Math.sqrt(n))

// Past this cap dots shrink until the swarm fits; STRIP_MIN_R is where shrinking stops.
export const STRIP_MAX_HEIGHT = 320
export const STRIP_MIN_R = 3

// Strip geometry at a given width; exported so tests can assert placement without a DOM.
export const stripLayout = (rows: TestimonyDomainRow[], width: number) => {
  const inner = Math.max(80, width - 2 * STRIP_PAD)
  const x = (score: number) => STRIP_PAD + (testimonyPosition(score) / 100) * inner
  const folded = foldTestimonyDomains(rows).map((d) => ({ ...d, x: x(d.score), r: stripRadius(d.n, width) }))
  const smallest = folded.reduce((m, d) => Math.min(m, d.r), Infinity)
  const floor = smallest === Infinity ? 1 : Math.min(1, STRIP_MIN_R / smallest)
  let scale = 1
  const attempt = (k: number) => {
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

// Outlets on the −10..+10 axis so distance is visible. Text stays in HTML; SVG holds shapes.
export const paintStrip = ({
  data,
  domain,
  onPick,
  width = 860,
}: {
  data: Testimony
  domain: string
  onPick: (domain: string) => void
  width?: number
}) => {
  const strip = $('strip')
  const { dots, x, half, height } = stripLayout(data.by_domain, width)
  const overall = data.overall.score
  if (!dots.length || overall === null || overall === undefined) {
    strip.hidden = true
    strip.innerHTML = ''
    return
  }
  strip.hidden = false
  const tick = (s: number) => html`<line class="strip-tick" x1="${x(s)}" x2="${x(s)}" y1="${half - 5}" y2="${half + 5}"/>`
  strip.innerHTML = html`<div class="strip-mean-row"><span class="strip-mean" style="--pos:${testimonyPosition(overall)}%">média da pessoa ${signed(overall)}</span></div><svg class="strip-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="Veículos na régua da avaliação, de −10 a +10"><line class="strip-axis" x1="${STRIP_PAD}" x2="${width - STRIP_PAD}" y1="${half}" y2="${half}"/>${[-10, -5, 0, 5, 10].map(tick)}<line class="strip-overall" x1="${x(overall)}" x2="${x(overall)}" y1="4" y2="${height - 4}"/>${dots.map(
    (d) =>
      html`<g class="strip-dot ${d.domain === domain ? 'is-active' : ''}" style="--tone:${testimonyColor(d.score)}" data-strip-domain="${d.domain}" role="button" tabindex="0" aria-pressed="${String(d.domain === domain)}" aria-label="${d.domain}, ${signed(d.score)} em ${fmt(d.n)} textos"><title>${d.domain} · ${d.sources.map((s) => sourceLabels[s] ?? s).join(', ')} · ${signed(d.score)} em ${fmt(d.n)} ${d.n === 1 ? 'texto' : 'textos'}</title><circle class="dot-halo" cx="${d.x}" cy="${half + d.y}" r="${d.r + 5}"/><circle class="dot-face" cx="${d.x}" cy="${half + d.y}" r="${d.r}"/></g>`,
  )}</svg><div class="strip-axis-labels"><span>−10 contra</span><span>0</span><span>+10 a favor</span></div><p class="note">Uma bolinha por veículo com 3 ou mais textos avaliados; o tamanho é quantos textos. Toque numa bolinha para destacá-la aqui${domain === 'all' ? '' : '; toque de novo, ou fora das bolinhas, para soltar'}. O atlas acima não muda.</p>`
  for (const el of queryAll('[data-strip-domain]', strip)) {
    const pick = () => {
      const d = el.dataset.stripDomain
      onPick(!d || d === domain ? 'all' : d)
    }
    el.addEventListener('click', pick)
    el.addEventListener('keydown', (event) => {
      const e = event as KeyboardEvent
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

export const paintDocsHead = ({ kicker, title }: { kicker: string; title: string }) => {
  if ($('docsKicker')) $('docsKicker').textContent = kicker
  if ($('docsTitle')) $('docsTitle').textContent = title
}

const docMarkup = (d: Doc) => {
  const href = safeDocUrl(d)
  return html`<article class="doc"><p class="eyebrow">${d.domain || d.source}</p><p>${d.text}</p>${href ? html`<a href="${href}" target="_blank" rel="noopener noreferrer">Abrir documento ↗</a>` : ''}</article>`
}

export type DocsSideData = { label: string | null; data: { docs: Doc[]; total: number } }

const sideMarkup = ({ label: name, data }: DocsSideData) =>
  html`${name ? html`<p class="eyebrow docs-side-name">${name}</p>` : ''}${data.docs.length ? html`<p class="docs-summary">Mostrando ${data.docs.length} de ${fmt(data.total)} documentos.</p>${data.docs.map(docMarkup)}` : html`<p>Nenhum documento encontrado.</p>`}`

// Two sides for the ruler (one word, both people); one side for every other figure.
export const paintDocs = (sides: DocsSideData[]) => {
  const box = $('docs')
  if (!box) return
  box.innerHTML = sides.length > 1 ? html`<div class="docs-columns">${sides.map((side) => html`<div>${sideMarkup(side)}</div>`)}</div>` : sides[0] ? sideMarkup(sides[0]) : '<p>Nenhum documento encontrado.</p>'
}

export const paintDocsError = (onRetry: () => void) => {
  const box = $('docs')
  if (!box) return
  box.innerHTML = '<p>Não foi possível carregar documentos. <button class="quiet-button" id="retryDocs">Tentar novamente</button></p>'
  $('retryDocs')?.addEventListener('click', onRetry)
}

export const paintCandidates = (data: { candidates: Candidate[] }) => {
  const list = data.candidates
  $('candidateLabel').textContent = list.length ? String(list.length) : ''
  if (!list.length) {
    $('candidateList').innerHTML = '<p class="note">Nenhum nome novo com 3 ou mais documentos neste período.</p>'
    return
  }
  $('candidateList').innerHTML = html`${list.map((c, i) => {
    const t = trendOf(c)
    return html`<div class="candidate"><button class="outlet" data-candidate="${i}" aria-expanded="false" aria-controls="candidateSamples${i}" title="Ver documentos de exemplo"><span class="d">${c.name}</span><span class="n">${fmt(c.count)} docs</span><span class="s">${fmt(c.sources)} ${c.sources === 1 ? 'fonte' : 'fontes'}</span><span class="t ${t.cls}">${t.text}</span></button><div class="samples" id="candidateSamples${i}" hidden>${c.samples.length ? c.samples.map((d) => html`<article class="doc"><p class="eyebrow">${d.source} · doc ${d.id}</p><p>${d.text}</p></article>`) : html`<p class="note">Sem exemplos neste período.</p>`}</div></div>`
  })}<p class="note">Nomes que ainda não estão em seed.json, comparados com o período anterior de mesmo tamanho. Para acompanhar um nome, adicione-o ao arquivo e rode o índice.</p>`
  queryAll('[data-candidate]', $('candidateList')).forEach((el) =>
      el.addEventListener('click', () => {
        const samples = el.nextElementSibling as HTMLElement
        samples.hidden = !samples.hidden
        el.setAttribute('aria-expanded', String(!samples.hidden))
      }),
    )
}

export const paintCandidatesLoading = () => {
  $('candidateList').textContent = 'Carregando…'
}

export const paintCandidatesError = (onRetry: () => void) => {
  $('candidateList').innerHTML = '<p class="note">Não foi possível carregar os candidatos. <button class="quiet-button" id="retryCandidates">Tentar novamente</button></p>'
  $('retryCandidates').addEventListener('click', onRetry)
}

// ---------- figure 3: the ruler ----------

// `null` is structurally absent: a present-but-negative-PMI side still reads as "this word is
// A's". When both are present, balance uses clamped-positive pulls against the raw combined
// magnitude, so opposite-signed terms settle short of the ends rather than pinning to them.
const isPresent = (v: CompareSide | 'name' | null): v is CompareSide => v !== null && v !== 'name'

const docsOf = (v: CompareSide | 'name' | null) => (v && v !== 'name' ? v.count : 0)

export type RulerTerm = CompareTerm & { balance: number; combined: number }

// Drops own-name terms (counted in hiddenCount) and scores the rest: balance (−1..+1) and
// combined (docs summed, measure-independent). hiddenCount feeds #compareHiddenNote.
export const rulerTerms = (terms: CompareTerm[], measure: string): { items: RulerTerm[]; hiddenCount: number } => {
  let hiddenCount = 0
  const items: RulerTerm[] = []
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
      const rawA = score(t.a as CompareSide, measure)
      const rawB = score(t.b as CompareSide, measure)
      const mag = Math.abs(rawA) + Math.abs(rawB)
      balance = mag === 0 ? 0 : Math.max(-1, Math.min(1, (Math.max(0, rawB) - Math.max(0, rawA)) / mag))
    }
    items.push({ ...t, balance, combined: docsOf(t.a) + docsOf(t.b) })
  }
  return { items, hiddenCount }
}

// The term written on the ruler. Transparent rect is the hit area; `--cmp` carries side colour.
const rulerWordMarkup = (
  d: { term: string; kind: string; text: string; balance: number; combined: number; x: number; y: number; size: number; w: number; h: number },
  half: number,
  isSelected: boolean,
) =>
  html`<g class="ruler-word ${isSelected ? 'is-selected' : ''}" transform="translate(${d.x},${half + d.y})" style="--size:${d.size}px;--cmp:${balanceColor(d.balance)}" data-term="${d.term}" data-kind="${d.kind}" role="button" tabindex="0" aria-pressed="${String(isSelected)}" aria-label="${d.text}, ${fmt(d.combined)} documentos"><title>${d.text} · ${kinds[d.kind] || d.kind || 'Tipo desconhecido'} · ${fmt(d.combined)} documentos</title><rect class="ruler-glow" x="${-d.w / 2 - 4}" y="${-d.h / 2 - 3}" width="${d.w + 8}" height="${d.h + 6}" rx="8"/><rect class="ruler-hit" x="${-d.w / 2}" y="${-d.h / 2}" width="${d.w}" height="${d.h}" rx="5"/><text class="ruler-text" text-anchor="middle" dominant-baseline="central">${d.text}</text></g>`

// Overflow words: count stated, each still a button with the same data-term/data-kind.
const rulerOverflowMarkup = (
  overflow: { term: string; kind: string; text: string; balance: number }[],
  selected: { term: string; kind: string } | null,
) =>
  overflow.length
    ? html`<div class="ruler-overflow"><p>${fmt(overflow.length)} ${overflow.length === 1 ? 'palavra não coube' : 'palavras não couberam'} na régua sem cobrir as outras. Todas continuam clicáveis aqui:</p>${overflow.map((d) => {
        const isSelected = !!selected && selected.term === d.term && selected.kind === d.kind
        return html`<button class="quiet-button ${isSelected ? 'is-selected' : ''}" data-term="${d.term}" data-kind="${d.kind}" aria-pressed="${String(isSelected)}" style="--cmp:${balanceColor(d.balance)}">${d.text}</button>`
      })}</div>`
    : ''

// One word per term written where it leans. `metrics` is the injected text measurer;
// `measure` (documentos or PMI) only repositions words. Returns counts for the caller's notes.
export const paintRuler = ({
  data,
  personA,
  personB,
  measure,
  metrics,
  selected,
  onPick,
  width = 860,
}: {
  data: Compare
  personA: PersonRef
  personB: PersonRef
  measure: string
  metrics: Measure
  selected: { term: string; kind: string } | null
  onPick: (term: string, kind: string) => void
  width?: number
}) => {
  const ruler = $('compareRuler')
  const { items, hiddenCount } = rulerTerms(data.terms, measure)
  if (!items.length) {
    ruler.hidden = false
    ruler.innerHTML = '<p class="note">Nenhuma palavra neste recorte.</p>'
    return { hiddenCount, shown: 0, overflowCount: 0 }
  }
  ruler.hidden = false
  const { words, overflow, x, half, height } = rulerLayout(metrics, items, width)
  const tick = (b: number) => html`<line class="ruler-tick" x1="${x(b)}" x2="${x(b)}" y1="${half - 5}" y2="${half + 5}"/>`
  ruler.innerHTML = html`<div class="ruler-end-row"><span class="ruler-end cmp-a">${personA.name}</span><span class="ruler-end cmp-b">${personB.name}</span></div><svg class="ruler-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="Régua comparando ${personA.name} e ${personB.name}"><line class="ruler-axis" x1="${RULER_PAD}" x2="${width - RULER_PAD}" y1="${half}" y2="${half}"/>${[-1, -0.5, 0, 0.5, 1].map(tick)}${words.map((d) => rulerWordMarkup(d, half, !!selected && selected.term === d.term && selected.kind === d.kind))}</svg><div class="ruler-axis-labels"><span>Só de ${personA.name}</span><span>dividida</span><span>Só de ${personB.name}</span></div><p class="note">Cada palavra está escrita onde ela pende, e o tamanho dela é quantos documentos tem dos dois lados somados. Toque numa palavra para ver os números dos dois lados. Cada pessoa entra com as palavras mais frequentes e com as mais grudentas, então a régua costuma mostrar mais palavras do que o número escolhido na frase acima: ${fmt(items.length)} ${items.length === 1 ? 'palavra' : 'palavras'} neste recorte.</p>${rulerOverflowMarkup(overflow, selected)}`
  for (const el of queryAll('[data-term]', ruler)) {
    const pick = () => onPick(String(el.dataset.term), String(el.dataset.kind))
    el.addEventListener('click', pick)
    // <g> elements need an explicit key handler; <button>s already handle Enter/Space.
    if (String(el.tagName || '').toLowerCase() !== 'button')
      el.addEventListener('keydown', (event) => {
        const e = event as KeyboardEvent
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

// Selected word's numbers on both sides; a null side reads "nenhum documento" (measured zero).
export const paintCompareDetail = ({ term, personA, personB }: { term: CompareTerm | null; personA: PersonRef; personB: PersonRef }) => {
  const el = $('compareDetail')
  if (!el) return
  if (!term) {
    el.innerHTML = '<span class="empty-hint">Clique numa palavra para ver os números dos dois lados.</span>'
    return
  }
  const sideHtml = (person: PersonRef, v: CompareSide | 'name' | null) =>
    v && v !== 'name'
      ? html`<div><dt>${person.name}</dt><dd><b>${fmt(v.count)}</b> documentos · PMI <b>${fmt(v.pmi)}</b></dd></div>`
      : html`<div><dt>${person.name}</dt><dd class="empty-hint">nenhum documento</dd></div>`
  el.innerHTML = html`<span class="term">${label(term)}</span><dl class="detail-sides">${sideHtml(personA, term.a)}${sideHtml(personB, term.b)}</dl>`
}
