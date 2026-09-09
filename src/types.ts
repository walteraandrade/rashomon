export type Person = { id: string; name: string; aliases: string[]; exclude?: string[]; camaraId?: string; senadoId?: string }
export type Source = 'bluesky' | 'gdelt' | 'rss' | 'gnews' | 'gkg' | 'camara' | 'senado' | 'juridico' | 'oficial' | 'nicho'
export type RawDoc = {
  source: Source
  uri: string
  text: string
  publishedAt: string
  domain?: string
  tone?: number
  extraTerms?: Term[]
  extraNames?: string[]
}
export type Collector = (persons: Person[]) => Promise<RawDoc[]>
export type Term = { term: string; kind: 'hashtag' | 'word' | 'theme' | 'phrase' }
// A 'phrase' term is several words read as one unit: a proper noun the writer capitalized
// ('alexandre de moraes'), or a collocation the corpus itself shows sticking together
// ('primeiro turno'). The lexicon of the latter is built by `pnpm reindex` (src/phrases.ts)
// and passed back into extraction, so ingest and reindex tag the same pairs.
export type Phrases = ReadonlySet<string>
export type Scorer = (text: string, person: Person) => Promise<number | null>
