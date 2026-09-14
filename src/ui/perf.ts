// User Timing marks for the page: one measure per API call (`api:<route>`) and one per
// figure from "asked" to "painted" (`figure:<name>`). Entries land in the browser's
// performance timeline (DevTools > Performance > Timings) and in
// performance.getEntriesByType('measure'). No DOM, no network, no storage.

export type SpanDetail = Record<string, string | number | null>

// Returns the closer: call it once the work is on screen. A closer never called (a request
// superseded or aborted) leaves no entry, so the timeline only holds finished work.
export const span = (name: string) => {
  const started = performance.now()
  return (detail: SpanDetail = {}) => {
    const ms = performance.now() - started
    performance.measure(name, { start: started, end: started + ms, detail })
    return ms
  }
}

// '/api/people/lula/graph?days=30' -> 'graph'; '/api/compare?a=..' -> 'compare'; '/api/people' -> 'people'.
export const routeOf = (url: string) => {
  const path = url.split('?')[0]
  return path.split('/').filter(Boolean).pop() ?? ''
}

// The measures recorded so far, oldest first, for a console or a test.
export const measures = (prefix = '') => performance.getEntriesByType('measure').filter((e) => e.name.startsWith(prefix))
