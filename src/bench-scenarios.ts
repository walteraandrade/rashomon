// Pure data: the request set `pnpm bench` measures. No database import, so the test suite can
// replay every scenario against the in-memory fixture and catch a scenario that stopped being
// a valid request (renamed route, dropped parameter) without running a benchmark.
export type Scenario = {
  name: string
  route: string
  url: (person: string, term: string) => string
}

const s = (name: string, route: string, url: (person: string, term: string) => string): Scenario => ({ name, route, url })

export const scenarios: Scenario[] = [
  s('people', 'people', () => `/api/people`),

  s('graph.default', 'graph', (p) => `/api/people/${p}/graph?days=30`),
  s('graph.pmi.90d', 'graph', (p) => `/api/people/${p}/graph?days=90&sort=pmi&limit=60`),
  s('graph.365d.limit200', 'graph', (p) => `/api/people/${p}/graph?days=365&limit=200&min=1`),
  s('graph.source.gkg', 'graph', (p) => `/api/people/${p}/graph?days=30&source=gkg`),
  s('graph.kind.word.min5', 'graph', (p) => `/api/people/${p}/graph?days=30&kind=word&min=5&limit=100`),
  s('graph.domain', 'graph', (p) => `/api/people/${p}/graph?days=30&domain=g1.globo.com`),
  s('graph.lean.left', 'graph', (p) => `/api/people/${p}/graph?days=30&lean=left`),

  s('sources.default', 'sources', (p) => `/api/people/${p}/sources?days=30`),
  s('sources.365d', 'sources', (p) => `/api/people/${p}/sources?days=365`),

  s('docs.default', 'docs', (p) => `/api/people/${p}/docs?days=30`),
  s('docs.term', 'docs', (p, t) => `/api/people/${p}/docs?days=30&term=${t}&kind=word`),
  s('docs.term.offset100', 'docs', (p, t) => `/api/people/${p}/docs?days=365&term=${t}&kind=word&offset=100`),

  s('timeline.week.30d', 'timeline', (p) => `/api/people/${p}/timeline?days=30&bucket=week`),
  s('timeline.day.90d', 'timeline', (p) => `/api/people/${p}/timeline?days=90&bucket=day`),
  s('timeline.term.day.365d', 'timeline', (p, t) => `/api/people/${p}/timeline?days=365&bucket=day&term=${t}&kind=word`),

  s('week.default', 'week', (p) => `/api/people/${p}/week?days=7`),

  s('tone.default', 'tone', () => `/api/tone?days=30`),
  s('tone.365d.min1', 'tone', () => `/api/tone?days=365&min=1`),

  s('testimony.default', 'testimony', (p) => `/api/people/${p}/testimony?days=30&method=stub`),
  s('testimony.365d.min1', 'testimony', (p) => `/api/people/${p}/testimony?days=365&method=stub&min=1`),

  s('rising.default', 'rising', (p) => `/api/people/${p}/rising?days=7&baseline=30`),
  s('candidates.default', 'candidates', () => `/api/candidates?days=7&min=5`),
]

// What `public/design-5.html` fires on one atlas load, in order. Measured as a group so the
// report carries the statement count of a whole UI refresh, not only of single routes.
export const atlasScenarios = ['people', 'graph.default', 'sources.default', 'docs.default', 'candidates.default']
