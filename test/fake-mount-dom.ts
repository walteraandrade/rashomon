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
  private domainStubs: { attr: 'data-domain' | 'data-strip-domain' | 'data-term' | 'data-col' | 'data-node' | 'data-person-docs' | 'data-related' | 'data-day' | 'data-person' | 'data-week'; html: string; stubs: ReturnType<typeof dataStubs> | ReturnType<typeof dataTermStubs> | ReturnType<typeof personDocsStubs> | ReturnType<typeof dataPersonStubs> | ReturnType<typeof dataWeekStubs> }[] = []
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
  private stubsFor(attr: 'data-domain' | 'data-strip-domain' | 'data-term' | 'data-col' | 'data-node' | 'data-person-docs' | 'data-related' | 'data-day' | 'data-person' | 'data-week') {
    const cached = this.domainStubs.find((e) => e.attr === attr && e.html === this.html)
    if (cached) return cached.stubs
    const stubs = attr === 'data-term' ? dataTermStubs(this.html) : attr === 'data-person-docs' ? personDocsStubs(this.html) : attr === 'data-person' ? dataPersonStubs(this.html) : attr === 'data-week' ? dataWeekStubs(this.html) : dataStubs(this.html, attr)
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

// Mirrors atlas.html's #days / #testimonyDays exactly: the same three values, and the same
// `selected` default. A harness that offered a value the page does not have (or defaulted to the
// first option instead of the marked one) would green-light a seed bug the real page would hit.
const DAYS_OPTIONS = [
  { value: '7', text: 'últimos 7 dias' },
  { value: '30', text: 'últimos 30 dias', selected: true },
  { value: '60', text: 'últimos 60 dias' },
]

const docsCardIds = () => ({
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

export type Elements = ReturnType<typeof docsCardIds> &
  ReturnType<typeof compareIds> &
  ReturnType<typeof risingIds> &
  ReturnType<typeof attentionIds>

/** @returns a jsonResponse-like object `fetch` can resolve to */
export const jsonResponse = (data: unknown) => ({ ok: true, status: 200, json: async () => data })

// Installs a fake `document` carrying both figures' elements, a no-op `ResizeObserver`, and a
// browser-shaped `Option` constructor, runs `fn`, then restores every global this touched —
// same discipline as fake-dom.ts's withFakeDocument, extended to what a real mount() needs.
// `fireDocumentKeydown` fires every listener a mount() wired with `document.addEventListener`
// (week.ts today, and every figure.ts-based figure once issue #193 lands), the only document-
// level event a figure's own mount() ever wires.
export const withFiguresDom = async <T>(fn: (els: Elements, fetchCalls: string[], fireDocumentKeydown: (key: string) => void) => Promise<T> | T): Promise<T> => {
  const els = { ...docsCardIds(), ...compareIds(), ...risingIds(), ...attentionIds() } as Elements
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
