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

const dataStubs = (html: string, attr: 'data-domain' | 'data-strip-domain') =>
  [...html.matchAll(new RegExp(`${attr}="([^"]*)"`, 'g'))].map(([, value]) => {
    const stub = new Listenable() as Listenable & { dataset: Record<string, string> }
    stub.dataset = attr === 'data-domain' ? { domain: value } : { stripDomain: value }
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
  private domainStubs: { attr: 'data-domain' | 'data-strip-domain'; html: string; stubs: ReturnType<typeof dataStubs> }[] = []
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
  set innerHTML(value: string) {
    this.html = value
    this.domainStubs = []
  }
  querySelector() {
    return null
  }
  private stubsFor(attr: 'data-domain' | 'data-strip-domain') {
    const cached = this.domainStubs.find((e) => e.attr === attr && e.html === this.html)
    if (cached) return cached.stubs
    const stubs = dataStubs(this.html, attr)
    this.domainStubs.push({ attr, html: this.html, stubs })
    return stubs
  }
  querySelectorAll(selector: string) {
    if (selector === '[data-domain]') return this.stubsFor('data-domain')
    if (selector === '[data-strip-domain]') return this.stubsFor('data-strip-domain')
    return []
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
  constructor(id: string, options: { value: string; text: string }[] = []) {
    super()
    this.id = id
    this.options = options.map((o) => ({ value: o.value, textContent: o.text }))
    this.current = this.options[0]?.value ?? ''
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
  // Both figures build the source segment list with SOURCE_SEGMENTS.map(...).join('') and
  // assign it here, and the atlas clears the person select the same way before repopulating
  // it with .add(); parsing the emitted <option> tags keeps applySeed's own option lookup
  // honest instead of special-casing "source" here.
  set innerHTML(html: string) {
    this.options = [...html.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(([, value, textContent]) => ({ value, textContent }))
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

const DAYS_OPTIONS = [
  { value: '7', text: '7 dias' },
  { value: '30', text: '30 dias' },
  { value: '90', text: '90 dias' },
  { value: '365', text: '365 dias' },
]

const atlasIds = () => ({
  workspace: new FakeBox('workspace'),
  source: new FakeSelect('source'),
  person: new FakeSelect('person'),
  days: new FakeSelect('days', DAYS_OPTIONS),
  sort: new FakeSelect('sort', [
    { value: 'count', text: 'frequência' },
    { value: 'pmi', text: 'pmi' },
  ]),
  limit: new FakeSelect('limit', [
    { value: '12', text: '12' },
    { value: '18', text: '18' },
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
  docsDialog: new FakeBox('docsDialog'),
  atlasStats: new FakeBox('atlasStats'),
  inspector: new FakeBox('inspector'),
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
})

export type Elements = ReturnType<typeof atlasIds> & ReturnType<typeof testimonyIds>

/** @returns a jsonResponse-like object `fetch` can resolve to */
export const jsonResponse = (data: unknown) => ({ ok: true, status: 200, json: async () => data })

// Installs a fake `document` carrying both figures' elements, a no-op `ResizeObserver`, and a
// browser-shaped `Option` constructor, runs `fn`, then restores every global this touched —
// same discipline as fake-dom.ts's withFakeDocument, extended to what a real mount() needs.
export const withFiguresDom = async <T>(fn: (els: Elements, fetchCalls: string[]) => Promise<T> | T): Promise<T> => {
  const els = { ...atlasIds(), ...testimonyIds() } as Elements
  const docListeners: Record<string, ((e?: unknown) => void)[]> = {}
  const fakeDocument = {
    getElementById: (id: string) => (els as unknown as Record<string, unknown>)[id] ?? null,
    addEventListener: (type: string, fn: (e?: unknown) => void) => {
      ;(docListeners[type] ??= []).push(fn)
    },
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
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
