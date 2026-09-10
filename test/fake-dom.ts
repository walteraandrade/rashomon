// A hand-rolled stand-in for the handful of DOM calls public/js/render.js makes, so the
// markup those painters emit can be asserted under node:test without a browser or a jsdom
// dependency. It parses nothing: `querySelectorAll` returns an empty list, so a painter's
// event wiring is a no-op here and only the emitted HTML/text is captured. Anything that
// needs real event delivery belongs in the browser validation pass, not here.

export type FakeElement = {
  id: string
  textContent: string
  innerHTML: string
  hidden: boolean
  attributes: Record<string, string>
  classes: Record<string, boolean>
  classList: { toggle: (name: string, on: boolean) => void; add: (name: string) => void; remove: (name: string) => void }
  setAttribute: (name: string, value: string) => void
  getAttribute: (name: string) => string | null
  querySelectorAll: () => FakeElement[]
  querySelector: () => FakeElement | null
  addEventListener: () => void
}

// The real innerHTML setter stringifies whatever it is given, which is how an `Html` value
// from format.ts's html tag lands in the DOM; the fake does the same so tests read a string.
const element = (id: string): FakeElement => {
  let markup = ''
  const el: FakeElement = {
    id,
    textContent: '',
    get innerHTML() {
      return markup
    },
    set innerHTML(value: string) {
      markup = String(value)
    },
    hidden: false,
    attributes: {},
    classes: {},
    classList: {
      toggle: (name, on) => {
        el.classes[name] = on
      },
      add: (name) => {
        el.classes[name] = true
      },
      remove: (name) => {
        el.classes[name] = false
      },
    },
    setAttribute: (name, value) => {
      el.attributes[name] = value
    },
    getAttribute: (name) => el.attributes[name] ?? null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
  }
  return el
}

// Installs a fake `document` exposing exactly `ids`, runs `fn` with those elements, then
// restores whatever global was there before — so one suite can never leak a document into
// the next.
export const withFakeDocument = <T>(ids: string[], fn: (els: Record<string, FakeElement>) => T): T => {
  const els = Object.fromEntries(ids.map((id) => [id, element(id)]))
  const previous = (globalThis as { document?: unknown }).document
  ;(globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => els[id] ?? null,
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  try {
    return fn(els)
  } finally {
    ;(globalThis as { document?: unknown }).document = previous
  }
}

// Every style="..." literal in a blob of emitted markup, so a test can assert that only
// CSS custom properties survive there (issue #37 AC2).
export const inlineStyles = (markup: unknown) => [...String(markup).matchAll(/style="([^"]*)"/g)].map((m) => m[1])
