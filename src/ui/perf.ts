// User Timing marks for the page: one measure per API call (`api:<route>`) and one per
// figure from "asked" to "painted" (`figure:<name>`). Entries land in the browser's
// performance timeline (DevTools > Performance > Timings) and in
// performance.getEntriesByType('measure'). No DOM, no network, no storage.

export type SpanDetail = Record<string, string | number | null>

// Returns the closer: call it once the work is on screen. A closer never called (a request
// superseded or aborted) leaves no entry, so the timeline only holds finished work. A
// closer never throws: instrumentation must not turn a painted figure into an outage.
export const span = (name: string) => {
  const started = performance.now()
  return (detail: SpanDetail = {}) => {
    const ms = performance.now() - started
    try {
      performance.measure(name, { start: started, end: started + ms, detail })
    } catch {}
    return ms
  }
}

// A memo hit records the pair the figure's measure is subtracted from, so `figure − api`
// stays a paint even when no request left the tab.
export const memoHit = (route: string, key: string) => span('api:' + route)({ url: key, status: null, cache: 'memory', server: null })

// '/api/people/lula/graph?days=30' -> 'graph'; '/api/compare?a=..' -> 'compare'; '/api/people' -> 'people'.
export const routeOf = (url: string) => {
  const path = url.split('?')[0]
  return path.split('/').filter(Boolean).pop() ?? ''
}

// The measures recorded so far, oldest first, for a console or a test.
export const measures = (prefix = '') => performance.getEntriesByType('measure').filter((e) => e.name.startsWith(prefix))
