// A DOM stand-in capable of running public/js/figures/atlas.js's and
// public/js/figures/testimony.js's real mount(), so issue #92's independence criteria are
// checked against the actual wiring rather than a claim about it. Unlike fake-dom.ts (which
// never needs a live click), this one captures addEventListener listeners so a test can fire
// them, and lets a container's innerHTML seed the handful of data-domain/data-strip-domain
// buttons paintOutlets/paintStrip wire — the only two dynamic click targets either figure's
// criteria in this suite actually need to press.

type Option = { value: string; textContent: string }

// classList/attributes live here, not only on FakeBox, because paintSelection's is-selected
// loop (render.ts, queryAll('[data-node]') with no root) walks the stub elements dataStubs()
// returns below, the same way it would walk real elements document-wide.
class Listenable {
  _listeners: Record<string, ((e?: unknown) => void)[]> = {}
  classes: Record<string, boolean> = {}
  attributes: Record<string, string> = {}
  classList = {
    toggle: (name: string, on?: boolean) => {
      this.classes[name] = on ?? !this.classes[name]
    },
    add: (name: string) => {
      this.classes[name] = true
    },
    remove: (name: string) => {
      this.classes[name] = false
    },
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null
  }
  addEventListener(type: string, fn: (e?: unknown) => void) {
    ;(this._listeners[type] ??= []).push(fn)
  }
  removeEventListener() {}
  fire(type: string, e?: unknown) {
    for (const fn of this._listeners[type] ?? []) fn(e)
  }
}

const dataStubs = (html: string, attr: 'data-domain' | 'data-strip-domain' | 'data-col' | 'data-node' | 'data-related' | 'data-day') =>
  [...html.matchAll(new RegExp(`${attr}="([^"]*)"`, 'g'))].map(([, value]) => {
    const stub = new Listenable() as Listenable & { dataset: Record<string, string> }
    stub.dataset =
      attr === 'data-domain'
        ? { domain: value }
        : attr === 'data-col'
          ? { col: value }
          : attr === 'data-node'
            ? { node: value }
            : attr === 'data-related'
              ? { related: value }
              : attr === 'data-day'
                ? { day: value }
                : { stripDomain: value }
    return stub
  })

// paintRuler's marks (issue #91) carry two data-* attributes on the same tag (data-term and
// data-kind), unlike the single-attribute stubs above, so onPick(term, kind) reads both off
// one click. Since issue #99 a mark is either a <g> holding the word or, for a word the strip
// could not fit, a <button> in the overflow list; both are wired by the same painter loop and
// both must be reachable here, or a criterion about the list would pass vacuously. Figure 5's
// marks (issue #147) carry a third attribute, data-day, since a word there belongs to one
// calendar day; captured into dataset.day when present, left off (as the other figures' marks
// are) otherwise.
const dataTermStubs = (html: string) =>
  [...html.matchAll(/<(?:g|button)[^>]*\bdata-term="([^"]*)"[^>]*\bdata-kind="([^"]*)"(?:[^>]*\bdata-day="([^"]*)")?[^>]*>/g)].map(([, term, kind, day]) => {
    const stub = new Listenable() as Listenable & { dataset: Record<string, string> }
    stub.dataset = day === undefined ? { term, kind } : { term, kind, day }
    return stub
  })

// The person's own entry to her documents (issue: the inspector's button is gone). It carries
// no value, only the click and the Enter/Space a <button> would have handled on its own, so one
// bare listenable per occurrence is the whole stub.
const personDocsStubs = (html: string) => [...html.matchAll(/data-person-docs/g)].map(() => new Listenable())

// Figure 8's grid cells (issue #208): one <button> per (person, domain) pair, carrying both
// attributes on the same tag the way paintRuler's data-term/data-kind marks do.
const dataPersonStubs = (html: string) =>
  [...html.matchAll(/<button[^>]*\bdata-person="([^"]*)"[^>]*\bdata-domain="([^"]*)"[^>]*>/g)].map(([, person, domain]) => {
    const stub = new Listenable() as Listenable & { dataset: Record<string, string> }
    stub.dataset = { person, domain }
    return stub
  })

// The comention matrix's cells (issue #207): a filled cell carries both data-a and data-b (the
// pair's own person ids), matched adjacently the way paintComention emits them, on both the
// grid's <button> and the narrow-viewport list's own <button> for the same pair.
const dataABStubs = (html: string) =>
  [...html.matchAll(/<button[^>]*\bdata-a="([^"]*)"[^>]*\bdata-b="([^"]*)"[^>]*>/g)].map(([, a, b]) => {
    const stub = new Listenable() as Listenable & { dataset: Record<string, string> }
    stub.dataset = { a, b }
    return stub
  })

// Figure 10's filled cells (issue #215): one <button> per (week, term, kind), the three
// attributes read independently since the painter may order them any way. A gap or expired
// cell is not a button and never carries data-week as a click target.
const dataWeekStubs = (html: string) =>
  [...html.matchAll(/<button\b[^>]*>/g)]
    .map(([tag]) => ({ tag, week: /\bdata-week="([^"]*)"/.exec(tag)?.[1], term: /\bdata-term="([^"]*)"/.exec(tag)?.[1], kind: /\bdata-kind="([^"]*)"/.exec(tag)?.[1] }))
    .filter((t) => t.week !== undefined)
    .map(({ week, term, kind }) => {
      const stub = new Listenable() as Listenable & { dataset: Record<string, string> }
      stub.dataset = { week: week!, term: term ?? '', kind: kind ?? '' }
      return stub
    })

// A generic node: covers every button/div/dialog id both figures touch. `innerHTML` is kept
// as plain text (this harness parses nothing beyond the two data-* attributes above), which is
// enough since no criterion here asserts markup shape — only requests and control wiring.
class FakeBox extends Listenable {
  id: string
  textContent = ''
  hidden = false
  disabled = false
  open = false
  clientWidth = 800
  scrollWidth = 800
  scrollLeft = 0
  attributes: Record<string, string> = {}
  classes: Record<string, boolean> = {}
  private html = ''
  // Memoized per current innerHTML: paintOutlets/paintStrip query, then wire a click listener
  // onto, the very stubs this returns — a fresh array on every call would wire listeners onto
  // objects the test could never reach again. Invalidated only when innerHTML is reassigned.
  private domainStubs: { attr: 'data-domain' | 'data-strip-domain' | 'data-term' | 'data-col' | 'data-node' | 'data-person-docs' | 'data-related' | 'data-day' | 'data-person' | 'data-a' | 'data-week'; html: string; stubs: ReturnType<typeof dataStubs> | ReturnType<typeof dataTermStubs> | ReturnType<typeof personDocsStubs> | ReturnType<typeof dataPersonStubs> | ReturnType<typeof dataABStubs> | ReturnType<typeof dataWeekStubs> }[] = []
  classList = {
    toggle: (name: string, on?: boolean) => {
      this.classes[name] = on ?? !this.classes[name]
    },
    add: (name: string) => {
      this.classes[name] = true
    },
    remove: (name: string) => {
      this.classes[name] = false
    },
  }
  constructor(id: string) {
    super()
    this.id = id
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null
  }
  get innerHTML() {
    return this.html
  }
  // Stringified like the real setter: the painters assign format.ts's `Html` values now.
  set innerHTML(value: string) {
    this.html = String(value)
    this.domainStubs = []
  }
  querySelector() {
    return null
  }
  private stubsFor(attr: 'data-domain' | 'data-strip-domain' | 'data-term' | 'data-col' | 'data-node' | 'data-person-docs' | 'data-related' | 'data-day' | 'data-person' | 'data-a' | 'data-week') {
    const cached = this.domainStubs.find((e) => e.attr === attr && e.html === this.html)
    if (cached) return cached.stubs
    const stubs = attr === 'data-term' ? dataTermStubs(this.html) : attr === 'data-person-docs' ? personDocsStubs(this.html) : attr === 'data-person' ? dataPersonStubs(this.html) : attr === 'data-a' ? dataABStubs(this.html) : attr === 'data-week' ? dataWeekStubs(this.html) : dataStubs(this.html, attr)
    this.domainStubs.push({ attr, html: this.html, stubs })
    return stubs
  }
  querySelectorAll(selector: string) {
    if (selector === '[data-domain]') return this.stubsFor('data-domain')
    if (selector === '[data-strip-domain]') return this.stubsFor('data-strip-domain')
    if (selector === '[data-term]') return this.stubsFor('data-term')
    if (selector === '[data-col]') return this.stubsFor('data-col')
    if (selector === '[data-node]') return this.stubsFor('data-node')
    if (selector === '[data-person]') return this.stubsFor('data-person')
    if (selector === '[data-person-docs]') return this.stubsFor('data-person-docs')
    if (selector === '[data-related]') return this.stubsFor('data-related')
    if (selector === '[data-day]') return this.stubsFor('data-day')
    if (selector === '[data-a]') return this.stubsFor('data-a')
    if (selector === '[data-week]') return this.stubsFor('data-week')
    return []
  }
  style: Record<string, string> = {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 360, height: 420 }
  }
  show() {
    this.open = true
  }
  showModal() {
    this.open = true
  }
  close() {
    this.open = false
    this.fire('close')
  }
}

// A real <select>: options come preloaded (the static markup atlas.html already ships), or
// arrive later through `.add(new Option(...))` (the person selects, built from the fetched
// list) — the same two paths public/js/figures/*.js actually uses. `applySeed` in both modules
// only ever assigns `.value` when it already names one of `.options`, so keeping that rule
// here is what lets a malformed seed (criterion covered by the atlas.js unit already) fall
// through to whatever the constructor set as the default.
class FakeSelect extends Listenable {
  id: string
  options: Option[]
  private current: string
  constructor(id: string, options: { value: string; text: string; selected?: boolean }[] = []) {
    super()
    this.id = id
    this.options = options.map((o) => ({ value: o.value, textContent: o.text }))
    this.current = (options.find((o) => o.selected) ?? options[0])?.value ?? ''
  }
  get value() {
    return this.current
  }
  set value(v: string) {
    this.current = v
  }
  get selectedOptions() {
    const opt = this.options.find((o) => o.value === this.current)
    return opt ? [opt] : []
  }
  add(option: { text: string; value: string }) {
    this.options.push({ value: option.value, textContent: option.text })
  }
  // Both figures build the source segment list with html`${SOURCE_SEGMENTS.map(...)}` and
  // assign it here, and the atlas clears the person select the same way before repopulating
  // it with .add(); parsing the emitted <option> tags keeps applySeed's own option lookup
  // honest instead of special-casing "source" here.
  set innerHTML(html: string) {
    this.options = [...String(html).matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(([, value, textContent]) => ({ value, textContent }))
    if (this.options.length && !this.options.some((o) => o.value === this.current)) this.current = this.options[0].value
  }
  get innerHTML() {
    return ''
  }
}

// A real `<optgroup id="lensesAOutlets">` sits inside `<select id="lensesA">`, so a real
// `select.options` already sees whatever `<option>`s loadOutlets() writes into it -- and a real
// browser drops the select's selectedness to its first option the moment the previously
// selected `<option>` element is removed, even when a fresh element with the same value is
// reinserted in the same breath: selectedness lives on the element, not the value, so nothing
// here re-selects it automatically. Only an explicit `select.value = ...` afterwards, in the
// production code under test, can restore or preserve it. This stub's select and its outlet
// optgroup are two separate objects, so writing here has to mirror both halves of that: the
// fill into the paired select's own options (replacing only the domain: ones it owns), and,
// when the select's current value was itself one of those domain: options, the same drop to
// `options[0]` a real browser would perform.
class FakeOutletGroup extends FakeBox {
  private target: FakeSelect
  private markup = ''
  constructor(id: string, target: FakeSelect) {
    super(id)
    this.target = target
  }
  set innerHTML(html: string) {
    this.markup = String(html)
    const opts = [...this.markup.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(([, value, textContent]) => ({ value, textContent }))
    const hadDomainSelected = this.target.value.startsWith('domain:')
    this.target.options = [...this.target.options.filter((o) => !o.value.startsWith('domain:')), ...opts]
    if (hadDomainSelected) this.target.value = this.target.options[0]?.value ?? this.target.value
  }
  get innerHTML() {
    return this.markup
  }
}

class FakeInput extends Listenable {
  id: string
  value = ''
  constructor(id: string) {
    super()
    this.id = id
  }
}

// Mirrors atlas.html's #days / #testimonyDays exactly: the same three values, and the same
// `selected` default. A harness that offered a value the page does not have (or defaulted to the
// first option instead of the marked one) would green-light a seed bug the real page would hit.
const DAYS_OPTIONS = [
  { value: '7', text: 'últimos 7 dias' },
  { value: '30', text: 'últimos 30 dias', selected: true },
  { value: '365', text: 'último ano' },
]

const atlasIds = () => ({
  workspace: new FakeBox('workspace'),
  source: new FakeSelect('source'),
  person: new FakeSelect('person'),
  days: new FakeSelect('days', DAYS_OPTIONS),
  sort: new FakeSelect('sort', [
    { value: 'count', text: 'frequência' },
    { value: 'pmi', text: 'PMI ponderado', selected: true },
  ]),
  limit: new FakeSelect('limit', [
    { value: '12', text: '12' },
    { value: '18', text: '18', selected: true },
    { value: '24', text: '24' },
  ]),
  search: new FakeInput('search'),
  searchNote: new FakeBox('searchNote'),
  selectionNote: new FakeBox('selectionNote'),
  status: new FakeBox('status'),
  viewport: new FakeBox('viewport'),
  columns: new FakeBox('columns'),
  legend: new FakeBox('legend'),
  overflow: new FakeBox('overflow'),
  modeMap: new FakeBox('modeMap'),
  modeColumns: new FakeBox('modeColumns'),
  // Issue #149: figure 1's third view, the kikori beeswarm strip, its own hidden-count note,
  // the zoom control group (toggled off in strip mode) and the two figure-key blocks that
  // swap with the mode.
  modeStrip: new FakeBox('modeStrip'),
  atlasStrip: new FakeBox('atlasStrip'),
  stripHiddenNote: new FakeBox('stripHiddenNote'),
  zoomGroup: new FakeBox('zoomGroup'),
  keyDefault: new FakeBox('keyDefault'),
  keyStrip: new FakeBox('keyStrip'),
  keyTheme: new FakeBox('keyTheme'),
  keyThemeText: new FakeBox('keyThemeText'),
  keyDefaultColor: new FakeBox('keyDefaultColor'),
  mask: new FakeBox('mask'),
  zoomIn: new FakeBox('zoomIn'),
  zoomOut: new FakeBox('zoomOut'),
  zoomReset: new FakeBox('zoomReset'),
  clear: new FakeBox('clear'),
  docsClose: new FakeBox('docsClose'),
  docsGrip: new FakeBox('docsGrip'),
  docsDialog: new FakeBox('docsDialog'),
  helpDialog: new FakeBox('helpDialog'),
  helpClose: new FakeBox('helpClose'),
  // The card's own three: #docs is what loadDocs checks for before it fetches at all, so a
  // harness without it would let every "picking a word asks for its texts" criterion pass by
  // never asking for anything.
  docs: new FakeBox('docs'),
  docsKicker: new FakeBox('docsKicker'),
  docsTitle: new FakeBox('docsTitle'),
  atlasStats: new FakeBox('atlasStats'),
  inspector: new FakeBox('inspector'),
  // The real page creates #retry inside #viewport's innerHTML, so it only exists once an
  // error or empty branch has painted. The harness ships it preexisting because getElementById
  // here is a flat lookup, not a parse; the tests that use it assert the button's markup was
  // emitted too, so a branch that stopped emitting it would still fail.
  retry: new FakeBox('retry'),
})

const testimonyIds = () => ({
  testimony: new FakeBox('testimony'),
  testimonySource: new FakeSelect('testimonySource'),
  testimonyPerson: new FakeSelect('testimonyPerson'),
  testimonyDays: new FakeSelect('testimonyDays', DAYS_OPTIONS),
  testimonyLabel: new FakeBox('testimonyLabel'),
  testimonyList: new FakeBox('testimonyList'),
  outletList: new FakeBox('outletList'),
  domainLabel: new FakeBox('domainLabel'),
  strip: new FakeBox('strip'),
  // Same reasoning as #retry above: painted into #testimonyList's innerHTML by the error branch.
  testimonyRetry: new FakeBox('testimonyRetry'),
})

// Figure 3 (issue #91): its own person selects, sentence controls, ruler host, detail/status/
// note lines, and the retry button the error branch paints into #compareDetail's innerHTML.
const compareIds = () => ({
  compare: new FakeBox('compare'),
  compareA: new FakeSelect('compareA'),
  compareB: new FakeSelect('compareB'),
  compareDays: new FakeSelect('compareDays', DAYS_OPTIONS),
  compareSource: new FakeSelect('compareSource'),
  compareMeasure: new FakeSelect('compareMeasure', [
    { value: 'count', text: 'documentos' },
    { value: 'pmi', text: 'PMI × ln(1 + docs)' },
  ]),
  // Mirrors the options figures/compare.js writes into #compareLimit, default 20 since issue
  // #99: the figure draws words now, and 40 per person is ~130 of them on the wire.
  compareLimit: new FakeSelect('compareLimit', [
    { value: '20', text: '20', selected: true },
    { value: '40', text: '40' },
    { value: '60', text: '60' },
    { value: '100', text: '100' },
  ]),
  compareStatus: new FakeBox('compareStatus'),
  compareRuler: new FakeBox('compareRuler'),
  compareDetail: new FakeBox('compareDetail'),
  compareHiddenNote: new FakeBox('compareHiddenNote'),
  compareRetry: new FakeBox('compareRetry'),
})

// Figure 4 (issue #151): its own person/source selects, ruler host and about line. No days,
// baseline, kind, limit or min control — those stay fixed, sent explicitly by the figure.
const risingIds = () => ({
  rising: new FakeBox('rising'),
  risingPerson: new FakeSelect('risingPerson'),
  risingSource: new FakeSelect('risingSource'),
  risingRuler: new FakeBox('risingRuler'),
  risingAbout: new FakeBox('risingAbout'),
})

// Figure 5 (issue #147): its own person/source/limit selects, the chart host and its note. No
// days control — the figure always sends days=7.
const weekIds = () => ({
  week: new FakeBox('week'),
  weekPerson: new FakeSelect('weekPerson'),
  weekSource: new FakeSelect('weekSource'),
  weekLimit: new FakeSelect('weekLimit', [
    { value: '5', text: '5' },
    { value: '8', text: '8', selected: true },
    { value: '12', text: '12' },
  ]),
  weekChart: new FakeBox('weekChart'),
  weekNote: new FakeBox('weekNote'),
})

// Figure 7 (issue #216): its own person/source selects, the chart host and its note (the lag
// sentence, or an empty-state note, following week.ts's own #weekNote precedent). No days
// control -- the figure always sends days=30, like week's own fixed days=7.
const attentionIds = () => ({
  attention: new FakeBox('attention'),
  attentionPerson: new FakeSelect('attentionPerson'),
  attentionSource: new FakeSelect('attentionSource'),
  attentionChart: new FakeBox('attentionChart'),
  attentionNote: new FakeBox('attentionNote'),
})

// Figure 6 (issue #206): one person select, two lens selects (flat options across every
// optgroup the real markup groups them into — a FakeSelect has no optgroup concept, and no
// criterion here needs one), the two optgroup stand-ins loadOutlets() fills dynamically, the
// days/limit selects, the ruler host, detail/status/hidden-note lines.
const lensesIds = () => {
  const lensesA = new FakeSelect('lensesA', [
    { value: 'all', text: 'Tudo', selected: true },
    { value: 'lean:left', text: 'Esquerda' },
    { value: 'lean:center', text: 'Centro' },
    { value: 'lean:right', text: 'Direita' },
    { value: 'source:bluesky', text: 'Bluesky' },
    { value: 'source:gdelt', text: 'GDELT' },
    { value: 'source:rss', text: 'RSS' },
    { value: 'source:gnews', text: 'Google News' },
    { value: 'source:gkg', text: 'GKG' },
    { value: 'source:camara', text: 'Câmara' },
    { value: 'source:senado', text: 'Senado' },
    { value: 'source:juridico', text: 'Jurídico' },
    { value: 'source:oficial', text: 'Oficial' },
    { value: 'source:nicho', text: 'Nicho' },
  ])
  const lensesB = new FakeSelect('lensesB', [
    { value: 'all', text: 'Tudo', selected: true },
    { value: 'lean:left', text: 'Esquerda' },
    { value: 'lean:center', text: 'Centro' },
    { value: 'lean:right', text: 'Direita' },
    { value: 'source:bluesky', text: 'Bluesky' },
    { value: 'source:gdelt', text: 'GDELT' },
    { value: 'source:rss', text: 'RSS' },
    { value: 'source:gnews', text: 'Google News' },
    { value: 'source:gkg', text: 'GKG' },
    { value: 'source:camara', text: 'Câmara' },
    { value: 'source:senado', text: 'Senado' },
    { value: 'source:juridico', text: 'Jurídico' },
    { value: 'source:oficial', text: 'Oficial' },
    { value: 'source:nicho', text: 'Nicho' },
  ])
  return {
    lenses: new FakeBox('lenses'),
    lensesPerson: new FakeSelect('lensesPerson'),
    lensesA,
    lensesB,
    lensesAOutlets: new FakeOutletGroup('lensesAOutlets', lensesA),
    lensesBOutlets: new FakeOutletGroup('lensesBOutlets', lensesB),
    lensesAInput: new FakeBox('lensesAInput'),
    lensesAList: new FakeBox('lensesAList'),
    lensesBInput: new FakeBox('lensesBInput'),
    lensesBList: new FakeBox('lensesBList'),
    lensesDays: new FakeSelect('lensesDays', DAYS_OPTIONS),
    lensesLimit: new FakeSelect('lensesLimit', [
      { value: '20', text: '20' },
      { value: '40', text: '40', selected: true },
      { value: '60', text: '60' },
      { value: '100', text: '100' },
    ]),
    lensesStatus: new FakeBox('lensesStatus'),
    lensesRuler: new FakeBox('lensesRuler'),
    lensesDetail: new FakeBox('lensesDetail'),
    lensesHiddenNote: new FakeBox('lensesHiddenNote'),
  }
}

// Figure 8 (issue #208), the agenda grid: no person select -- it spans every tracked person at
// once, only its own days/source and the grid host.
const agendaIds = () => ({
  agenda: new FakeBox('agenda'),
  agendaDays: new FakeSelect('agendaDays', DAYS_OPTIONS),
  agendaSource: new FakeSelect('agendaSource'),
  agendaGrid: new FakeBox('agendaGrid'),
})

// Figure 9 (issue #207): its own source/lean/min selects (days reuses the shared DAYS_OPTIONS
// convention), the matrix host and its about caption. No person control -- a shared count is
// never one person's.
const comentionIds = () => ({
  comention: new FakeBox('comention'),
  comentionDays: new FakeSelect('comentionDays', DAYS_OPTIONS),
  comentionSource: new FakeSelect('comentionSource'),
  comentionLean: new FakeSelect('comentionLean', [
    { value: 'all', text: 'todo o viés', selected: true },
    { value: 'left', text: 'esquerda' },
    { value: 'center', text: 'centro' },
    { value: 'right', text: 'direita' },
  ]),
  comentionMin: new FakeSelect('comentionMin', [
    { value: '1', text: '1' },
    { value: '2', text: '2' },
    { value: '3', text: '3', selected: true },
    { value: '5', text: '5' },
  ]),
  comentionMatrix: new FakeBox('comentionMatrix'),
  comentionAbout: new FakeBox('comentionAbout'),
})

// Figure 10 (issue #215): its own person/weeks/limit selects, the chart host and its note (the
// short-series and empty-series notes). No source/kind control.
const persistenceIds = () => ({
  persistence: new FakeBox('persistence'),
  persistencePerson: new FakeSelect('persistencePerson'),
  persistenceWeeks: new FakeSelect('persistenceWeeks', [
    { value: '4', text: '4' },
    { value: '12', text: '12', selected: true },
    { value: '26', text: '26' },
  ]),
  persistenceLimit: new FakeSelect('persistenceLimit', [
    { value: '20', text: '20' },
    { value: '40', text: '40', selected: true },
    { value: '60', text: '60' },
  ]),
  persistenceChart: new FakeBox('persistenceChart'),
  persistenceNote: new FakeBox('persistenceNote'),
})

export type Elements = ReturnType<typeof atlasIds> &
  ReturnType<typeof testimonyIds> &
  ReturnType<typeof compareIds> &
  ReturnType<typeof risingIds> &
  ReturnType<typeof weekIds> &
  ReturnType<typeof lensesIds> &
  ReturnType<typeof attentionIds> &
  ReturnType<typeof agendaIds> &
  ReturnType<typeof comentionIds> &
  ReturnType<typeof persistenceIds>

/** @returns a jsonResponse-like object `fetch` can resolve to */
export const jsonResponse = (data: unknown) => ({ ok: true, status: 200, json: async () => data })

// Installs a fake `document` carrying both figures' elements, a no-op `ResizeObserver`, and a
// browser-shaped `Option` constructor, runs `fn`, then restores every global this touched —
// same discipline as fake-dom.ts's withFakeDocument, extended to what a real mount() needs.
// `fireDocumentKeydown` fires every listener a mount() wired with `document.addEventListener`
// (week.ts today, and every figure.ts-based figure once issue #193 lands), the only document-
// level event a figure's own mount() ever wires.
export const withFiguresDom = async <T>(fn: (els: Elements, fetchCalls: string[], fireDocumentKeydown: (key: string) => void) => Promise<T> | T): Promise<T> => {
  const els = { ...atlasIds(), ...testimonyIds(), ...compareIds(), ...risingIds(), ...weekIds(), ...lensesIds(), ...attentionIds(), ...agendaIds(), ...comentionIds(), ...persistenceIds() } as Elements
  const docListeners: Record<string, ((e?: unknown) => void)[]> = {}
  const fireDocumentKeydown = (key: string) => {
    for (const fn of docListeners.keydown ?? []) fn({ key, preventDefault: () => {} })
  }
  const fakeDocument = {
    getElementById: (id: string) => (els as unknown as Record<string, unknown>)[id] ?? null,
    addEventListener: (type: string, fn: (e?: unknown) => void) => {
      ;(docListeners[type] ??= []).push(fn)
    },
    removeEventListener: () => {},
    querySelector: () => null,
    // render.ts's paintSelection calls queryAll('[data-node]') with no root (defaulting to
    // document) to toggle is-selected across every painted word, map/overflow/strip alike. A
    // real document finds every match across the tree; drawMap's own two document-rooted
    // wiring loops stay unsupported here (they need element.tagName, which these stubs never
    // carry) since no criterion in this suite clicks a map word through that path.
    querySelectorAll: (selector: string) => {
      if (selector === '[data-node]') return [...els.viewport.querySelectorAll('[data-node]'), ...els.overflow.querySelectorAll('[data-node]'), ...els.atlasStrip.querySelectorAll('[data-node]')]
      return []
    },
    // render.js's createCanvasMeasure builds the injected `measure` layout.js's packers need;
    // figures/compare.js calls it on the first paint of the ruler (issue #99, words instead of
    // dots). It writes ctx.font, then reads measureText, so the stub has to remember the font
    // to answer with a size-dependent width. A deterministic 0.6em per character is enough:
    // no criterion in this suite asserts a pixel, only which words are drawn and clickable.
    createElement: () => ({
      getContext: () => {
        const ctx = {
          font: '',
          measureText: (text: string) => {
            const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 16)
            const width = text.length * size * 0.6
            return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width }
          },
        }
        return ctx
      },
    }),
  }
  const previous = {
    document: (globalThis as { document?: unknown }).document,
    Option: (globalThis as { Option?: unknown }).Option,
    ResizeObserver: (globalThis as { ResizeObserver?: unknown }).ResizeObserver,
    fetch: globalThis.fetch,
  }
  ;(globalThis as { document?: unknown }).document = fakeDocument
  ;(globalThis as { Option?: unknown }).Option = class {
    text: string
    value: string
    constructor(text: string, value: string) {
      this.text = text
      this.value = value
    }
  }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  const fetchCalls: string[] = []
  globalThis.fetch = (async (input: unknown) => {
    fetchCalls.push(String(input))
    return jsonResponse({}) as unknown as Response
  }) as typeof fetch
  try {
    return await fn(els, fetchCalls, fireDocumentKeydown)
  } finally {
    ;(globalThis as { document?: unknown }).document = previous.document
    ;(globalThis as { Option?: unknown }).Option = previous.Option
    ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = previous.ResizeObserver
    globalThis.fetch = previous.fetch
  }
}

// Lets a test swap in a routed fetch (different JSON per endpoint) after withFiguresDom
// already installed the document, still recording every URL requested.
export const routeFetch = (fetchCalls: string[], byPath: Record<string, unknown>) => {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    fetchCalls.push(url)
    const path = new URL(url, 'http://localhost').pathname
    for (const [suffix, data] of Object.entries(byPath)) if (path.endsWith(suffix)) return jsonResponse(data) as unknown as Response
    return jsonResponse({}) as unknown as Response
  }) as typeof fetch
}

export const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms))
