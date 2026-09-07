export type Person = { id: string; name: string; aliases: string[]; exclude?: string[]; camaraId?: string; senadoId?: string }
export type Source = 'bluesky' | 'gdelt' | 'rss' | 'gnews' | 'gkg' | 'camara' | 'senado'
export type RawDoc = {
  source: Source
  uri: string
  text: string
  publishedAt: string
  domain?: string
  tone?: number
  extraTerms?: Term[]
}
export type Collector = (persons: Person[]) => Promise<RawDoc[]>
export type Term = { term: string; kind: 'hashtag' | 'word' | 'theme' }
export type Scorer = (text: string, person: Person) => Promise<number | null>
