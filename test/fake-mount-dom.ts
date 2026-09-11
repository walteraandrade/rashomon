// A DOM stand-in capable of running public/js/figures/atlas.js's and
// public/js/figures/testimony.js's real mount(), so issue #92's independence criteria are
// checked against the actual wiring rather than a claim about it. Unlike fake-dom.ts (which
// never needs a live click), this one captures addEventListener listeners so a test can fire
// them, and lets a container's innerHTML seed the handful of data-domain/data-strip-domain
// buttons paintOutlets/paintStrip wire — the only two dynamic click targets either figure's
// criteria in this suite actually need to press.

type Option = { value: string; textContent: string }

class Listenable {
  _listeners: Record<string, ((e?: unknown) => void)[]> = {}
  addEventListener(type: string, fn: (e?: unknown) => void) {
    ;(this._listeners[type] ??= []).push(fn)
  }
  removeEventListener() {}
  fire(type: string, e?: unknown) {
    for (const fn of this._listeners[type] ?? []) fn(e)
  }
}

const dataStubs = (html: string, attr: 'data-domain' | 'data-strip-domain' | 'data-col') =>
  [...html.matchAll(new RegExp(`${attr}="([^"]*)"`, 'g'))].map(([, value]) => {
    const stub = new Listenable() as Listenable & { dataset: Record<string, string> }
    stub.dataset = attr === 'data-domain' ? { domain: value } : attr === 'data-col' ? { col: value } : { stripDomain: value }
    return stub
  })

// paintRuler's marks (issue #91) carry two data-* attributes on the same tag (data-term and
// data-kind), unlike the single-attribute stubs above, so onPick(term, kind) reads both off
// one click. Since issue #99 a mark is either a <g> holding the word or, for a word the strip
// could not fit, a <button> in the overflow list; both are wired by the same painter loop and
// both must be reachable here, or a criterion about the list would pass vacuously.
const dataTermStubs = (html: string) =>
  [...html.matchAll(/<(?:g|button)[^>]*\bdata-term="([^"]*)"[^>]*>/g)].map(([tag, term]) => {
    const kind = /data-kind="([^"]*)"/.exec(tag)?.[1] ?? ''
    const day = /data-day="([^"]*)"/.exec(tag)?.[1]
    const stub = new Listenable() as Listenable & { dataset: Record<string, string> }
    stub.dataset = { term, kind, ...(day ? { day } : {}) }
    return stub
  })

// The person's own entry to her documents (issue: the inspector's button is gone). It carries
// no value, only the click and the Enter/Space a <button> would have handled on its own, so one
// bare listenable per occurrence is the whole stub.
const personDocsStubs = (html: string) => [...html.matchAll(/data-person-docs/g)].map(() => new Listenable())

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
  private domainStubs: { attr: 'data-domain' | 'data-strip-domain' | 'data-term' | 'data-col' | 'data-person-docs'; html: string; stubs: ReturnType<typeof dataStubs> | ReturnType<typeof dataTermStubs> | ReturnType<typeof personDocsStubs> }[] = []
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
  private stubsFor(attr: 'data-domain' | 'data-strip-domain' | 'data-term' | 'data-col' | 'data-person-docs') {
    const cached = this.domainStubs.find((e) => e.attr === attr && e.html === this.html)
    if (cached) return cached.stubs
    const stubs = attr === 'data-term' ? dataTermStubs(this.html) : attr === 'data-person-docs' ? personDocsStubs(this.html) : dataStubs(this.html, attr)
    this.domainStubs.push({ attr, html: this.html, stubs })
    return stubs
  }
  querySelectorAll(selector: string) {
    if (selector === '[data-domain]') return this.stubsFor('data-domain')
    if (selector === '[data-strip-domain]') return this.stubsFor('data-strip-domain')
    if (selector === '[data-term]') return this.stubsFor('data-term')
    if (selector === '[data-col]') return this.stubsFor('data-col')
    if (selector === '[data-person-docs]') return this.stubsFor('data-person-docs')
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

// A real <select>: options come preloaded (the static markup design-5.html already ships), or
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

class FakeInput extends Listenable {
  id: string
  value = ''
  constructor(id: string) {
    super()
    this.id = id
  }
}

// Mirrors design-5.html's #days / #testimonyDays exactly: the same three values, and the same
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
  weekRetry: new FakeBox('weekRetry'),
})

export type Elements = ReturnType<typeof atlasIds> & ReturnType<typeof testimonyIds> & ReturnType<typeof compareIds> & ReturnType<typeof weekIds>

/** @returns a jsonResponse-like object `fetch` can resolve to */
export const jsonResponse = (data: unknown) => ({ ok: true, status: 200, json: async () => data })

// Installs a fake `document` carrying both figures' elements, a no-op `ResizeObserver`, and a
// browser-shaped `Option` constructor, runs `fn`, then restores every global this touched —
// same discipline as fake-dom.ts's withFakeDocument, extended to what a real mount() needs.
export const withFiguresDom = async <T>(fn: (els: Elements, fetchCalls: string[]) => Promise<T> | T): Promise<T> => {
  const els = { ...atlasIds(), ...testimonyIds(), ...compareIds(), ...weekIds() } as Elements
  const docListeners: Record<string, ((e?: unknown) => void)[]> = {}
  const fakeDocument = {
    getElementById: (id: string) => (els as unknown as Record<string, unknown>)[id] ?? null,
    addEventListener: (type: string, fn: (e?: unknown) => void) => {
      ;(docListeners[type] ??= []).push(fn)
    },
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
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
    return await fn(els, fetchCalls)
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
