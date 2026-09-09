import type { Person, RawDoc, Source, Term } from './types.js'

// Deterministic synthetic corpus for `pnpm bench`. Pure: no database, no network, no clock
// beyond the `now` passed in, so the same seed always yields the same documents and a
// baseline can be compared across machines and across the PRs stacked on top of it.
export type CorpusOptions = { docs: number; days: number; seed: number; now: number }

// mulberry32: 32 bits of state, uniform enough for a workload shape and reproducible anywhere.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const HEAD = `reforma tributaria economia congresso governo eleicao ministro senado camara justica orcamento imposto
  seguranca educacao saude inflacao desemprego juros combustivel petrobras infraestrutura rodovia aeroporto porto
  privatizacao concessao emenda relatoria votacao plenario comissao audiencia denuncia investigacao operacao
  pesquisa intencao candidatura aliança partido federacao coligacao campanha palanque discurso entrevista`
  .split(/\s+/)
  .filter(Boolean)

// Head terms carry the shape a real corpus has (a few words everywhere, a long thin tail);
// the tail is synthetic so the vocabulary size, not its meaning, is what drives the plans.
export const vocabulary = (tail: number): string[] => [...HEAD, ...Array.from({ length: tail }, (_, i) => `termo${String(i).padStart(4, '0')}`)]

export const DOMAINS = [
  'g1.globo.com', 'folha.uol.com.br', 'estadao.com.br', 'oglobo.globo.com', 'valor.globo.com', 'uol.com.br',
  'terra.com.br', 'r7.com', 'band.uol.com.br', 'cnnbrasil.com.br', 'metropoles.com', 'gazetadopovo.com.br',
  'correiobraziliense.com.br', 'em.com.br', 'zerohora.com.br', 'atarde.com.br', 'diariodonordeste.com.br',
  'poder360.com.br', 'cartacapital.com.br', 'oantagonista.com.br', 'crusoe.com.br', 'brasil247.com',
  'agenciabrasil.ebc.com.br', 'camara.leg.br', 'senado.leg.br', 'gdeltproject.org',
]

const HANDLES = Array.from({ length: 40 }, (_, i) => `perfil${i}.bsky.social`)

// Weights follow the production mix: gkg dominates, gdelt/legislative/press collectors are
// rare. rss shrinks by the sum of the three new families' weights so the column still sums to 1.
const SOURCES: [Source, number][] = [
  ['gkg', 0.42], ['gnews', 0.2], ['rss', 0.14], ['bluesky', 0.13], ['gdelt', 0.03], ['camara', 0.01], ['senado', 0.01],
  ['juridico', 0.01], ['oficial', 0.02], ['nicho', 0.03],
]

const THEMES = Array.from({ length: 60 }, (_, i) => `TAX_THEME_${i}`)

const CANDIDATE_NAMES = [
  'Hugo Motta', 'Renan Calheiros', 'Rodrigo Pacheco', 'Arthur Lira', 'Fernando Haddad', 'Paulo Guedes',
  'Carla Zambelli', 'Marina Silva', 'Simone Tebet', 'Alexandre Padilha',
]

const pick = <T>(xs: T[], r: number) => xs[Math.floor(r * xs.length) % xs.length]

const weighted = (r: number): Source => {
  let acc = 0
  for (const [source, w] of SOURCES) {
    acc += w
    if (r < acc) return source
  }
  return 'rss'
}

// u^2.5 pulls draws toward index 0: the head words land in most documents, the tail in a few.
const zipf = (words: string[], r: number) => words[Math.floor(words.length * Math.pow(r, 2.5))]

export const corpus = (persons: Person[], o: CorpusOptions): RawDoc[] => {
  const rand = rng(o.seed)
  const words = vocabulary(600)
  return Array.from({ length: o.docs }, (_, i) => {
    const source = weighted(rand())
    // Recency skew: half the window holds most of the documents, as with a live collector.
    const ageDays = o.days * Math.pow(rand(), 2)
    const publishedAt = new Date(o.now - ageDays * 86_400_000).toISOString()
    const length = 8 + Math.floor(rand() * 18)
    const body = Array.from({ length }, () => zipf(words, rand()))
    // Roughly a third of documents name a tracked person, matching the measured production
    // ratio; the other two thirds keep their docs row and get no doc_terms (issue #52).
    const named = rand() < 0.33
    const person = pick(persons, rand())
    const head = named ? pick(person.aliases, rand()) : ''
    const candidate = rand() < 0.3 ? `com ${pick(CANDIDATE_NAMES, rand())}` : ''
    const hashtag = rand() < 0.15 ? `#${zipf(words, rand())}` : ''
    const text = [head ? `${head} debate` : 'Analise sobre', body.join(' '), candidate, hashtag].filter(Boolean).join(' ')
    const domain = source === 'bluesky' ? pick(HANDLES, rand()) : pick(DOMAINS, rand())
    const extraTerms: Term[] =
      source === 'gkg'
        ? Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({ term: pick(THEMES, rand()), kind: 'theme' as const }))
        : []
    // Only gdelt/gkg carry tone; insertDoc drops it for anything else anyway.
    const tone = source === 'gkg' || source === 'gdelt' ? Math.round((rand() * 12 - 7) * 100) / 100 : undefined
    return { source, uri: `https://bench.local/${source}/${i}`, text, publishedAt, domain, tone, extraTerms }
  })
}
