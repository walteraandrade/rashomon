// DOM layer: painters only — all data and callbacks arrive as parameters.

import {
  agendaRows,
  balanceColor,
  domainSuffix,
  fmt,
  html,
  kinds,
  label,
  LEAN_LABELS,
  matching,
  mergeOutlets,
  normalize,
  personInitials,
  type Persistence,
  relatedTo,
  safeDocUrl,
  score,
  seriesWeeks,
  shiftDate,
  sinceLabel,
  todayBrt,
  scoreName,
  foldTestimonyDomains,
  MASK_MIN,
  signed,
  sourceLabels,
  termMask,
  themeMask,
  testimonyClass,
  testimonyColor,
  testimonyFocus,
  testimonyPosition,
  trendOf,
  type Agenda,
  type AttentionDay,
  type AttentionMentionDay,
  type Candidate,
  type Comention,
  type Compare,
  type CompareSide,
  type CompareTerm,
  type Doc,
  type Graph,
  type Layout,
  type Lenses,
  type Link,
  type MaskState,
  type Measure,
  type OutletRow,
  type PersonRef,
  type PersonTestimony,
  type PlacedTerm,
  type Rising,
  type RisingAbout,
  type RisingTerm,
  type Sparkline,
  type Term,
  type Testimony,
  type TestimonyDomainRow,
  type Week,
  type WeekBucket,
  weekDayIso,
  weekDayLabel,
  weekHeadLabel,
  weekSpanLabel,
} from './format.js'
import { ATTENTION_ROW_WIDTH, FONT_MONO, RULER_PAD, WEEK_COLUMN_WIDTH, attentionLayout, matrixLayout, peakDay, persistenceLayout, rulerLayout, routesFrom, swarm, weekLayout, type AttentionMark, type RulerItem, type WeekColumnLayout } from './layout.js'
import { axis, frame, overflowList } from './marks.js'

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

export const wordMarkup = (p: PlacedTerm, sort: string, personScore: number | null = null, ranking: Map<number, number> = new Map()) => {
  const mask = termMask(p, personScore)
  const theme = themeMask(p, ranking)
  const t = p.testimony
  const testimonyNote = t ? ` · avaliação ${signed(t.score)} em ${fmt(t.n)} textos` : ''
  return html`<g class="atlas-word" data-kind="${p.kind}" transform="translate(${p.x},${p.y})" style="--size:${p.size}px${mask ? `;--mask:${mask}` : ''}${theme ? `;--theme:${theme}` : ''}" data-node="${p.id}" role="button" tabindex="0" aria-pressed="false" aria-label="${label(p)}, ${fmt(p.count)} documentos; ${scoreName(sort)}: ${fmt(p.score)}"><title>${label(p)} · ${kinds[p.kind] || p.kind || 'Tipo desconhecido'} · ${fmt(p.count)} documentos · ${scoreName(sort)}: ${fmt(p.score)}${testimonyNote}</title><rect class="atlas-glow" x="${-p.w / 2 - 4}" y="${-p.h / 2 - 3}" width="${p.w + 8}" height="${p.h + 6}"/><rect class="atlas-hit" x="${-p.w / 2}" y="${-p.h / 2}" width="${p.w}" height="${p.h}"/><text class="atlas-text" text-anchor="middle" dominant-baseline="central">${p.lines.map((line, i) => html`<tspan x="0" y="${(i - (p.lines.length - 1) / 2) * p.lineHeight}">${line}</tspan>`)}</text><line class="underline" x1="${-Math.min(p.w * 0.35, 40)}" x2="${Math.min(p.w * 0.35, 40)}" y1="${p.h / 2 - 2}" y2="${p.h / 2 - 2}"/></g>`
}

// The legend entry for the mask, hidden until the mask is on (paintSelection flips it).
const maskLegend = (person: PersonTestimony | undefined) =>
  person && person.score !== null
    ? html`<span id="maskLegend" hidden><span class="mask-scale" aria-hidden="true"></span>Cor = avaliação dos textos com a palavra contra a média da pessoa (${signed(person.score)}): vermelho mais hostil, verde mais favorável, cinza igual ou com menos de ${MASK_MIN} textos avaliados</span>`
    : html`<span id="maskLegend" hidden>Sem avaliação neste recorte para colorir as palavras.</span>`

// Names build coverage, never a document-count floor, so it reads nothing like maskLegend's MASK_MIN copy.
const themeLegend = (ranking: Map<number, number>, builtAt?: string) =>
  ranking.size > 0
    ? html`<span id="themeLegend" hidden>Cor = tema: palavras que caminharam juntas nesta construção do grafo. Os números não têm nome e não são comparáveis entre construções${builtAt ? ` (construída em ${builtAt})` : ''}.</span>`
    : html`<span id="themeLegend" hidden>Esta construção não tem temas calculados para este recorte.</span>`

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
  ranking = new Map(),
}: {
  layout: Layout
  personName: string
  about: number | undefined
  mode: string
  sort: string
  onChoose: (id: string) => void
  onShowPerson?: () => void
  personTestimony?: PersonTestimony
  ranking?: Map<number, number>
}) => {
  const { placed, overflow, center: c } = layout
  const textY = -((c.lines.length - 1) * c.lineHeight) / 2
  const mapBody = html`<defs><radialGradient id="halo"><stop class="halo-in" offset="0"/><stop class="halo-out" offset="1"/></radialGradient></defs><circle r="350" fill="url(#halo)"/><circle class="boundary" r="360"/><path d="M-7,-360 H7 M-7,360 H7 M-360,-7 V7 M360,-7 V7" stroke="var(--accent)" stroke-width="2" opacity=".7"/><g id="edges"></g><g class="center-label" data-person-docs role="button" tabindex="0" aria-label="Ler os ${fmt(about)} documentos sobre ${personName}"><rect class="center-hit" x="${-c.w / 2}" y="${-c.h / 2}" width="${c.w}" height="${c.h}" rx="10"/><text class="micro" text-anchor="middle" y="${-c.h / 2 + 23}">NO CENTRO DA CONVERSA</text><text class="person-name" style="--size:${c.size}px" text-anchor="middle" dominant-baseline="central">${c.lines.map((line, i) => html`<tspan x="0" y="${textY + i * c.lineHeight}">${line}</tspan>`)}</text><path d="M-18,${c.h / 2 - 35} H18" stroke="var(--accent)" opacity=".65"/><text class="center-note" text-anchor="middle" y="${c.h / 2 - 10}">${fmt(about)} documentos</text></g><g id="words">${placed.map((p) => wordMarkup(p, sort, personTestimony?.score ?? null, ranking))}</g><text class="micro" x="0" y="392" text-anchor="middle">UM RECORTE DA CONVERSA · NÃO UM JUÍZO DE VALOR</text>`
  $('viewport').innerHTML = html`<div class="map-stage">${frame({ cls: 'map-svg', viewBox: '-430 -402 860 804', ariaLabel: `Mapa de palavras associadas a ${personName}` }, mapBody)}</div>`
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
  $('legend').innerHTML = html`<span><span class="type-scale"><span>Aa</span><span>Aa</span></span>Tamanho = ${sort === 'pmi' ? 'PMI × ln(1 + documentos)' : 'frequência em documentos'}</span><span><i></i>Linha = documentos em comum; só aparece ao selecionar</span><span>Tab + Enter para selecionar · zoom e rolagem para ampliar</span><span id="routeNote"></span>${maskLegend(personTestimony)}${themeLegend(ranking)}`
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
  mask = 'avaliacao',
  personTestimony,
  ranking = new Map(),
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
  mask?: MaskState
  personTestimony?: PersonTestimony
  ranking?: Map<number, number>
}) => {
  const related = new Set(selected ? relatedTo(nodes, links, selected).map((r) => r.node.id) : [])
  const normalizedSearch = normalize(search)
  const masked = mask === 'avaliacao' && personTestimony?.score !== null && personTestimony?.score !== undefined
  const themed = mask === 'tema'
  $('viewport').querySelector('svg')?.classList.toggle('is-masked', masked)
  $('viewport').querySelector('svg')?.classList.toggle('is-themed', themed)
  $('columns').classList.toggle('is-masked', masked)
  $('columns').classList.toggle('is-themed', themed)
  if ($('maskLegend')) $('maskLegend').hidden = mask !== 'avaliacao'
  if ($('themeLegend')) $('themeLegend').hidden = mask !== 'tema'
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
  paintColumns({ nodes, links, selected, search, sort, mode, onChoose, onShowPerson, personName, about, personTestimony, ranking })
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
  ranking = new Map(),
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
  ranking?: Map<number, number>
}) => {
  if (mode !== 'columns' || !nodes.length) return
  const related = new Set(selected ? relatedTo(nodes, links, selected).map((r) => r.node.id) : [])
  const normalizedSearch = normalize(search)
  const personRow = html`<div class="column-person" data-person-docs role="button" tabindex="0" aria-label="Ler os ${fmt(about)} documentos sobre ${personName}"><span>No centro da conversa · ${fmt(about)} documentos</span><strong>${personName}</strong></div>`
  $('columns').innerHTML = html`${personRow}${nodes.map((n, i) => {
    const dim = normalizedSearch ? !matching(n, search) : selected && n.id !== selected && !related.has(n.id)
    const mask = termMask(n, personTestimony?.score ?? null)
    const theme = themeMask(n, ranking)
    const t = n.testimony
    return html`<button class="column-card ${selected === n.id ? 'is-selected' : ''} ${dim ? 'is-dim' : ''}" data-col="${n.id}"${
      mask && theme ? html` style="--mask:${mask};--theme:${theme}"` : mask ? html` style="--mask:${mask}"` : theme ? html` style="--theme:${theme}"` : ''
    }><span>${String(i + 1).padStart(2, '0')} · ${kinds[n.kind] || n.kind || 'Tipo desconhecido'} · ${fmt(n.count)} docs · ${scoreName(sort)}: ${fmt(score(n, sort))}${t ? ` · avaliação ${signed(t.score)}` : ''}</span><strong>${label(n)}</strong></button>`
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
// empty, no bars and no note (the spec's "hole stays empty"); 'loading' is a ghost of the same
// seven bars.
const sparklineMarkup = (spark?: Sparkline) => {
  if (!spark) return ''
  if (spark.state === 'error') return html`<div class="sparkline" aria-hidden="true"></div>`
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
  mask,
}: {
  graph: Graph | null
  nodes: Term[]
  links: Link[]
  selected: string | null
  sort: string
  daysLabel: string
  onChoose: (id: string) => void
  sparkline?: Sparkline
  mask?: MaskState
}) => {
  const n = nodes.find((n) => n.id === selected)
  if (!n) {
    $('inspector').innerHTML = html`<p class="eyebrow">A pessoa no centro</p><h3>${graph?.person?.name || ''}</h3><dl class="metric stat"><div><dt>documentos sobre a pessoa</dt><dd>${fmt(graph?.stats?.about)}</dd></div><div><dt>termos no recorte</dt><dd>${nodes.length}</dd></div></dl><p>Sem seleção, o atlas mostra um campo limpo: nenhuma ligação termo-termo fica visível.</p><p class="eyebrow">Comece por · ${scoreName(sort)}</p><div class="related">${relatedButtons(nodes.slice(0, 5).map((node) => ({ node })), sort, false)}</div>`
  } else {
    const related = relatedTo(nodes, links, n.id)
    // Only in tema mode, and only when another node on the map shares the community — never an empty heading.
    const communityMates =
      mask === 'tema' && n.community !== null && n.community !== undefined ? nodes.filter((o) => o.id !== n.id && o.community === n.community) : []
    $('inspector').innerHTML = html`<p class="eyebrow">${kinds[n.kind] || n.kind || 'Tipo desconhecido'} em foco</p><h3 tabindex="-1" id="termHeading">${label(n)}</h3><dl class="metric stat"><div><dt>documentos</dt><dd>${fmt(n.count)}</dd></div><div><dt>PMI bruto</dt><dd>${fmt(n.pmi)}</dd></div></dl><p><strong class="score-highlight">${fmt(score(n, sort))}</strong> ${scoreName(sort)} · score usado no tamanho.</p>${testimonyLine(n, graph?.stats?.testimony)}${sparklineMarkup(sparkline)}<p>${graph?.person.name ?? ''} · ${daysLabel}.</p><p class="eyebrow">Aparece junto com · docs</p><div class="related">${related.length ? relatedButtons(related, sort) : html`<p class="empty-note">Nenhuma relação retornada neste recorte.</p>`}</div>${communityMates.length ? html`<p class="eyebrow">No mesmo tema</p><div class="related">${relatedButtons(communityMates.map((node) => ({ node })), sort, false)}</div>` : ''}`
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
  const outletRow = (r: (typeof merged)[number]) => {
    const cells = html`<span class="d">${r.domain}</span><span class="n">${fmt(r.docs)}</span><span class="t">${r.score === null ? '' : signed(r.score)}</span>`
    // A row keyed by a source name folds that source's host-less docs (Bluesky posts, whose
    // stored domain is an author handle): a count, never an outlet to focus on.
    const button = r.sources.includes(r.domain)
      ? html`<span class="outlet is-static" title="Textos sem veículo nesta fonte">${cells}</span>`
      : html`<button class="outlet ${r.domain === domain ? 'is-active' : ''}" data-domain="${r.domain}" aria-pressed="${String(r.domain === domain)}" style="--tone:${testimonyColor(r.score)}" title="${r.sources.map((x) => sourceLabels[x] ?? x).join(', ')}">${cells}</button>`
    if (r.domain !== domain) return button
    const neighborLines = r.neighbors.slice(0, 5)
    return html`${button}<dl class="metric stat"><div><dt>Vocabulário mais parecido com</dt><dd>${
      neighborLines.length
        ? neighborLines.map((nb) => html`<span class="outlet-neighbor">${nb.domain} · <span class="n">${nb.similarity.toFixed(2)}</span></span>`)
        : 'Nenhum veículo com vocabulário parecido neste recorte'
    }</dd></div></dl>`
  }
  // Groups by field: a numbered group's eyebrow names its top-3 domains (by docs desc), never
  // the field int itself; field: null rows form their own trailing, unnumbered group.
  const groups = new Map<number, (typeof merged)[number][]>()
  const ungrouped: (typeof merged)[number][] = []
  for (const r of merged) {
    if (r.field === null || r.field === undefined) ungrouped.push(r)
    else {
      const g = groups.get(r.field) ?? []
      g.push(r)
      groups.set(r.field, g)
    }
  }
  const groupMarkup = (eyebrow: string, group: (typeof merged)[number][]) =>
    html`<p class="eyebrow">${eyebrow}</p><div class="outlet-grid">${group.map(outletRow)}</div>`
  // The field int is a build-local Louvain label, never a rank: groups order by their own docs.
  const byDocs = (a: (typeof merged)[number], b: (typeof merged)[number]) => b.docs - a.docs || a.domain.localeCompare(b.domain)
  const docsOf = (g: (typeof merged)[number][]) => g.reduce((n, r) => n + r.docs, 0)
  const groupSections = [
    ...[...groups.values()]
      .map((g) => g.slice().sort(byDocs))
      .sort((a, b) => docsOf(b) - docsOf(a) || a[0].domain.localeCompare(b[0].domain))
      .map((g) => groupMarkup(`grupo · ${g.slice(0, 3).map((r) => r.domain).join(', ')}`, g)),
    ...(ungrouped.length ? [groupMarkup('Sem agrupamento suficiente', ungrouped)] : []),
  ]
  $('outletList').innerHTML = merged.length
    ? html`${groupSections}<p class="note">Documentos no recorte e, quando o veículo tem 3 ou mais textos avaliados, a nota de −10 a +10 que o kikori (${testimony?.method ?? ''}) dá a cada texto sobre a pessoa. Compare veículos falando da mesma pessoa; não compare pessoas entre si. Grupos e vocabulário parecido vêm da construção da janela, não da consulta ao vivo, e podem ficar desatualizados entre construções.</p>`
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
  viewport.innerHTML = html`<div class="map-stage" aria-hidden="true">${frame(
    { cls: 'map-svg', viewBox: '-430 -402 860 804' },
    html`<defs><radialGradient id="halo"><stop class="halo-in" offset="0"/><stop class="halo-out" offset="1"/></radialGradient></defs><circle r="350" fill="url(#halo)"/><circle class="boundary" r="360"/><path d="M-7,-360 H7 M-7,360 H7 M-360,-7 V7 M360,-7 V7" stroke="var(--accent)" stroke-width="2" opacity=".7"/><g class="ghost-field">${ATLAS_GHOST_WORDS.map(
      ([x, y, w, h]) => html`<rect class="ghost" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="6"/>`,
    )}<rect class="ghost" x="-72" y="-26" width="144" height="52" rx="10"/></g>`,
  )}</div>`
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
  strip.innerHTML = html`<div class="ghost-field" aria-hidden="true"><div class="strip-mean-row"></div>${frame(
    { cls: 'strip-svg', width, height, viewBox: `0 0 ${width} ${height}` },
    html`${axis({ x0: STRIP_PAD, x1: width - STRIP_PAD, y: half, ticks: [-10, -5, 0, 5, 10].map((s) => STRIP_PAD + ((s + 10) / 20) * (width - 2 * STRIP_PAD)), cls: 'strip' })}${STRIP_GHOST_DOTS.map(([x, r]) => html`<circle class="ghost" cx="${x}" cy="${half}" r="${r}"/>`)}`,
  )}<div class="strip-axis-labels"><span>−10 contra</span><span>0</span><span>+10 a favor</span></div></div>`
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
  strip.innerHTML = html`<div class="strip-mean-row"><span class="strip-mean" style="--pos:${testimonyPosition(overall)}%">média da pessoa ${signed(overall)}</span></div>${frame(
    { cls: 'strip-svg', width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', ariaLabel: 'Veículos na régua da avaliação, de −10 a +10' },
    html`${axis({ x0: STRIP_PAD, x1: width - STRIP_PAD, y: half, ticks: [-10, -5, 0, 5, 10].map(x), cls: 'strip' })}<line class="strip-overall" x1="${x(overall)}" x2="${x(overall)}" y1="4" y2="${height - 4}"/>${dots.map(
      (d) =>
        html`<g class="strip-dot ${d.domain === domain ? 'is-active' : ''}" style="--tone:${testimonyColor(d.score)}" data-strip-domain="${d.domain}" role="button" tabindex="0" aria-pressed="${String(d.domain === domain)}" aria-label="${d.domain}, ${signed(d.score)} em ${fmt(d.n)} textos"><title>${d.domain} · ${d.sources.map((s) => sourceLabels[s] ?? s).join(', ')} · ${signed(d.score)} em ${fmt(d.n)} ${d.n === 1 ? 'texto' : 'textos'}</title><circle class="dot-halo" cx="${d.x}" cy="${half + d.y}" r="${d.r + 5}"/><circle class="dot-face" cx="${d.x}" cy="${half + d.y}" r="${d.r}"/></g>`,
    )}`,
  )}<div class="strip-axis-labels"><span>−10 contra</span><span>0</span><span>+10 a favor</span></div><p class="note">Uma bolinha por veículo com 3 ou mais textos avaliados; o tamanho é quantos textos. Toque numa bolinha para destacá-la aqui${domain === 'all' ? '' : '; toque de novo, ou fora das bolinhas, para soltar'}. O atlas acima não muda.</p>`
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
  strip.innerHTML = html`${hasMean ? html`<div class="strip-mean-row"><span class="strip-mean" style="--pos:${((x(overall as number) - STRIP_PAD) / Math.max(1, width - 2 * STRIP_PAD)) * 100}%">média da pessoa ${signed(overall)}</span></div>` : ''}${frame(
    { cls: 'strip-svg', width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', ariaLabel: 'Palavras na régua da avaliação' },
    html`${axis({ x0: STRIP_PAD, x1: width - STRIP_PAD, y: half, ticks: ticks.map(x), cls: 'strip' })}${hasMean ? html`<line class="strip-overall" x1="${x(overall as number)}" x2="${x(overall as number)}" y1="4" y2="${height - 4}"/>` : ''}${dots.map((d) => {
      const dim = normalizedSearch ? !matching({ term: d.term, kind: d.kind }, search) : false
      return html`<g class="strip-dot ${dim ? 'is-dim' : ''}" data-node="${d.id}" style="--tone:${d.tone}" role="button" tabindex="0" aria-label="${d.term}, avaliação ${signed(d.score)} em ${fmt(d.count)} ${d.count === 1 ? 'texto' : 'textos'}"><title>${d.term} · avaliação ${signed(d.score)} em ${fmt(d.count)} ${d.count === 1 ? 'texto' : 'textos'}</title><circle class="dot-halo" cx="${d.x}" cy="${half + d.y}" r="${d.r + 5}"/><circle class="dot-face" cx="${d.x}" cy="${half + d.y}" r="${d.r}"/></g>`
    })}`,
  )}<div class="strip-axis-labels"><span>${signed(domainMin)} contra</span><span>${signed(domainMax)} a favor</span></div>`
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

export const BRIDGE_THRESHOLD = 0.5

const isBridge = (t: { bridge?: number }) => (t.bridge ?? 0) >= BRIDGE_THRESHOLD

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
  d: { term: string; kind: string; text: string; balance: number; combined: number; bridge?: number; x: number; y: number; size: number; w: number; h: number },
  half: number,
  isSelected: boolean,
) =>
  html`<g class="ruler-word ${isSelected ? 'is-selected' : ''} ${isBridge(d) ? 'ruler-bridge' : ''}" transform="translate(${d.x},${half + d.y})" style="--size:${d.size}px;--cmp:${balanceColor(d.balance)}" data-term="${d.term}" data-kind="${d.kind}" role="button" tabindex="0" aria-pressed="${String(isSelected)}" aria-label="${d.text}, ${fmt(d.combined)} documentos"><title>${d.text} · ${kinds[d.kind] || d.kind || 'Tipo desconhecido'} · ${fmt(d.combined)} documentos</title><rect class="ruler-glow" x="${-d.w / 2 - 4}" y="${-d.h / 2 - 3}" width="${d.w + 8}" height="${d.h + 6}"/><rect class="ruler-hit" x="${-d.w / 2}" y="${-d.h / 2}" width="${d.w}" height="${d.h}"/><text class="ruler-text" text-anchor="middle" dominant-baseline="central"><tspan x="0" y="0">${d.text}</tspan></text>${isBridge(d) ? html`<line class="ruler-bridge-mark" x1="${-d.w / 2}" x2="${d.w / 2}" y1="${d.h / 2}" y2="${d.h / 2}"/>` : ''}</g>`

// Overflow words: count stated, each still a button with the same data-term/data-kind.
const rulerOverflowMarkup = (
  overflow: { term: string; kind: string; text: string; balance: number }[],
  selected: { term: string; kind: string } | null,
) =>
  overflowList({
    items: overflow,
    cls: 'ruler',
    intro: html`<p>${fmt(overflow.length)} ${overflow.length === 1 ? 'palavra não coube' : 'palavras não couberam'} na régua sem cobrir as outras. Todas continuam clicáveis aqui:</p>`,
    renderItem: (d) => {
      const isSelected = !!selected && selected.term === d.term && selected.kind === d.kind
      return html`<button class="quiet-button ${isSelected ? 'is-selected' : ''}" data-term="${d.term}" data-kind="${d.kind}" aria-pressed="${String(isSelected)}" style="--cmp:${balanceColor(d.balance)}">${d.text}</button>`
    },
  })

// Shared by figure 3 (compare) and figure 4 (rising): draws a ruler's end labels, SVG axis and
// words, axis labels and overflow list, and wires click/keydown on every word. The two figures
// differ only in which items they hand it and how they word the ends/axis/note — the packing
// (`rulerLayout`) and the per-word markup are the same for both. `note` is figure-specific prose
// between the axis and the overflow list; `tail` comes after that list. Rising says its own
// numbers in `#risingAbout` and uses `tail` for its rare risers.
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
  tail = '',
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
  tail?: ReturnType<typeof html> | string
}) => {
  const ruler = $(elementId)
  const { words, overflow, x, half, height } = rulerLayout(metrics, items, width)
  ruler.innerHTML = html`<div class="ruler-end-row"><span class="ruler-end cmp-a">${endA}</span><span class="ruler-end cmp-b">${endB}</span></div>${frame(
    { cls: 'ruler-svg', width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', ariaLabel },
    html`${axis({ x0: RULER_PAD, x1: width - RULER_PAD, y: half, ticks: [-1, -0.5, 0, 0.5, 1].map(x), cls: 'ruler' })}${words.map((d) => rulerWordMarkup(d, half, !!selected && selected.term === d.term && selected.kind === d.kind))}`,
  )}<div class="ruler-axis-labels"><span>${axisLabels[0]}</span><span>${axisLabels[1]}</span><span>${axisLabels[2]}</span></div>${note}${rulerOverflowMarkup(overflow, selected)}${tail}`
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

export type RisingShares = RisingAbout & { words_recent: number; words_baseline: number }

// A payload cached before `present`/`about.words_*` existed must not paint NaN positions, so
// the share rule applies only when both totals arrived; otherwise the ruler falls back to the
// older person-lift rule below, with that rule's own axis prose.
export const hasShares = (data: Rising): data is Rising & { present: RisingTerm[]; about: RisingShares } =>
  Array.isArray(data.present) && Number.isFinite(data.about.words_recent) && Number.isFinite(data.about.words_baseline)

// balance = clamp(log2(share now / share before) / 3, -1, 1), where a share is the term's doc
// count over every doc_terms row about the person in that window (about.words_*): a word right
// of centre takes a bigger slice of what is written about her this week than it did before,
// left a smaller one. Shares, not doc counts, so a corpus whose texts grew longer (more words
// per doc) does not push every word right at once; the baseline's +1 is the server's own
// smoothing, which keeps this finite. No baseline words at all means every word is new.
export const shareBalance = (t: { count_recent_raw: number; count_baseline_raw: number }, about: RisingShares) => {
  if (about.words_baseline <= 0) return t.count_recent_raw > 0 ? 1 : 0
  if (about.words_recent <= 0) return -1
  const ratio = (t.count_recent_raw / about.words_recent) / ((t.count_baseline_raw + 1) / about.words_baseline)
  return Math.max(-1, Math.min(1, Math.log2(ratio) / 3))
}

// The fallback rule: clamp(log2(word's lift / the person's own lift) / 3, -1, 1). About.baseline's
// +1 smoothing (the server's own, per term) keeps this finite with no baseline docs at all.
export const liftOfPerson = (about: { recent: number; baseline: number }, days: number, baselineDays: number) => about.recent / days / ((about.baseline + 1) / baselineDays)

export const liftBalance = (t: { lift: number }, liftPerson: number) => {
  const ratio = liftPerson > 0 ? t.lift / liftPerson : t.lift > 0 ? Infinity : 1
  return Math.max(-1, Math.min(1, Math.log2(ratio) / 3))
}

export type RisingItem = RulerItem & { lift: number }

// combined = count_recent_raw + count_baseline_raw, the exact doc counts behind the rounded
// rates, so a word's size on the ruler never compounds the server's own rounding.
export const risingRulerItems = (terms: RisingTerm[], balance: (t: RisingTerm) => number): RisingItem[] =>
  terms.map((t) => ({ term: t.term, kind: t.kind, lift: t.lift, balance: balance(t), combined: t.count_recent_raw + t.count_baseline_raw }))

// The risers off the ruler: the route's `terms` (the highest lifts) minus what `present` already
// rules, and only those that actually rose (lift > 1, recent rate above the smoothed baseline
// rate), in the route's own lift order. Listed under the ruler as buttons that pick like any
// other word, coloured by the same share balance. The page shows the first RARE_SHOWN so the
// list stays a line or two, and says how many it left out.
export const RARE_SHOWN = 12

export const rareRisers = (terms: RisingTerm[], present: RisingTerm[]) => {
  const ruled = new Set(present.map((t) => `${t.kind}:${t.term}`))
  return terms.filter((t) => t.lift > 1 && !ruled.has(`${t.kind}:${t.term}`))
}

const rareMarkup = (all: RisingItem[], selected: { term: string; kind: string } | null) => {
  const rare = all.slice(0, RARE_SHOWN)
  if (!rare.length) return ''
  const count = all.length > rare.length ? `${fmt(rare.length)} de ${fmt(all.length)} palavras` : `${fmt(rare.length)} ${rare.length === 1 ? 'palavra' : 'palavras'}`
  return html`<div class="ruler-overflow ruler-rare"><p>Fora da régua, ${count} com poucos textos na semana, mas mais que antes, da maior subida para a menor:</p>${rare.map((d) => {
    const isSelected = !!selected && selected.term === d.term && selected.kind === d.kind
    return html`<button class="quiet-button ${isSelected ? 'is-selected' : ''}" data-term="${d.term}" data-kind="${d.kind}" aria-pressed="${String(isSelected)}" style="--cmp:${balanceColor(d.balance)}">${label(d)}</button>`
  })}</div>`
}

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
  const shares = hasShares(data)
  const balance = shares ? (t: RisingTerm) => shareBalance(t, data.about) : ((lp) => (t: RisingTerm) => liftBalance(t, lp))(liftOfPerson(data.about, data.days, data.baseline))
  const items = risingRulerItems(shares ? data.present : data.terms, balance)
  const rare = shares ? risingRulerItems(rareRisers(data.terms, data.present), balance) : []
  if (!items.length && !rare.length) {
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
    axisLabels: shares ? ['Fatia menor que antes', 'mesma fatia', 'Fatia maior que antes'] : ['Mais devagar que a pessoa', 'no mesmo ritmo', 'Mais rápido que a pessoa'],
    ariaLabel: 'Régua de termos em alta',
    note: '',
    tail: rareMarkup(rare, selected),
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

// Figure 6 (issue #206): one person, two independently-scoped lenses on the compare ruler's own
// body. Unlike paintRuler, position is always pmi * ln(1 + count) — there is no measure select on
// this figure — and the two ends are lens labels (lensLabel), not people.
export const paintLensRuler = ({
  data,
  endA,
  endB,
  metrics,
  selected,
  onPick,
  width = 860,
}: {
  data: Lenses
  endA: string
  endB: string
  metrics: Measure
  selected: { term: string; kind: string } | null
  onPick: (term: string, kind: string) => void
  width?: number
}) => {
  const ruler = $('lensesRuler')
  const { items, hiddenCount } = rulerTerms(data.terms, 'pmi')
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
  const note = html`<p class="note">Cada palavra está escrita onde ela pende, e o tamanho dela é quantos documentos tem das duas lentes somados. Toque numa palavra para ver os números das duas lentes.</p>`
  const { shown, overflowCount } = paintRulerBody({
    elementId: 'lensesRuler',
    items,
    metrics,
    selected,
    onPick,
    width,
    endA,
    endB,
    axisLabels: [`Só de ${endA}`, 'dividida', `Só de ${endB}`],
    ariaLabel: `Régua comparando ${endA} e ${endB} para a mesma pessoa`,
    note,
  })
  return { hiddenCount, shown, overflowCount }
}

export const paintLensRulerError = () => {
  const ruler = $('lensesRuler')
  if (!ruler) return
  ruler.hidden = false
  ruler.classList.remove('is-loading')
  ruler.setAttribute('aria-busy', 'false')
  ruler.innerHTML = '<p class="note">Não foi possível carregar as lentes.</p>'
}

// Selected word's numbers on both lenses; a null side reads "nenhum documento" (measured zero),
// mirroring paintCompareDetail but keyed by lens label prose instead of a PersonRef.
export const paintLensDetail = ({ term, endA, endB }: { term: CompareTerm | null; endA: string; endB: string }) => {
  const el = $('lensesDetail')
  if (!el) return
  if (!term) {
    el.innerHTML = '<span class="empty-hint">Clique numa palavra para ver os números das duas lentes.</span>'
    return
  }
  const sideHtml = (endLabel: string, v: CompareSide | 'name' | null) =>
    v === 'name'
      ? html`<div><dt>${endLabel}</dt><dd class="empty-hint">nome da pessoa, fora da régua</dd></div>`
      : v
        ? html`<div><dt>${endLabel}</dt><dd><b>${fmt(v.count)}</b> documentos · PMI <b>${fmt(v.pmi)}</b></dd></div>`
        : html`<div><dt>${endLabel}</dt><dd class="empty-hint">nenhum documento</dd></div>`
  el.innerHTML = html`<span class="term">${label(term)}</span><dl class="detail-sides">${sideHtml(endA, term.a)}${sideHtml(endB, term.b)}</dl>${isBridge(term) ? html`<p class="detail-bridge">ponte: as duas lentes precisam dela</p>` : ''}`
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
    ruler.innerHTML = html`<div class="ghost-field" aria-hidden="true"><div class="ruler-end-row">${ghostBar('ghost-name')}${ghostBar('ghost-name')}</div>${frame(
      { cls: 'ruler-svg', width, height, viewBox: `0 0 ${width} ${height}` },
      html`${axis({ x0: pad, x1: width - pad, y: half, ticks: [-1, -0.5, 0, 0.5, 1].map((b) => pad + ((b + 1) / 2) * (width - 2 * pad)), cls: 'ruler' })}${RULER_GHOST_WORDS.map(
        ([x, y, w, h]) => html`<rect class="ghost" x="${x - w / 2}" y="${half + y - h / 2}" width="${w}" height="${h}" rx="5"/>`,
      )}`,
    )}</div><p class="sr-only">Lendo a régua.</p>`
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
  ruler.innerHTML = html`<div class="ghost-field" aria-hidden="true"><div class="ruler-end-row">${ghostBar('ghost-name')}${ghostBar('ghost-name')}</div>${frame(
    { cls: 'ruler-svg', width, height, viewBox: `0 0 ${width} ${height}` },
    html`${axis({ x0: pad, x1: width - pad, y: half, ticks: [-1, -0.5, 0, 0.5, 1].map((b) => pad + ((b + 1) / 2) * (width - 2 * pad)), cls: 'ruler' })}${RULER_GHOST_WORDS.map(
      ([x, y, w, h]) => html`<rect class="ghost" x="${x - w / 2}" y="${half + y - h / 2}" width="${w}" height="${h}" rx="5"/>`,
    )}`,
  )}</div><p class="sr-only">Lendo os termos em alta.</p>`
  const about = $('risingAbout')
  if (about) about.textContent = ''
}

// Figure 6's own boot/reload ghost: the same ruler geometry, inside #lensesRuler, plus
// #lensesDetail's own ghost (two sides, same shape paintCompareLoading's #compareDetail ghost
// paints).
export const paintLensesLoading = () => {
  const ruler = $('lensesRuler')
  if (ruler) {
    ruler.hidden = false
    ruler.classList.remove('is-loading')
    ruler.setAttribute('aria-busy', 'true')
    const width = 860
    const height = 88
    const half = 44
    const pad = 28
    ruler.innerHTML = html`<div class="ghost-field" aria-hidden="true"><div class="ruler-end-row">${ghostBar('ghost-name')}${ghostBar('ghost-name')}</div>${frame(
      { cls: 'ruler-svg', width, height, viewBox: `0 0 ${width} ${height}` },
      html`${axis({ x0: pad, x1: width - pad, y: half, ticks: [-1, -0.5, 0, 0.5, 1].map((b) => pad + ((b + 1) / 2) * (width - 2 * pad)), cls: 'ruler' })}${RULER_GHOST_WORDS.map(
        ([x, y, w, h]) => html`<rect class="ghost" x="${x - w / 2}" y="${half + y - h / 2}" width="${w}" height="${h}" rx="5"/>`,
      )}`,
    )}</div><p class="sr-only">Lendo as lentes.</p>`
  }
  const detail = $('lensesDetail')
  if (!detail) return
  detail.innerHTML = html`<div class="ghost-field" aria-hidden="true">${ghostBar('ghost-title')}<dl class="detail-sides"><div><dt>${ghostBar('ghost-kicker')}</dt><dd>${ghostBar('ghost-line is-short')}</dd></div><div><dt>${ghostBar('ghost-kicker')}</dt><dd>${ghostBar('ghost-line is-short')}</dd></div></dl></div>`
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
  el.innerHTML = html`<span class="term">${label(term)}</span><dl class="detail-sides">${sideHtml(personA, term.a)}${sideHtml(personB, term.b)}</dl>${isBridge(term) ? html`<p class="detail-bridge">ponte: liga os dois vocabulários</p>` : ''}`
}

// Figure 5 (issue #147): one word mark per day, no colour hue (--wc stays --ink in atlas.css),
// a data-day alongside data-term/data-kind since a rising-style word belongs to one day only.
// A wrapped phrase is one tspan per line, centred on the box: the box is d.h tall, so line i
// of n sits at (i - (n - 1) / 2) line heights from the middle.
const weekWordMarkup = (
  d: { term: string; kind: string; count: number; text: string; lines: string[]; x: number; y: number; size: number; w: number; h: number },
  centerX: number,
  half: number,
  day: string,
  isSelected: boolean,
) => {
  const lineHeight = d.h / d.lines.length
  const text = d.lines.map((line, i) => html`<tspan x="0" y="${(i - (d.lines.length - 1) / 2) * lineHeight}">${line}</tspan>`)
  return html`<g class="week-word ${isSelected ? 'is-selected' : ''}" transform="translate(${centerX + d.x},${half + d.y})" style="--size:${d.size}px" data-term="${d.term}" data-kind="${d.kind}" data-day="${day}" role="button" tabindex="0" aria-pressed="${String(isSelected)}" aria-label="${d.text}, ${fmt(d.count)} documentos neste dia"><title>${d.text} · ${kinds[d.kind] || d.kind || 'Tipo desconhecido'} · ${fmt(d.count)} documentos</title><rect class="week-glow" x="${-d.w / 2 - 4}" y="${-d.h / 2 - 3}" width="${d.w + 8}" height="${d.h + 6}"/><rect class="week-hit" x="${-d.w / 2}" y="${-d.h / 2}" width="${d.w}" height="${d.h}"/><text class="week-text" text-anchor="middle" dominant-baseline="central">${text}</text></g>`
}

// Size is the week's only encoding and a listed word has none, so the button carries the count.
// An eyebrow names the list: a 145px column turns a sentence into three lines, taller than
// the words it explains, and the guide (#help-semana, como-ler.html#semana) says why they are
// here. Under about 120px even "// Não couberam" wraps onto a second line.
const weekOverflowMarkup = (
  overflow: { term: string; kind: string; count: number; text: string }[],
  day: string,
  selected: { day: string; term: string; kind: string } | null,
) =>
  overflowList({
    items: overflow,
    cls: 'week',
    intro: html`<p class="eyebrow">${overflow.length === 1 ? 'Não coube' : 'Não couberam'}</p>`,
    renderItem: (d) => {
      const isSelected = !!selected && selected.day === day && selected.term === d.term && selected.kind === d.kind
      return html`<button class="quiet-button ${isSelected ? 'is-selected' : ''}" data-term="${d.term}" data-kind="${d.kind}" data-day="${day}" aria-pressed="${String(isSelected)}" aria-label="${d.text}, ${fmt(d.count)} documentos neste dia">${d.text}<b>${fmt(d.count)}</b></button>`
    },
  })

const weekColumnMarkup = (
  bucket: WeekBucket,
  layout: WeekColumnLayout<{ term: string; kind: string; count: number }>,
  width: number,
  selected: { day: string; term: string; kind: string } | null,
) => {
  const day = weekDayIso(bucket.start)
  const dayLabel = weekDayLabel(bucket.start)
  const isSelected = (d: { term: string; kind: string }) => !!selected && selected.day === day && selected.term === d.term && selected.kind === d.kind
  // A day with no words keeps only its number: the spec allows one sentence for the whole
  // week (#weekNote), never a line per empty column.
  const body = layout.words.length
    ? frame(
        { cls: 'week-svg', width, height: layout.height, viewBox: `0 0 ${width} ${layout.height}`, role: 'group', ariaLabel: `Palavras de ${dayLabel}` },
        html`${layout.words.map((d) => weekWordMarkup(d, width / 2, layout.half, day, isSelected(d)))}`,
      )
    : ''
  return html`<div class="week-day"><dl class="stat"><div><dt>${dayLabel}</dt><dd>${fmt(bucket.about)}</dd></div></dl>${body}${weekOverflowMarkup(layout.overflow, day, selected)}</div>`
}

// Draws #weekChart and wires every word's click/keydown, in the svg and in each column's own
// overflow list alike. #weekNote states the one empty-week sentence; an empty day shows its
// number and nothing under it, never an invented mark.
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
      html`<div class="week-day">${ghostBar('ghost-line is-short')}${frame(
        { cls: 'week-svg', width, height, viewBox: `0 0 ${width} ${height}` },
        html`${WEEK_GHOST_WORDS.map(
          ([y, w]) => html`<rect class="ghost" x="${width / 2 - w / 2}" y="${height / 2 + y - 8}" width="${w}" height="16" rx="5"/>`,
        )}`,
      )}</div>`,
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
  chart.innerHTML = html`<p class="note">Não foi possível carregar a semana.</p>`
  const note = $('weekNote')
  if (note) note.textContent = ''
}

// Figure 7 (issue #216): Wikipedia pageviews against press mentions, a bar-chart row each on a
// shared day axis, each sized off its own maximum. A row with no peak states "sem dado" instead.
const ATTENTION_ROW_HEIGHT = 64
const ATTENTION_BASELINE = ATTENTION_ROW_HEIGHT - 12

const dayWord = (n: number) => (n === 1 ? 'dia' : 'dias')

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

// lag > 0: views peaked after mentions (press led). lag < 0: views peaked first (public led).
const attentionLagSentence = (mentionsPeak: string, viewsPeak: string) => {
  const lag = daysBetween(mentionsPeak, viewsPeak)
  if (lag > 0) return `a imprensa veio ${lag} ${dayWord(lag)} antes`
  if (lag < 0) return `o público buscou ${Math.abs(lag)} ${dayWord(Math.abs(lag))} antes`
  return 'os dois picos caíram no mesmo dia'
}

// A peakless row already states its own "sem dado" in its head, so the shared note stays silent.
const attentionNoteText = (mentionsPeak: string | null, viewsPeak: string | null) => (mentionsPeak && viewsPeak ? attentionLagSentence(mentionsPeak, viewsPeak) : '')

// A '2026-08-03' day string read back as a short pt-BR label, in UTC -- never weekDayLabel's BRT.
export const attentionDayLabel = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`)
  const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' }).format(d).replace(/\.$/, '')
  const dom = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric' }).format(d)
  return `${weekday} ${dom}`
}

const ATTENTION_ROW_NOTE: Record<'mentions' | 'views', string> = {
  mentions: 'sem dado de menções para esta pessoa nesta janela',
  views: 'sem dado de pageviews para esta pessoa',
}

// States the peak, never a total, since the bar itself draws no number.
const attentionRowHead = (row: 'mentions' | 'views', headLabel: string, peak: string | null, peakValue: number, unit: string) =>
  html`<div class="attention-row-head"><span>${headLabel}</span><span>${peak ? html`pico: ${fmt(peakValue)} ${unit} em ${attentionDayLabel(peak)}` : ATTENTION_ROW_NOTE[row]}</span></div>`

// glow/hit share the bar's own width, never wider, so a click never lands on a neighbouring day.
// Only the mentions mark stays in the tab order (spec §4: one shared click target per day, not
// two); the views mark stays clickable by pointer but drops out of both the tab order and the
// accessibility tree, or the day count would double to 60.
const attentionMarkMarkup = (mark: AttentionMark, baseline: number, selected: string | null, interactive: boolean, title: string) => {
  const isSelected = selected === mark.day
  const barX = -mark.barW / 2
  const barY = -mark.size
  return html`<g class="attention-mark ${isSelected ? 'is-selected' : ''}" transform="translate(${mark.x},${baseline})" data-day="${mark.day}"${
    interactive ? html` role="button" tabindex="0" aria-pressed="${String(isSelected)}" aria-label="${title}"` : html` tabindex="-1" aria-hidden="true"`
  }><title>${title}</title><rect class="attention-hit" x="${barX}" y="${-baseline}" width="${mark.barW}" height="${ATTENTION_ROW_HEIGHT}"/><rect class="attention-glow" x="${barX}" y="${barY - 4}" width="${mark.barW}" height="${mark.size + 8}"/><rect class="attention-bar" x="${barX}" y="${barY}" width="${mark.barW}" height="${mark.size}"/></g>`
}

const byDay = (marks: AttentionMark[]) => new Map(marks.map((m) => [m.day, m.text]))

const attentionRowMarkup = (
  row: 'mentions' | 'views',
  marks: AttentionMark[],
  companion: Map<string, string>,
  width: number,
  selected: string | null,
  headLabel: string,
  peak: string | null,
  peakValue: number,
  unit: string,
) => {
  const baseline = ATTENTION_BASELINE
  const interactive = row === 'mentions'
  return html`<div class="attention-row" data-row="${row}">${attentionRowHead(row, headLabel, peak, peakValue, unit)}${frame(
    { cls: 'attention-svg', width, height: ATTENTION_ROW_HEIGHT, viewBox: `0 0 ${width} ${ATTENTION_ROW_HEIGHT}`, role: 'group', ariaLabel: headLabel },
    html`${axis({ x0: 0, x1: width, y: baseline, ticks: marks.map((m) => m.x), cls: 'attention' })}${marks.map((m) => {
      const other = companion.get(m.day) ?? '0'
      const title = interactive ? `${attentionDayLabel(m.day)}, ${m.text} documentos, ${other} visualizações` : `${attentionDayLabel(m.day)}, ${other} documentos, ${m.text} visualizações`
      return attentionMarkMarkup(m, baseline, selected, interactive, title)
    })}`,
  )}</div>`
}

const ATTENTION_GHOST_BARS = [10, 22, 14, 30, 18, 26]

// Shared by the boot ghost and the views row alone while /attention is still in flight.
const attentionGhostRow = (row: 'mentions' | 'views', headLabel: string, width: number) => {
  const baseline = ATTENTION_BASELINE
  const step = width / ATTENTION_GHOST_BARS.length
  return html`<div class="attention-row" data-row="${row}"><div class="attention-row-head"><span>${headLabel}</span>${ghostBar('ghost-line is-short')}</div>${frame(
    { cls: 'attention-svg', width, height: ATTENTION_ROW_HEIGHT, viewBox: `0 0 ${width} ${ATTENTION_ROW_HEIGHT}` },
    html`${axis({ x0: 0, x1: width, y: baseline, ticks: ATTENTION_GHOST_BARS.map((_, i) => Math.round(step * (i + 0.5))), cls: 'attention' })}${ATTENTION_GHOST_BARS.map(
      (h, i) => html`<rect class="ghost" x="${Math.round(step * (i + 0.5)) - 6}" y="${baseline - h}" width="12" height="${h}" rx="3"/>`,
    )}`,
  )}</div>`
}

// A failed /attention fetch is distinct from an empty one: the views row states its own error,
// never "sem dado de pageviews" (an outage is not "no wikipedia page").
const attentionRowError = (width: number, headLabel: string) =>
  html`<div class="attention-row" data-row="views"><div class="attention-row-head"><span>${headLabel}</span><span>Não foi possível carregar os pageviews.</span></div>${frame(
    { cls: 'attention-svg', width, height: ATTENTION_ROW_HEIGHT, viewBox: `0 0 ${width} ${ATTENTION_ROW_HEIGHT}` },
    axis({ x0: 0, x1: width, y: ATTENTION_BASELINE, ticks: [], cls: 'attention' }),
  )}</div>`

export const paintAttention = ({
  mentions,
  views,
  metrics,
  selected,
  onPick,
  width = ATTENTION_ROW_WIDTH,
  viewsLoading = false,
  viewsError = false,
}: {
  mentions: AttentionMentionDay[]
  views: AttentionDay[]
  metrics: Measure
  selected: string | null
  onPick: (day: string) => void
  width?: number
  viewsLoading?: boolean
  viewsError?: boolean
}) => {
  const chart = $('attentionChart')
  if (!chart) return
  chart.hidden = false
  chart.classList.remove('is-loading')
  chart.setAttribute('aria-busy', viewsLoading ? 'true' : 'false')
  const viewsLabel = 'Pageviews (Wikipédia)'
  const layout = attentionLayout(metrics, mentions, views, width)
  const mentionsPeak = peakDay(mentions.map((m) => ({ day: m.day, value: m.count })))
  const mentionsPeakValue = mentions.find((m) => m.day === mentionsPeak)?.count ?? 0
  const mentionsMarkup = attentionRowMarkup('mentions', layout.mentions, byDay(layout.views), layout.width, selected, 'Menções', mentionsPeak, mentionsPeakValue, 'documentos')
  const viewsPeak = viewsLoading || viewsError ? null : peakDay(views.map((v) => ({ day: v.day, value: v.views })))
  const viewsPeakValue = views.find((v) => v.day === viewsPeak)?.views ?? 0
  const viewsMarkup = viewsError
    ? attentionRowError(layout.width, viewsLabel)
    : viewsLoading
      ? html`<div class="ghost-field" aria-hidden="true">${attentionGhostRow('views', viewsLabel, layout.width)}</div>`
      : attentionRowMarkup('views', layout.views, byDay(layout.mentions), layout.width, selected, viewsLabel, viewsPeak, viewsPeakValue, 'visualizações')
  chart.innerHTML = html`${mentionsMarkup}${viewsMarkup}${viewsLoading ? html`<p class="sr-only">Lendo os pageviews.</p>` : ''}`
  for (const el of queryAll('[data-day]', chart)) {
    const pick = () => onPick(String(el.dataset.day))
    el.addEventListener('click', pick)
    el.addEventListener('keydown', (event) => {
      const e = event as KeyboardEvent
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        pick()
      }
    })
  }
  const note = $('attentionNote')
  if (note) note.textContent = viewsLoading || viewsError ? '' : attentionNoteText(mentionsPeak, viewsPeak)
}

export const paintAttentionLoading = (width = ATTENTION_ROW_WIDTH) => {
  const chart = $('attentionChart')
  if (!chart) return
  chart.hidden = false
  chart.classList.remove('is-loading')
  chart.setAttribute('aria-busy', 'true')
  chart.innerHTML = html`<div class="ghost-field" aria-hidden="true">${attentionGhostRow('mentions', 'Menções', width)}${attentionGhostRow('views', 'Pageviews (Wikipédia)', width)}</div><p class="sr-only">Lendo a atenção.</p>`
  const note = $('attentionNote')
  if (note) note.textContent = ''
}

export const paintAttentionError = () => {
  const chart = $('attentionChart')
  if (!chart) return
  chart.hidden = false
  chart.classList.remove('is-loading')
  chart.setAttribute('aria-busy', 'false')
  chart.innerHTML = html`<p class="note">Não foi possível carregar as menções.</p>`
  const note = $('attentionNote')
  if (note) note.textContent = ''
}

// ---------- agenda (figure 8, issue #208): domain × person coverage share ----------

export const paintAgendaLoading = () => {
  const grid = $('agendaGrid')
  if (!grid) return
  grid.hidden = false
  grid.classList.remove('is-loading')
  grid.setAttribute('aria-busy', 'true')
  const widths = ['', 'is-mid', 'is-short']
  grid.innerHTML = html`<div class="agenda-ghost ghost-field" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map(
    (i) => html`<div class="agenda-ghost-row">${ghostBar(`ghost-outlet-d ${widths[i % 3]}`)}${[0, 1, 2, 3].map(() => ghostBar('ghost-outlet-n'))}</div>`,
  )}</div><p class="sr-only">Lendo a agenda.</p>`
}

export const paintAgendaError = (onRetry: () => void) => {
  const grid = $('agendaGrid')
  if (!grid) return
  grid.hidden = false
  grid.classList.remove('is-loading')
  grid.setAttribute('aria-busy', 'false')
  grid.innerHTML = '<p class="note">Não foi possível carregar a agenda. <button class="quiet-button" id="agendaErrorRetry">Tentar novamente</button></p>'
  $('agendaErrorRetry')?.addEventListener('click', onRetry)
}

export type AgendaSelection = { personId: string; domain: string } | null

// A domain's cells can sum above 1: a doc naming two tracked people counts once per person.
export const paintAgenda = ({
  data,
  min,
  selected,
  onPick,
}: {
  data: Agenda
  min: number
  selected: AgendaSelection
  onPick: (personId: string, personName: string, domain: string) => void
}) => {
  const grid = $('agendaGrid')
  if (!grid) return
  grid.hidden = false
  grid.classList.remove('is-loading')
  grid.setAttribute('aria-busy', 'false')
  if (!data.domains.length) {
    grid.innerHTML = html`<p class="note">Nenhum veículo atingiu o mínimo de ${min} documentos rastreados nesta janela.</p>`
    return
  }
  const rows = agendaRows(data)
  grid.innerHTML = html`<div class="agenda-scroll"><table class="agenda-table">
    <caption class="sr-only">Fatia da cobertura de cada veículo, por pessoa</caption>
    <thead><tr><th scope="col"></th>${data.persons.map((p) => html`<th scope="col">${p.name}</th>`)}</tr></thead>
    <tbody>${rows.map(
      (row) =>
        html`<tr><th scope="row"><span class="d">${row.domain}</span>${row.lean ? html`<span class="lean-chip">${LEAN_LABELS[row.lean] ?? row.lean}</span>` : ''}</th>${data.persons.map((p) => {
          const cell = row.cells.get(p.id)
          if (!cell) return html`<td class="agenda-cell is-empty"><span class="sr-only">sem documentos</span></td>`
          const isSelected = !!selected && selected.personId === p.id && selected.domain === row.domain
          const pct = Math.round(cell.share * 100)
          const label = cell.docs > 0 && pct === 0 ? '<1%' : `${pct}%`
          return html`<td class="agenda-cell"><button class="agenda-pick${isSelected ? ' is-active' : ''}" data-person="${p.id}" data-domain="${row.domain}" aria-pressed="${String(isSelected)}" style="--share:${Math.max(pct, 1)}%" title="${fmt(cell.docs)} ${cell.docs === 1 ? 'documento' : 'documentos'}">${label}</button></td>`
        })}</tr>`,
    )}</tbody>
  </table></div><p class="note">A fatia é da cobertura rastreada do próprio veículo, não da pessoa. A soma de uma linha pode passar de 100%: um documento que cita duas pessoas rastreadas conta para as duas.</p>`
  queryAll('[data-person]', grid).forEach((el) =>
    el.addEventListener('click', () => {
      const personId = String(el.dataset.person)
      const domain = String(el.dataset.domain)
      const person = data.persons.find((p) => p.id === personId)
      onPick(personId, person?.name ?? personId, domain)
    }),
  )
}

// Comention matrix (figure 9, #207): ink weight only, no --hostile/--favor/--cmp-a/--cmp-b.
export type ComentionSelection = { a: string; b: string } | null

// The grid's cells key a/b by row/column (name order, matrixLayout) while the ranked list's
// pairs key a/b by id (comentionFor's own SQL order); the two disagree whenever name order and
// id order disagree for a pair. Normalize both sides before comparing so a pair selected in one
// markup still reads as selected in the other.
const normalizePair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a])
const isPairSelected = (selected: ComentionSelection, a: string, b: string) => {
  if (!selected) return false
  const [x, y] = normalizePair(a, b)
  return selected.a === x && selected.b === y
}

const comentionCellMarkup = (row: { id: string; name: string }, col: { id: string; name: string }, cell: { a: string; b: string; count: number | null; ink: number }, selected: ComentionSelection) => {
  if (cell.count === null) return html`<span class="comention-cell is-empty" aria-hidden="true"></span>`
  const isSelected = isPairSelected(selected, cell.a, cell.b)
  return html`<button type="button" class="comention-cell${isSelected ? ' is-selected' : ''}" style="--w:${cell.ink}" data-a="${cell.a}" data-b="${cell.b}" aria-pressed="${isSelected}" aria-label="${row.name} e ${col.name}: ${fmt(cell.count)} textos juntos">${fmt(cell.count)}</button>`
}

const comentionAboutText = (data: Comention) =>
  data.pairs.length ? `${fmt(data.pairs.length)} ${data.pairs.length === 1 ? 'par' : 'pares'} de pessoas citadas juntas nos ${data.days} dias.` : 'Ninguém apareceu junto o suficiente nesta janela.'

export const paintComention = ({ data, width, selected, onPick }: { data: Comention; width: number; selected: ComentionSelection; onPick: (a: string, b: string) => void }) => {
  const root = $('comentionMatrix')
  if (!root) return
  root.hidden = false
  root.classList.remove('is-loading')
  root.setAttribute('aria-busy', 'false')
  const persons = data.persons
  const { cellSize, cells } = matrixLayout(persons, data.pairs, width)
  const cellAt = new Map(cells.map((c) => [`${c.a}\u0000${c.b}`, c]))
  const rows = persons.map(
    (row, i) => html`<div class="comention-row">
      <div class="comention-rowhead">${row.name}</div>
      ${persons.map((col, j) => {
        if (i >= j) return html`<span class="comention-cell is-blank" aria-hidden="true"></span>`
        // The cell carries row/column order (ids[i]/ids[j]), not the pair's own a/b (person_id);
        // a caller needing the pair's a/b must normalize it, as pick() in comention.ts does.
        return comentionCellMarkup(row, col, cellAt.get(`${row.id}\u0000${col.id}`)!, selected)
      })}
    </div>`,
  )
  const ranked = [...data.pairs].sort((a, b) => b.count - a.count)
  root.innerHTML = html`<div class="comention-grid" style="--cell:${cellSize}px">
      <div class="comention-row comention-headrow">
        <div class="comention-rowhead" aria-hidden="true"></div>
        ${persons.map((p) => html`<span class="comention-colhead" title="${p.name}">${personInitials(p.name)}</span>`)}
      </div>
      ${rows}
    </div>
    <ol class="comention-list">${ranked.map((pair) => {
      const a = persons.find((p) => p.id === pair.a)
      const b = persons.find((p) => p.id === pair.b)
      const isSelected = isPairSelected(selected, pair.a, pair.b)
      return html`<li><button type="button" class="comention-listitem${isSelected ? ' is-selected' : ''}" data-a="${pair.a}" data-b="${pair.b}" aria-pressed="${isSelected}"><b>${fmt(pair.count)}</b> ${a?.name ?? pair.a} × ${b?.name ?? pair.b}</button></li>`
    })}</ol>`
  for (const el of queryAll('[data-a]', root)) el.addEventListener('click', () => onPick(String(el.dataset.a), String(el.dataset.b)))
  const about = $('comentionAbout')
  if (about) about.textContent = comentionAboutText(data)
}

const COMENTION_GHOST_N = 27
// .comention-list's own ghost -- atlas.css hides the grid below 700px, so it needs one too.
const COMENTION_LIST_GHOST_N = 6

export const paintComentionLoading = () => {
  const root = $('comentionMatrix')
  if (!root) return
  root.hidden = false
  root.classList.remove('is-loading')
  root.setAttribute('aria-busy', 'true')
  root.innerHTML = html`<div class="ghost-field" aria-hidden="true"><div class="comention-grid is-ghost">${Array.from(
    { length: COMENTION_GHOST_N },
    () => html`<div class="comention-row">${Array.from({ length: COMENTION_GHOST_N }, () => html`<span class="comention-cell ghost"></span>`)}</div>`,
  )}</div><ol class="comention-list is-ghost">${Array.from(
    { length: COMENTION_LIST_GHOST_N },
    () => html`<li><span class="comention-listitem ghost"></span></li>`,
  )}</ol></div><p class="sr-only">Lendo quem aparece junto.</p>`
  const about = $('comentionAbout')
  if (about) about.textContent = ''
}

export const paintComentionError = () => {
  const root = $('comentionMatrix')
  if (!root) return
  root.hidden = false
  root.classList.remove('is-loading')
  root.setAttribute('aria-busy', 'false')
  root.innerHTML = html`<p class="note">Não foi possível carregar quem aparece junto.</p>`
  const about = $('comentionAbout')
  if (about) about.textContent = ''
}

// ---------- persistence (figure 10, issue #215): one row per word, one cell per week ----------

export type PersistenceSelection = { week: string; term: string; kind: string } | null

const PERSISTENCE_GAP_LABEL = 'fora das 50 mais fortes'
const PERSISTENCE_NODATA_LABEL = 'sem dados'
const PERSISTENCE_EXPIRED_LABEL = 'documentos fora do período guardado'

const persistenceNoteText = (data: Persistence) => {
  const n = seriesWeeks(data.first_week)
  if (n === null) return 'Ainda sem série: a primeira semana é gravada na próxima atualização.'
  if (n < 4) return `${n} ${n === 1 ? 'semana' : 'semanas'} de série; a leitura começa a valer com quatro.`
  return ''
}

const persistenceCellMarkup = (
  cell: { week: string; count: number | null; level: number },
  row: { term: string; kind: string },
  firstWeek: string | null,
  oldestPickable: string,
  selected: PersistenceSelection,
) => {
  if (cell.count === null) {
    const noData = !firstWeek || cell.week < firstWeek
    const text = noData ? PERSISTENCE_NODATA_LABEL : PERSISTENCE_GAP_LABEL
    return html`<span class="persistence-cell ${noData ? 'is-nodata' : 'is-gap'}" data-gap="1" title="${text}" role="img" aria-label="${text}"></span>`
  }
  if (cell.week < oldestPickable)
    return html`<span class="persistence-cell is-expired" data-lv="${cell.level}" data-expired="1" title="${PERSISTENCE_EXPIRED_LABEL}" role="img" aria-label="${PERSISTENCE_EXPIRED_LABEL}">${fmt(cell.count)}</span>`
  const isSelected = !!selected && selected.week === cell.week && selected.term === row.term && selected.kind === row.kind
  return html`<button type="button" class="persistence-cell${isSelected ? ' is-selected' : ''}" data-lv="${cell.level}" data-week="${cell.week}" data-term="${row.term}" data-kind="${row.kind}" aria-pressed="${isSelected}" aria-label="${row.term}, semana ${weekSpanLabel(cell.week)}: ${fmt(cell.count)} ${cell.count === 1 ? 'documento' : 'documentos'}">${fmt(cell.count)}</button>`
}

// Draws #persistenceChart and the series note in #persistenceNote. Never a blank figure: with
// no series or no word the note says why.
export const paintPersistence = ({ data, selected, onPick }: { data: Persistence; selected: PersistenceSelection; onPick: (week: string, term: string, kind: string) => void }) => {
  const chart = $('persistenceChart')
  const note = $('persistenceNote')
  const since = $('persistenceSince')
  if (since) since.textContent = sinceLabel(data.since)
  const seriesNote = persistenceNoteText(data)
  if (!chart) {
    if (note) note.textContent = seriesNote
    return
  }
  chart.classList.remove('is-loading')
  chart.setAttribute('aria-busy', 'false')
  if (!data.terms.length) {
    chart.hidden = true
    chart.innerHTML = ''
    if (note) note.textContent = seriesNote || 'Nenhuma palavra ficou nesta janela.'
    return
  }
  chart.hidden = false
  const { rows } = persistenceLayout(data)
  const oldestPickable = shiftDate(todayBrt(), -data.horizon)
  const stats = (t: Persistence['terms'][number]) =>
    html`<dl class="stat"><div><dt>sequência</dt><dd>${fmt(t.streak)}</dd></div></dl><dl class="stat"><div><dt>meia-vida</dt><dd>${t.half_life === null ? 'sem queda' : fmt(t.half_life)}</dd></div></dl>`
  chart.innerHTML = html`<div class="persistence-scroll"><table class="persistence-table">
    <caption class="sr-only">Palavras por semana, com sequência e meia-vida</caption>
    <thead><tr><th scope="col"></th>${(rows[0]?.cells ?? []).map((c, i) => html`<th scope="col" class="persistence-week">${i === 0 || c.week.slice(8) <= '07' ? html`<span>${weekHeadLabel(c.week)}</span>` : ''}</th>`)}<th scope="col"></th></tr></thead>
    <tbody>${rows.map(
      (row, i) =>
        html`<tr><th scope="row" class="persistence-term" title="${row.term}">${row.term}</th>${row.cells.map((cell) => html`<td class="persistence-c">${persistenceCellMarkup(cell, row, data.first_week, oldestPickable, selected)}</td>`)}<td class="persistence-stats">${stats(data.terms[i])}</td></tr>`,
    )}</tbody>
  </table></div>`
  queryAll('[data-week]', chart).forEach((el) => el.addEventListener('click', () => onPick(String(el.dataset.week), String(el.dataset.term), String(el.dataset.kind))))
  if (note) note.textContent = seriesNote
}

export const paintPersistenceLoading = () => {
  const chart = $('persistenceChart')
  if (!chart) return
  chart.hidden = false
  chart.classList.remove('is-loading')
  chart.setAttribute('aria-busy', 'true')
  const widths = ['', 'is-mid', 'is-short']
  chart.innerHTML = html`<div class="persistence-ghost ghost-field" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map(
    (i) => html`<div class="persistence-ghost-row">${ghostBar(`ghost-outlet-d ${widths[i % 3]}`)}${Array.from({ length: 12 }, () => html`<span class="persistence-cell ghost"></span>`)}</div>`,
  )}</div><p class="sr-only">Lendo a persistência.</p>`
  const note = $('persistenceNote')
  if (note) note.textContent = ''
}

export const paintPersistenceError = () => {
  const chart = $('persistenceChart')
  if (!chart) return
  chart.hidden = false
  chart.classList.remove('is-loading')
  chart.setAttribute('aria-busy', 'false')
  chart.innerHTML = html`<p class="note">Não foi possível carregar a persistência.</p>`
  const note = $('persistenceNote')
  if (note) note.textContent = ''
}
