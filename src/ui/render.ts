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
  type Rising,
  type RisingTerm,
  type Sparkline,
  type Term,
  type Testimony,
  type TestimonyDomainRow,
  type Week,
  type WeekBucket,
  weekDayIso,
  weekDayLabel,
} from './format.js'
import { FONT_MONO, RULER_PAD, WEEK_COLUMN_WIDTH, rulerLayout, routesFrom, swarm, weekLayout, type RulerItem, type WeekColumnLayout } from './layout.js'

// getElementById is HTMLElement | null; callers read per-element fields (~100 sites), so this stays `any`.
const $ = (id: string): any => document.getElementById(id)
// Typed as HTMLElement so `dataset` and `classList` are visible without casting.
const queryAll = (selector: string, root: any = document): NodeListOf<HTMLElement> => root.querySelectorAll(selector)

// The only place that touches a <canvas>; layout.ts stays DOM-free and testable without it.
export const createCanvasMeasure = (): Measure => {
  const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
  return (text, size, family = FONT_MONO, weight = 500) => {
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

const SPARK_BARS = 7
const SPARK_HEIGHT = 34

// Word-in-focus only (issue #147 AC20): seven rolling days, independent of the atlas's own
// days chip, so the caption is explicit about what window it reads. 'error' leaves the hole
// empty rather than a fake flat line; 'loading' is a ghost of the same seven bars.
const sparklineMarkup = (spark?: Sparkline) => {
  if (!spark) return ''
  if (spark.state === 'error')
    return html`<div class="sparkline" aria-hidden="true"></div><p class="note">Não foi possível carregar os últimos 7 dias.</p>`
  const loading = spark.state === 'loading'
  const counts = loading ? [] : (spark.counts ?? [])
  const max = Math.max(1, ...counts)
  const bars = Array.from({ length: SPARK_BARS }, (_, i) =>
    loading
      ? ghostBar('spark-ghost')
      : html`<div class="spark-bar" style="--h:${Math.max(2, Math.round(((counts[i] ?? 0) / max) * SPARK_HEIGHT))}px"></div>`,
  )
  return html`<div class="sparkline${loading ? ' ghost-field' : ''}" role="img" aria-label="Documentos com esta palavra nos últimos 7 dias">${bars}</div><p class="note">Últimos 7 dias corridos, não o período escolhido acima.</p>`
}

// Paints the inspector. No fetch: documents (and the sparkline's own data) arrive already
// resolved; a word in focus without `sparkline` simply omits it (the figure has not asked yet).
export const inspect = ({
  graph,
  nodes,
  links,
  selected,
  sort,
  daysLabel,
  onChoose,
  sparkline,
}: {
  graph: Graph | null
  nodes: Term[]
  links: Link[]
  selected: string | null
  sort: string
  daysLabel: string
  onChoose: (id: string) => void
  sparkline?: Sparkline
}) => {
  const n = nodes.find((n) => n.id === selected)
  if (!n) {
    $('inspector').innerHTML = html`<p class="eyebrow">A pessoa no centro</p><h3>${graph?.person?.name || ''}</h3><dl class="metric stat"><div><dt>documentos sobre a pessoa</dt><dd>${fmt(graph?.stats?.about)}</dd></div><div><dt>termos no recorte</dt><dd>${nodes.length}</dd></div></dl><p>Sem seleção, o atlas mostra um campo limpo: nenhuma ligação termo-termo fica visível.</p><p class="eyebrow">Comece por · ${scoreName(sort)}</p><div class="related">${relatedButtons(nodes.slice(0, 5).map((node) => ({ node })), sort, false)}</div>`
  } else {
    const related = relatedTo(nodes, links, n.id)
    $('inspector').innerHTML = html`<p class="eyebrow">${kinds[n.kind] || n.kind || 'Tipo desconhecido'} em foco</p><h3 tabindex="-1" id="termHeading">${label(n)}</h3><dl class="metric stat"><div><dt>documentos</dt><dd>${fmt(n.count)}</dd></div><div><dt>PMI bruto</dt><dd>${fmt(n.pmi)}</dd></div></dl><p><strong class="score-highlight">${fmt(score(n, sort))}</strong> ${scoreName(sort)} · score usado no tamanho.</p>${testimonyLine(n, graph?.stats?.testimony)}${sparklineMarkup(sparkline)}<p>${graph?.person.name ?? ''} · ${daysLabel}.</p><p class="eyebrow">Aparece junto com · docs</p><div class="related">${related.length ? relatedButtons(related, sort) : html`<p class="empty-note">Nenhuma relação retornada neste recorte.</p>`}</div>`
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
  $('outletList').classList.remove('is-loading')
  $('outletList').setAttribute('aria-busy', 'false')
  $('outletList').innerHTML = merged.length
    ? html`<div class="outlet-grid">${merged.map(
        (r) =>
          html`<button class="outlet ${r.domain === domain ? 'is-active' : ''}" data-domain="${r.domain}" aria-pressed="${String(r.domain === domain)}" style="--tone:${testimonyColor(r.score)}" title="${r.sources.map((x) => sourceLabels[x] ?? x).join(', ')}"><span class="d">${r.domain}</span><span class="n">${fmt(r.docs)}</span><span class="t">${r.score === null ? '' : signed(r.score)}</span></button>`,
      )}</div><p class="note">Documentos no recorte e, quando o veículo tem 3 ou mais textos avaliados, a nota de −10 a +10 que o kikori (${testimony?.method ?? ''}) dá a cada texto sobre a pessoa. Compare veículos falando da mesma pessoa; não compare pessoas entre si.</p>`
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
  $('outletList').classList.remove('is-loading')
  $('outletList').setAttribute('aria-busy', 'false')
}

const ghostBar = (cls: string) => html`<span class="ghost ${cls}"></span>`

const ATLAS_GHOST_WORDS: [number, number, number, number][] = [
  [-118, -92, 96, 22],
  [88, -128, 72, 18],
  [168, -28, 110, 24],
  [124, 86, 68, 18],
  [18, 156, 90, 20],
  [-96, 138, 58, 16],
  [-176, 36, 100, 22],
  [-158, -156, 52, 14],
  [36, -188, 80, 18],
  [196, 64, 60, 16],
  [-36, 48, 44, 14],
  [8, -48, 76, 20],
  [-210, -70, 64, 16],
  [150, 150, 54, 16],
]

export const paintAtlasLoading = () => {
  const viewport = $('viewport')
  if (!viewport) return
  viewport.setAttribute('aria-busy', 'true')
  viewport.innerHTML = html`<div class="map-stage" aria-hidden="true"><svg class="map-svg" viewBox="-430 -402 860 804"><defs><radialGradient id="halo"><stop class="halo-in" offset="0"/><stop class="halo-out" offset="1"/></radialGradient></defs><circle r="350" fill="url(#halo)"/><circle class="boundary" r="360"/><path d="M-7,-360 H7 M-7,360 H7 M-360,-7 V7 M360,-7 V7" stroke="var(--accent)" stroke-width="2" opacity=".7"/><g class="ghost-field">${ATLAS_GHOST_WORDS.map(
    ([x, y, w, h]) => html`<rect class="ghost" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="6"/>`,
  )}<rect class="ghost" x="-72" y="-26" width="144" height="52" rx="10"/></g></svg></div>`
  const inspector = $('inspector')
  if (!inspector) return
  inspector.innerHTML = html`<div class="ghost-field" aria-hidden="true"><p class="eyebrow">${ghostBar('ghost-kicker')}</p>${ghostBar('ghost-title')}<dl class="metric stat"><div><dt>${ghostBar('ghost-stat')}</dt><dd>${ghostBar('ghost-stat')}</dd></div><div><dt>${ghostBar('ghost-stat')}</dt><dd>${ghostBar('ghost-stat')}</dd></div></dl>${ghostBar('ghost-line')}${ghostBar('ghost-line is-short')}</div>`
}

export const paintOutletsLoading = () => {
  const list = $('outletList')
  if (!list) return
  list.classList.remove('is-loading')
  list.setAttribute('aria-busy', 'true')
  const widths = ['', 'is-mid', 'is-short']
  list.innerHTML = html`<div class="outlet-grid ghost-field" aria-hidden="true">${[0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) => html`<div class="outlet"><span class="d">${ghostBar(`ghost-outlet-d ${widths[i % 3]}`)}</span><span class="n">${ghostBar('ghost-outlet-n')}</span><span class="t">${ghostBar('ghost-outlet-n')}</span></div>`,
  )}</div><p class="sr-only">Lendo os veículos.</p>`
}

// Kikori's −10..+10 score overall, per source and per outlet from one response. The `3` in
// the empty copy is api.ts's narrowToTestimony `min`.
export const paintTestimony = ({ data, domain }: { data: Testimony; domain: string }) => {
  const { overall, by_source, by_domain, method } = data
  const score = overall.score
  if (score === null || score === undefined || !overall.n) {
    $('testimonyLabel').textContent = ''
    $('testimonyList').classList.remove('is-loading')
    $('testimonyList').setAttribute('aria-busy', 'false')
    $('testimonyList').innerHTML = html`<div class="pet-empty"><img class="pet" src="/pet-caracara.png" alt="" width="106" height="78"><p class="note">Nenhum texto avaliado neste recorte (método ${method}).<br>Tente um período maior ou outra fonte.</p></div>`
    return
  }
  $('testimonyLabel').textContent = signed(score)
  $('testimonyList').classList.remove('is-loading')
  $('testimonyList').setAttribute('aria-busy', 'false')
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

const STRIP_PAD = 28

const STRIP_GHOST_DOTS: [number, number][] = [
  [92, 11],
  [210, 8],
  [348, 17],
  [430, 10],
  [528, 21],
  [656, 9],
  [768, 14],
]

export const paintTestimonyLoading = () => {
  if ($('testimonyLabel')) $('testimonyLabel').textContent = ''
  const list = $('testimonyList')
  if (list) {
    list.classList.remove('is-loading')
    list.setAttribute('aria-busy', 'true')
    list.innerHTML = html`<div class="ghost-field" aria-hidden="true"><dl class="verdict stat"><div><dt>${ghostBar('ghost-kicker')}</dt><dd>${ghostBar('ghost-stat is-xl')}</dd></div></dl>${ghostBar('ghost-line is-short')}<dl class="source-chips">${[0, 1, 2, 3].map(() => html`<div class="source-chip">${ghostBar('ghost-chip')}</div>`)}</dl></div><p class="sr-only">Lendo a avaliação.</p>`
  }
  const strip = $('strip')
  if (!strip) return
  strip.hidden = false
  strip.classList.remove('is-loading')
  strip.setAttribute('aria-busy', 'true')
  const width = 860
  const height = 96
  const half = 48
  strip.innerHTML = html`<div class="ghost-field" aria-hidden="true"><div class="strip-mean-row"></div><svg class="strip-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><line class="strip-axis" x1="${STRIP_PAD}" x2="${width - STRIP_PAD}" y1="${half}" y2="${half}"/>${[-10, -5, 0, 5, 10].map(
    (s) => html`<line class="strip-tick" x1="${STRIP_PAD + ((s + 10) / 20) * (width - 2 * STRIP_PAD)}" x2="${STRIP_PAD + ((s + 10) / 20) * (width - 2 * STRIP_PAD)}" y1="${half - 5}" y2="${half + 5}"/>`,
  )}${STRIP_GHOST_DOTS.map(([x, r]) => html`<circle class="ghost" cx="${x}" cy="${half}" r="${r}"/>`)}</svg><div class="strip-axis-labels"><span>−10 contra</span><span>0</span><span>+10 a favor</span></div></div>`
}

export const paintTestimonyError = () => {
  $('testimonyList').innerHTML = '<p class="note">Não foi possível carregar a avaliação.</p>'
  $('testimonyList').classList.remove('is-loading')
  $('testimonyList').setAttribute('aria-busy', 'false')
  $('strip').hidden = true
  $('strip').classList.remove('is-loading')
  $('strip').setAttribute('aria-busy', 'false')
}

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
    strip.classList.remove('is-loading')
    strip.setAttribute('aria-busy', 'false')
    strip.innerHTML = ''
    return
  }
  strip.hidden = false
  strip.classList.remove('is-loading')
  strip.setAttribute('aria-busy', 'false')
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

// Figure 1's third view (issue #149): each word positioned by its own kikori mean, not by
// outlet. termMask is the single source of both eligibility and colour; a null return means
// "too few scored texts, or no person mean to compare against" and the word is hidden, counted
// only in the note. The domain is derived per recorte (unlike the fixed ±10 axis above) and
// always includes the person's own score, so the dashed mean line never falls outside it.
type StripDot = { id: string; term: string; kind: string; score: number; count: number; tone: string; x: number; r: number }

export const termStripLayout = (nodes: Term[], personTestimony: PersonTestimony | undefined, width = 860) => {
  const personScore = personTestimony?.score ?? null
  const inner = Math.max(80, width - 2 * STRIP_PAD)
  const eligible = nodes
    .map((n) => ({ n, tone: termMask(n, personScore) }))
    .filter((e): e is { n: Term; tone: string } => e.tone !== null)
  if (!eligible.length)
    return { dots: [] as (StripDot & { y: number })[], domainMin: -1, domainMax: 1, ticks: [-1, 0, 1], x: (s: number) => STRIP_PAD + inner / 2, half: 44, height: 88 }
  const scores = eligible.map((e) => e.n.testimony!.score)
  let domainMin = Math.floor(Math.min(...scores, personScore as number))
  let domainMax = Math.ceil(Math.max(...scores, personScore as number))
  if (domainMax - domainMin < 2) {
    domainMin -= 1
    domainMax += 1
  }
  // A float mean can sit a fraction of a unit from a floor/ceil edge (e.g. -3.97 next to a
  // domainMin of -4) without ever equaling it; comparing the gap to a share of the span catches
  // that near-miss the same way an exact match already caught the integer case.
  const edgeGap = (domainMax - domainMin) * 0.03
  if ((personScore as number) - domainMin < edgeGap) domainMin -= 1
  if (domainMax - (personScore as number) < edgeGap) domainMax += 1
  const span = domainMax - domainMin
  const x = (s: number) => STRIP_PAD + ((Math.max(domainMin, Math.min(domainMax, s)) - domainMin) / span) * inner
  const placed: StripDot[] = eligible.map((e) => ({
    id: e.n.id,
    term: e.n.term,
    kind: e.n.kind,
    score: e.n.testimony!.score,
    count: e.n.count,
    tone: e.tone,
    x: x(e.n.testimony!.score),
    r: stripRadius(e.n.count, width),
  }))
  // At a high word count the swarm can stack many rows; shrink the dots (never below
  // STRIP_MIN_R) until the figure fits STRIP_MAX_HEIGHT, the same trade-off stripLayout
  // already makes for figure 2's outlet strip.
  const smallest = placed.reduce((m, d) => Math.min(m, d.r), Infinity)
  const floor = smallest === Infinity ? 1 : Math.min(1, STRIP_MIN_R / smallest)
  let scale = 1
  const attempt = (k: number) => {
    const dots = swarm(placed.map((d) => ({ ...d, r: d.r * k })))
    const reach = dots.reduce((m, d) => Math.max(m, Math.abs(d.y) + d.r), 0)
    return { dots, half: Math.max(44, Math.ceil(reach) + 6) }
  }
  let fit = attempt(scale)
  while (fit.half * 2 > STRIP_MAX_HEIGHT && scale > floor) {
    scale = Math.max(floor, scale * 0.92)
    fit = attempt(scale)
  }
  const ticks: number[] = []
  for (let t = domainMin; t <= domainMax; t++) ticks.push(t)
  return { dots: fit.dots, domainMin, domainMax, ticks, x, half: fit.half, height: fit.half * 2 }
}

// Strip mode draws no links and has nothing to zoom, so its #legend names size and colour
// instead of the map's copy about lines and zooming; colour reuses maskLegend because the
// strip's dots are coloured by the same termMask the map and columns already use.
export const stripLegend = (personTestimony?: PersonTestimony) =>
  html`<span><span class="type-scale" aria-hidden="true"><span>Aa</span><span>Aa</span></span>Tamanho = quantos textos</span><span>Tab + Enter para selecionar</span>${maskLegend(personTestimony)}`

// Draws into #atlasStrip and #stripHiddenNote. Unlike paintStrip, size is by document count
// (the same number the map and the columns already size by) and colour is termMask's mask
// colour, not the tone-only ramp #testimony uses.
export const paintTermStrip = ({
  nodes,
  personTestimony,
  onChoose,
  search = '',
  width = 860,
}: {
  nodes: Term[]
  personTestimony?: PersonTestimony
  onChoose: (id: string) => void
  search?: string
  width?: number
}) => {
  const strip = $('atlasStrip')
  const note = $('stripHiddenNote')
  if (!nodes.length) {
    strip.innerHTML = '<div class="empty">Nenhum termo neste recorte.</div>'
    if (note) note.hidden = true
    return
  }
  const { dots, domainMin, domainMax, ticks, x, half, height } = termStripLayout(nodes, personTestimony, width)
  const hiddenCount = nodes.length - dots.length
  const overall = personTestimony?.score
  const hasMean = overall !== null && overall !== undefined
  if (note) {
    note.hidden = hiddenCount === 0
    note.textContent = hiddenCount
      ? hasMean
        ? `${hiddenCount} ${hiddenCount === 1 ? 'palavra deixada' : 'palavras deixadas'} de fora por ${hiddenCount === 1 ? 'ter' : 'terem'} menos de 3 textos avaliados.`
        : `${hiddenCount} ${hiddenCount === 1 ? 'palavra deixada' : 'palavras deixadas'} de fora: esta pessoa não tem média de avaliação neste recorte.`
      : ''
  }
  if (!dots.length) {
    strip.innerHTML = '<div class="empty">Nenhuma palavra com avaliação suficiente neste recorte.</div>'
    return
  }
  const normalizedSearch = normalize(search)
  const tick = (s: number) => html`<line class="strip-tick" x1="${x(s)}" x2="${x(s)}" y1="${half - 5}" y2="${half + 5}"/>`
  strip.innerHTML = html`${hasMean ? html`<div class="strip-mean-row"><span class="strip-mean" style="--pos:${((x(overall as number) - STRIP_PAD) / Math.max(1, width - 2 * STRIP_PAD)) * 100}%">média da pessoa ${signed(overall)}</span></div>` : ''}<svg class="strip-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="Palavras na régua da avaliação"><line class="strip-axis" x1="${STRIP_PAD}" x2="${width - STRIP_PAD}" y1="${half}" y2="${half}"/>${ticks.map(tick)}${hasMean ? html`<line class="strip-overall" x1="${x(overall as number)}" x2="${x(overall as number)}" y1="4" y2="${height - 4}"/>` : ''}${dots.map((d) => {
    const dim = normalizedSearch ? !matching({ term: d.term, kind: d.kind }, search) : false
    return html`<g class="strip-dot ${dim ? 'is-dim' : ''}" data-node="${d.id}" style="--tone:${d.tone}" role="button" tabindex="0" aria-label="${d.term}, avaliação ${signed(d.score)} em ${fmt(d.count)} ${d.count === 1 ? 'texto' : 'textos'}"><title>${d.term} · avaliação ${signed(d.score)} em ${fmt(d.count)} ${d.count === 1 ? 'texto' : 'textos'}</title><circle class="dot-halo" cx="${d.x}" cy="${half + d.y}" r="${d.r + 5}"/><circle class="dot-face" cx="${d.x}" cy="${half + d.y}" r="${d.r}"/></g>`
  })}</svg><div class="strip-axis-labels"><span>${signed(domainMin)} contra</span><span>${signed(domainMax)} a favor</span></div>`
  for (const el of queryAll('[data-node]', strip)) {
    const pick = () => onChoose(String(el.dataset.node))
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
  if (!box) return
  box.setAttribute('aria-busy', 'true')
  box.innerHTML = html`<div class="ghost-field" aria-hidden="true">${[0, 1, 2].map(
    () => html`<article class="doc">${ghostBar('ghost-doc-kicker')}${ghostBar('ghost-doc-line')}${ghostBar('ghost-doc-line is-short')}</article>`,
  )}</div><p class="sr-only">Lendo os documentos.</p>`
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
  box.setAttribute('aria-busy', 'false')
  box.innerHTML = sides.length > 1 ? html`<div class="docs-columns">${sides.map((side) => html`<div>${sideMarkup(side)}</div>`)}</div>` : sides[0] ? sideMarkup(sides[0]) : '<p>Nenhum documento encontrado.</p>'
}

export const paintDocsError = (onRetry: () => void) => {
  const box = $('docs')
  if (!box) return
  box.setAttribute('aria-busy', 'false')
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
  const list = $('candidateList')
  if (!list) return
  list.innerHTML = html`<div class="ghost-field" aria-hidden="true">${[0, 1, 2].map(() => html`<div class="candidate">${ghostBar('ghost-line')}</div>`)}</div><p class="sr-only">Lendo os candidatos.</p>`
}

export const paintCandidatesError = (onRetry: () => void) => {
  $('candidateList').innerHTML = '<p class="note">Não foi possível carregar os candidatos. <button class="quiet-button" id="retryCandidates">Tentar novamente</button></p>'
  $('retryCandidates').addEventListener('click', onRetry)
}

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

// Shared by figure 3 (compare) and figure 4 (rising): draws a ruler's end labels, SVG axis and
// words, axis labels and overflow list, and wires click/keydown on every word. The two figures
// differ only in which items they hand it and how they word the ends/axis/note — the packing
// (`rulerLayout`) and the per-word markup are the same for both. `note` is figure-specific prose;
// rising passes '' and says its own numbers in `#risingAbout` instead.
const paintRulerBody = ({
  elementId,
  items,
  metrics,
  selected,
  onPick,
  width,
  endA,
  endB,
  axisLabels,
  ariaLabel,
  note,
}: {
  elementId: string
  items: RulerItem[]
  metrics: Measure
  selected: { term: string; kind: string } | null
  onPick: (term: string, kind: string) => void
  width: number
  endA: string
  endB: string
  axisLabels: [string, string, string]
  ariaLabel: string
  note: ReturnType<typeof html> | string
}) => {
  const ruler = $(elementId)
  const { words, overflow, x, half, height } = rulerLayout(metrics, items, width)
  const tick = (b: number) => html`<line class="ruler-tick" x1="${x(b)}" x2="${x(b)}" y1="${half - 5}" y2="${half + 5}"/>`
  ruler.innerHTML = html`<div class="ruler-end-row"><span class="ruler-end cmp-a">${endA}</span><span class="ruler-end cmp-b">${endB}</span></div><svg class="ruler-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="${ariaLabel}"><line class="ruler-axis" x1="${RULER_PAD}" x2="${width - RULER_PAD}" y1="${half}" y2="${half}"/>${[-1, -0.5, 0, 0.5, 1].map(tick)}${words.map((d) => rulerWordMarkup(d, half, !!selected && selected.term === d.term && selected.kind === d.kind))}</svg><div class="ruler-axis-labels"><span>${axisLabels[0]}</span><span>${axisLabels[1]}</span><span>${axisLabels[2]}</span></div>${note}${rulerOverflowMarkup(overflow, selected)}`
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
  return { shown: words.length, overflowCount: overflow.length }
}

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
    ruler.classList.remove('is-loading')
    ruler.setAttribute('aria-busy', 'false')
    ruler.innerHTML = '<p class="note">Nenhuma palavra neste recorte.</p>'
    return { hiddenCount, shown: 0, overflowCount: 0 }
  }
  ruler.hidden = false
  ruler.classList.remove('is-loading')
  ruler.setAttribute('aria-busy', 'false')
  const note = html`<p class="note">Cada palavra está escrita onde ela pende, e o tamanho dela é quantos documentos tem dos dois lados somados. Toque numa palavra para ver os números dos dois lados. Cada pessoa entra com as palavras mais frequentes e com as mais grudentas, então a régua costuma mostrar mais palavras do que o número escolhido na frase acima: ${fmt(items.length)} ${items.length === 1 ? 'palavra' : 'palavras'} neste recorte.</p>`
  const { shown, overflowCount } = paintRulerBody({
    elementId: 'compareRuler',
    items,
    metrics,
    selected,
    onPick,
    width,
    endA: personA.name,
    endB: personB.name,
    axisLabels: [`Só de ${personA.name}`, 'dividida', `Só de ${personB.name}`],
    ariaLabel: `Régua comparando ${personA.name} e ${personB.name}`,
    note,
  })
  return { hiddenCount, shown, overflowCount }
}

export const paintRulerError = () => {
  const ruler = $('compareRuler')
  ruler.hidden = false
  ruler.classList.remove('is-loading')
  ruler.setAttribute('aria-busy', 'false')
  ruler.innerHTML = '<p class="note">Não foi possível carregar a comparação.</p>'
}

// balance = clamp(log2(word's lift / the person's own lift) / 3, -1, 1): a word right of centre
// grew faster than the person herself, left slower, regardless of either's absolute size.
// About.baseline's own +1 smoothing (already used server-side per term) keeps this finite even
// when the person has no baseline docs at all.
export const liftOfPerson = (about: { recent: number; baseline: number }, days: number, baselineDays: number) => about.recent / days / ((about.baseline + 1) / baselineDays)

export type RisingItem = RulerItem & { lift: number }

// combined = count_recent_raw + count_baseline_raw, the exact doc counts behind the rounded
// rates, so a word's size on the ruler never compounds the server's own rounding.
export const risingRulerItems = (terms: RisingTerm[], liftPerson: number): RisingItem[] =>
  terms.map((t) => {
    const ratio = liftPerson > 0 ? t.lift / liftPerson : t.lift > 0 ? Infinity : 1
    return { term: t.term, kind: t.kind, lift: t.lift, balance: Math.max(-1, Math.min(1, Math.log2(ratio) / 3)), combined: t.count_recent_raw + t.count_baseline_raw }
  })

// Figure 4's own wrapper around the shared ruler body: "antes (30 dias)" / "agora (7 dias)" reuse
// the compare ruler's --cmp-a/--cmp-b pair, and a word belongs to one person, so there is no
// hiddenCount to report back.
export const paintRisingRuler = ({
  data,
  metrics,
  selected,
  onPick,
  width = 860,
}: {
  data: Rising
  metrics: Measure
  selected: { term: string; kind: string } | null
  onPick: (term: string, kind: string) => void
  width?: number
}) => {
  const ruler = $('risingRuler')
  const liftPerson = liftOfPerson(data.about, data.days, data.baseline)
  const items = risingRulerItems(data.terms, liftPerson)
  if (!items.length) {
    ruler.hidden = false
    ruler.classList.remove('is-loading')
    ruler.setAttribute('aria-busy', 'false')
    ruler.innerHTML = '<p class="note">Nenhuma palavra neste recorte.</p>'
    return { shown: 0, overflowCount: 0 }
  }
  ruler.hidden = false
  ruler.classList.remove('is-loading')
  ruler.setAttribute('aria-busy', 'false')
  return paintRulerBody({
    elementId: 'risingRuler',
    items,
    metrics,
    selected,
    onPick,
    width,
    endA: 'antes (30 dias)',
    endB: 'agora (7 dias)',
    axisLabels: ['Mais devagar que a pessoa', 'no mesmo ritmo', 'Mais rápido que a pessoa'],
    ariaLabel: 'Régua de termos em alta',
    note: '',
  })
}

export const paintRisingRulerError = () => {
  const ruler = $('risingRuler')
  if (!ruler) return
  ruler.hidden = false
  ruler.classList.remove('is-loading')
  ruler.setAttribute('aria-busy', 'false')
  ruler.innerHTML = '<p class="note">Não foi possível carregar os termos em alta.</p>'
}

const RULER_GHOST_WORDS: [number, number, number, number][] = [
  [110, -14, 86, 20],
  [210, 12, 64, 16],
  [320, -8, 100, 22],
  [430, 0, 72, 18],
  [530, 16, 90, 20],
  [640, -12, 58, 16],
  [740, 8, 80, 18],
]

export const paintCompareLoading = () => {
  const ruler = $('compareRuler')
  if (ruler) {
    ruler.hidden = false
    ruler.classList.remove('is-loading')
    ruler.setAttribute('aria-busy', 'true')
    const width = 860
    const height = 88
    const half = 44
    const pad = 28
    ruler.innerHTML = html`<div class="ghost-field" aria-hidden="true"><div class="ruler-end-row">${ghostBar('ghost-name')}${ghostBar('ghost-name')}</div><svg class="ruler-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><line class="ruler-axis" x1="${pad}" x2="${width - pad}" y1="${half}" y2="${half}"/>${[-1, -0.5, 0, 0.5, 1].map(
      (b) => html`<line class="ruler-tick" x1="${pad + ((b + 1) / 2) * (width - 2 * pad)}" x2="${pad + ((b + 1) / 2) * (width - 2 * pad)}" y1="${half - 5}" y2="${half + 5}"/>`,
    )}${RULER_GHOST_WORDS.map(
      ([x, y, w, h]) => html`<rect class="ghost" x="${x - w / 2}" y="${half + y - h / 2}" width="${w}" height="${h}" rx="5"/>`,
    )}</svg></div><p class="sr-only">Lendo a régua.</p>`
  }
  const detail = $('compareDetail')
  if (!detail) return
  detail.innerHTML = html`<div class="ghost-field" aria-hidden="true">${ghostBar('ghost-title')}<dl class="detail-sides"><div><dt>${ghostBar('ghost-kicker')}</dt><dd>${ghostBar('ghost-line is-short')}</dd></div><div><dt>${ghostBar('ghost-kicker')}</dt><dd>${ghostBar('ghost-line is-short')}</dd></div></dl></div>`
}

// Figure 4's own boot/reload ghost: the same ruler geometry paintCompareLoading paints, inside
// #risingRuler, no #risingAbout ghost — that line is cleared instead, since a two-number sentence
// has no shape worth a ghost of its own.
export const paintRisingLoading = () => {
  const ruler = $('risingRuler')
  if (!ruler) return
  ruler.hidden = false
  ruler.classList.remove('is-loading')
  ruler.setAttribute('aria-busy', 'true')
  const width = 860
  const height = 88
  const half = 44
  const pad = 28
  ruler.innerHTML = html`<div class="ghost-field" aria-hidden="true"><div class="ruler-end-row">${ghostBar('ghost-name')}${ghostBar('ghost-name')}</div><svg class="ruler-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><line class="ruler-axis" x1="${pad}" x2="${width - pad}" y1="${half}" y2="${half}"/>${[-1, -0.5, 0, 0.5, 1].map(
    (b) => html`<line class="ruler-tick" x1="${pad + ((b + 1) / 2) * (width - 2 * pad)}" x2="${pad + ((b + 1) / 2) * (width - 2 * pad)}" y1="${half - 5}" y2="${half + 5}"/>`,
  )}${RULER_GHOST_WORDS.map(
    ([x, y, w, h]) => html`<rect class="ghost" x="${x - w / 2}" y="${half + y - h / 2}" width="${w}" height="${h}" rx="5"/>`,
  )}</svg></div><p class="sr-only">Lendo os termos em alta.</p>`
  const about = $('risingAbout')
  if (about) about.textContent = ''
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

// Figure 5 (issue #147): one word mark per day, no colour hue (--wc stays --ink in atlas.css),
// a data-day alongside data-term/data-kind since a rising-style word belongs to one day only.
const weekWordMarkup = (
  d: { term: string; kind: string; count: number; text: string; x: number; y: number; size: number; w: number; h: number },
  centerX: number,
  half: number,
  day: string,
  isSelected: boolean,
) =>
  html`<g class="week-word ${isSelected ? 'is-selected' : ''}" transform="translate(${centerX + d.x},${half + d.y})" style="--size:${d.size}px" data-term="${d.term}" data-kind="${d.kind}" data-day="${day}" role="button" tabindex="0" aria-pressed="${String(isSelected)}" aria-label="${d.text}, ${fmt(d.count)} documentos neste dia"><title>${d.text} · ${kinds[d.kind] || d.kind || 'Tipo desconhecido'} · ${fmt(d.count)} documentos</title><rect class="week-glow" x="${-d.w / 2 - 4}" y="${-d.h / 2 - 3}" width="${d.w + 8}" height="${d.h + 6}" rx="8"/><rect class="week-hit" x="${-d.w / 2}" y="${-d.h / 2}" width="${d.w}" height="${d.h}" rx="5"/><text class="week-text" text-anchor="middle" dominant-baseline="central">${d.text}</text></g>`

const weekOverflowMarkup = (
  overflow: { term: string; kind: string; text: string }[],
  day: string,
  selected: { day: string; term: string; kind: string } | null,
) =>
  overflow.length
    ? html`<div class="week-overflow"><p>${fmt(overflow.length)} ${overflow.length === 1 ? 'palavra não coube' : 'palavras não couberam'} nesta coluna. Todas continuam clicáveis aqui:</p>${overflow.map((d) => {
        const isSelected = !!selected && selected.day === day && selected.term === d.term && selected.kind === d.kind
        return html`<button class="quiet-button ${isSelected ? 'is-selected' : ''}" data-term="${d.term}" data-kind="${d.kind}" data-day="${day}" aria-pressed="${String(isSelected)}">${d.text}</button>`
      })}</div>`
    : ''

const weekColumnMarkup = (
  bucket: WeekBucket,
  layout: WeekColumnLayout<{ term: string; kind: string; count: number }>,
  width: number,
  selected: { day: string; term: string; kind: string } | null,
) => {
  const day = weekDayIso(bucket.start)
  const dayLabel = weekDayLabel(bucket.start)
  const isSelected = (d: { term: string; kind: string }) => !!selected && selected.day === day && selected.term === d.term && selected.kind === d.kind
  const body = layout.words.length
    ? html`<svg class="week-svg" viewBox="0 0 ${width} ${layout.height}" width="${width}" height="${layout.height}" role="group" aria-label="Palavras de ${dayLabel}">${layout.words.map((d) => weekWordMarkup(d, width / 2, layout.half, day, isSelected(d)))}</svg>`
    : html`<p class="empty-note">${bucket.about ? 'Sem palavras sobrevivendo ao corte neste dia.' : 'Sem documentos neste dia.'}</p>`
  return html`<div class="week-day"><dl class="stat"><div><dt>${dayLabel}</dt><dd>${fmt(bucket.about)}</dd></div></dl>${body}${weekOverflowMarkup(layout.overflow, day, selected)}</div>`
}

// Draws #weekChart and wires every word's click/keydown, in the svg and in each column's own
// overflow list alike. #weekNote states the one empty-week sentence; a day with about-docs but
// no surviving terms says so inline instead (weekColumnMarkup), never inventing a mark.
export const paintWeek = ({
  data,
  metrics,
  selected,
  onPick,
  width = WEEK_COLUMN_WIDTH,
}: {
  data: Week
  metrics: Measure
  selected: { day: string; term: string; kind: string } | null
  onPick: (day: string, term: string, kind: string) => void
  width?: number
}) => {
  const chart = $('weekChart')
  if (!chart) return
  chart.hidden = false
  chart.classList.remove('is-loading')
  chart.setAttribute('aria-busy', 'false')
  const layouts = weekLayout(metrics, data.buckets.map((b) => b.terms), width)
  chart.innerHTML = html`<div class="week-columns">${data.buckets.map((bucket, i) => weekColumnMarkup(bucket, layouts[i], width, selected))}</div>`
  for (const el of queryAll('[data-term]', chart)) {
    const pick = () => onPick(String(el.dataset.day), String(el.dataset.term), String(el.dataset.kind))
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
  const note = $('weekNote')
  if (note) note.textContent = data.buckets.every((b) => !b.terms.length) ? 'Não há palavras suficientes nesta semana.' : ''
}

const WEEK_GHOST_WORDS: [number, number][] = [
  [-30, 44],
  [18, 78],
  [-14, 112],
]

// A ghost of seven columns, one .stat placeholder and a few ghost marks each — never the word
// "Carregando" (CLAUDE.md's rule for every figure's loading state).
export const paintWeekLoading = () => {
  const chart = $('weekChart')
  if (!chart) return
  chart.hidden = false
  chart.classList.remove('is-loading')
  chart.setAttribute('aria-busy', 'true')
  const width = WEEK_COLUMN_WIDTH
  const height = 150
  chart.innerHTML = html`<div class="ghost-field" aria-hidden="true"><div class="week-columns">${Array.from(
    { length: 7 },
    () =>
      html`<div class="week-day">${ghostBar('ghost-line is-short')}<svg class="week-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${WEEK_GHOST_WORDS.map(
        ([y, w]) => html`<rect class="ghost" x="${width / 2 - w / 2}" y="${y}" width="${w}" height="16" rx="5"/>`,
      )}</svg></div>`,
  )}</div></div><p class="sr-only">Lendo a semana.</p>`
  const note = $('weekNote')
  if (note) note.textContent = ''
}

export const paintWeekError = () => {
  const chart = $('weekChart')
  if (!chart) return
  chart.hidden = false
  chart.classList.remove('is-loading')
  chart.setAttribute('aria-busy', 'false')
  chart.innerHTML = '<p class="note">Não foi possível carregar a semana.</p>'
  const note = $('weekNote')
  if (note) note.textContent = ''
}
