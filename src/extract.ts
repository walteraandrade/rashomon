import type { Person, Phrases, RawDoc, Term } from './types.js'

// Five obvious neighbours are deliberately absent, because a stopword also forbids a phrase
// (see `holdsStopword`): `segunda` would kill "segunda turma" (STF chamber); `marco` "marco
// aurelio"; `janeiro` "rio de janeiro"; `segundo` "segundo turno"; `dois` "dois irmaos das
// missoes".
const stopwords = new Set(
  `a o e os as um uma uns umas de do da dos das em no na nos nas por para com sem sob sobre entre ate apos ante contra desde perante
   que quem qual quais onde quando como porque pois mas porem todavia contudo entao logo nem ou seja
   eu tu ele ela nos vos eles elas me te se lhe lhes meu minha meus minhas teu tua seu sua seus suas nosso nossa nossos nossas
   este esta estes estas esse essa esses essas aquele aquela aqueles aquelas isto isso aquilo
   ser estar ter haver fazer ir vir dar ver poder querer dizer diz disse dizem afirma afirmou fala falou
   sou es somos sao era eram foi foram sera serao seria seriam esta estao estava estavam esteve
   tem tinha tinham teve tiveram tera terao ha havia houve
   nao sim mais menos muito muita muitos muitas pouco pouca poucos poucas todo toda todos todas
   ja ainda tambem so apenas aqui ali la agora hoje ontem amanha sempre nunca
   ano anos dia dias mes meses hora horas vez vezes
   feira terca quarta quinta sexta fevereiro abril maio junho julho agosto setembro outubro novembro dezembro
   alem durante foto fotos
   pelo pela pelos pelas neste nesta nesse nessa naquele naquela num numa dele dela deles delas
   voce voces gente cara tipo coisa coisas
   antes depois mesmo mesma cada outro outra outros outras qualquer alguns algumas algum alguma nada tudo
   estou esta estamos fica ficou ficam vai vao vamos deve devem pode podem quer querem
   bem mal assim ainda tambem entao pois porque quase tao tanto tanta
   bluesky bsky twitter instagram youtube tiktok
   the and for with this that from https http www com`
    .split(/\s+/)
    .filter(Boolean),
)

export const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const uniq = <T>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()]

export const hashtags = (text: string): Term[] =>
  [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => ({ term: normalize(m[1]), kind: 'hashtag' }))

const keepWord = (w: string) =>
  w.length >= 4 && !/^\d+$/.test(w) && !/(.)\1\1/.test(w) && !/^(ha|he|hu|hi|rs|ks)+$/.test(w) && !stopwords.has(w)

// Reading order is preserved so collocations match the adjacency wordPairs measures.
export const contentWords = (text: string): string[] =>
  normalize(decodeEntities(text).replace(/https?:\/\/\S+/g, ' ').replace(/[#@]\S+/g, ' '))
    .split(/[^a-z0-9]+/)
    .filter(keepWord)

export const words = (text: string): Term[] => contentWords(text).map((term) => ({ term, kind: 'word' }))

// The pairs a capitalized run already claims, so a name is not spelled two ways ("alexandre
// de moraes" from the run and "alexandre moraes" from the pair). The run wins.
const namePairs = (text: string): Set<string> =>
  new Set(
    properNouns(text).flatMap(({ term }) => {
      const ws = term.split(' ').filter(keepWord)
      return ws.slice(0, -1).map((w, i) => `${w} ${ws[i + 1]}`)
    }),
  )

// Adjacency is measured after stopwords are dropped. A word gets a null w2 when it is the
// text's last or when the pair belongs to a name; the null row still records that word's
// occurrence (phrases.ts counts unigrams from the w1 column).
export const wordPairs = (text: string): { w1: string; w2: string | null }[] => {
  const ws = contentWords(text)
  const named = namePairs(text)
  return ws.map((w1, i) => {
    const w2 = ws[i + 1]
    return { w1, w2: w2 && !named.has(`${w1} ${w2}`) ? w2 : null }
  })
}

// The lexicon decides which pairs are phrases; this only reports which of a text's pairs are in
// it. Pairs a capitalized run already claims never reach here: wordPairs has nulled them.
export const collocations = (text: string, lexicon: Phrases): Term[] =>
  wordPairs(text).flatMap(({ w1, w2 }) => (w2 && lexicon.has(`${w1} ${w2}`) ? [{ term: `${w1} ${w2}`, kind: 'phrase' as const }] : []))

// Every position where `needle` sits as a consecutive run inside `hay`. Both come from
// contentWords, which drops the same tokens in both, so a name's surviving words really are
// consecutive here even when the name itself had particles in it.
const runsAt = (hay: readonly string[], needle: readonly string[]): number[] =>
  needle.length ? hay.flatMap((_, i) => (needle.every((w, j) => hay[i + j] === w) ? [i] : [])) : []

// The token positions some phrase has already claimed in this text.
const claimed = (ws: readonly string[], text: string, lexicon: Phrases): Set<number> => {
  const marks = new Set<number>()
  for (const { term } of properNouns(text)) {
    const needle = term.split(' ').filter(keepWord)
    for (const at of runsAt(ws, needle)) needle.forEach((_, j) => marks.add(at + j))
  }
  // Which pairs a name run claimed have already been nulled by wordPairs, so there is no overlap.
  wordPairs(text).forEach(({ w1, w2 }, i) => {
    if (w2 && lexicon.has(`${w1} ${w2}`)) marks.add(i), marks.add(i + 1)
  })
  return marks
}

// Words not swallowed by any phrase. Positional: "a reforma avança; a reforma tributária passa"
// still yields "reforma" because one of its two occurrences is outside the phrase. A word only
// leaves when every occurrence of it in the text is inside a phrase.
export const standaloneWords = (text: string, lexicon: Phrases = new Set<string>()): Term[] => {
  const ws = contentWords(text)
  const marks = claimed(ws, text, lexicon)
  return ws.flatMap((term, i) => (marks.has(i) ? [] : [{ term, kind: 'word' as const }]))
}

// Proper nouns need no lexicon; collocations need one. A phrase replaces its words so
// "primeiro turno" counts as one thing said, not three slots. A word's document count means
// "documents where it appears at least once outside every phrase".
export const terms = (text: string, extra: Term[] = [], lexicon: Phrases = new Set<string>()): Term[] =>
  uniq([...hashtags(text), ...standaloneWords(text, lexicon), ...properNouns(text), ...collocations(text, lexicon), ...extra], (t) => `${t.kind}:${t.term}`)

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(\w+);/g, (m, n) => entities[n] ?? m)

const aliasRe = (alias: string) => new RegExp(`(?<![a-z0-9])${escapeRe(normalize(alias))}(?![a-z0-9])`, 'g')

// Longer aliases claim their span first, so "Flávio Bolsonaro" cannot also feed the bare
// "Bolsonaro" alias of another person. `exclude` entries are aliases owned by nobody.
export const personsMentioned = (text: string, persons: Person[]): Person[] => {
  const aliases = persons
    .flatMap((person) => [
      ...person.aliases.map((alias) => ({ id: person.id, alias })),
      ...(person.exclude ?? []).map((alias) => ({ id: undefined, alias })),
    ])
    .map(({ id, alias }) => ({ id, re: aliasRe(alias), length: normalize(alias).length }))
    .sort((a, b) => b.length - a.length)
  const { found } = aliases.reduce(
    ({ rest, found }, { id, re }) => {
      const blanked = rest.replace(re, (m) => ' '.repeat(m.length))
      return blanked === rest || !id ? { rest: blanked, found } : { rest: blanked, found: new Set([...found, id]) }
    },
    { rest: normalize(text), found: new Set<string>() },
  )
  return persons.filter((p) => found.has(p.id))
}

export const mentions = (text: string, person: Person) => personsMentioned(text, [person]).length > 0

const domainAliases: Record<string, string> = { 'redir.folha.com.br': 'folha.uol.com.br', 'www1.folha.uol.com.br': 'folha.uol.com.br' }

export const domainOf = (uri: string | undefined): string | undefined => {
  try {
    if (!uri) return undefined
    const host = new URL(uri).hostname.replace(/^www\./, '').toLowerCase()
    return domainAliases[host] ?? host
  } catch {
    return undefined
  }
}

// Cheap, noisy heuristic: a run of two or more capitalized words, particles allowed in between,
// that does not open a sentence (the first word of a sentence is capitalized for grammar, not
// because it is a name). gkg docs skip this and use the V1Persons column.
const particles = new Set(['de', 'da', 'do', 'das', 'dos'])
const sentenceSplit = /[.!?\n\r]+/
const runBreakers = /[,:;|—–"“”«»()\[\]]/g
const capitalized = /^\p{Lu}[\p{L}'’-]*$/u

const rawCapitalizedRuns = (text: string): string[] =>
  decodeEntities(text)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#@]\S+/g, ' ')
    .split(sentenceSplit)
    .flatMap((sentence) => {
      const tokens = sentence.replace(runBreakers, ' $& ').split(/\s+/).filter(Boolean)
      const runs: string[][] = []
      let run: string[] = []
      let opening = true
      const flush = () => {
        while (run.length && particles.has(run[run.length - 1].toLowerCase())) run.pop()
        if (run.filter((w) => !particles.has(w.toLowerCase())).length >= 2 && !opening) runs.push(run)
        run = []
      }
      tokens.forEach((token, i) => {
        if (capitalized.test(token)) {
          if (!run.length) opening = i === 0
          run.push(token)
        } else if (run.length && particles.has(token)) run.push(token)
        else flush()
      })
      flush()
      return runs.map((r) => r.join(' '))
    })

const tidy = (name: string) => normalize(name).replace(/\s+/g, ' ').trim()

export const capitalizedRuns = (text: string): string[] => rawCapitalizedRuns(text).map(tidy)

// A run entirely in capitals is shouting, not a name: one all-caps post could swallow a whole
// sentence as a single "name" and, since a phrase replaces its words, delete every word in it.
const shouted = (run: string) => run === run.toUpperCase()

// Four non-particle words is already generous; a longer run is a title-cased headline or a
// list of links, not a name.
const MAX_NAME_WORDS = 4

// A capitalized stopword is grammar, never part of a name: "PR Os", "Brasil O", "Whatsapp Agora".
const holdsStopword = (run: string) => tidy(run).split(' ').some((w) => !particles.has(w) && stopwords.has(w))

// Same runs /candidates discovers, but read as terms rather than as people to track, and held
// to a stricter bar. /candidates is a human review list; here a run becomes vocabulary and
// silences the words inside it. Untracked names are included: "Alexandre de Moraes" is a
// phrase in the map whether or not he is in seed.json. A person's own name is dropped at
// query time by graph.ts's name-token filter.
export const properNouns = (text: string): Term[] =>
  rawCapitalizedRuns(text).flatMap((run) => {
    // keepWord count matches contentWords so namePairs can find the run as a consecutive stretch.
    const words = tidy(run).split(' ').filter((w) => !particles.has(w) && keepWord(w))
    const usable = words.length >= 2 && words.length <= MAX_NAME_WORDS
    return usable && !shouted(run) && !holdsStopword(run) ? [{ term: tidy(run), kind: 'phrase' as const }] : []
  })

// Names that already match an alias or `exclude` entry exactly are not candidates: seed.json
// stays the curated layer. Exact, not containment, so "Michelle Bolsonaro" still surfaces.
export const discoverNames = (doc: Pick<RawDoc, 'source' | 'text' | 'extraNames'>, persons: Person[]): string[] => {
  const known = new Set(persons.flatMap((p) => [...p.aliases, ...(p.exclude ?? [])]).map((a) => normalize(a).replace(/\s+/g, ' ').trim()))
  const raw = doc.source === 'gkg' ? (doc.extraNames ?? []).map((n) => normalize(n).replace(/\s+/g, ' ').trim()) : capitalizedRuns(doc.text)
  return uniq(raw.filter((n) => n && !known.has(n)), (n) => n)
}

export const nameTokens = (person: Person) =>
  uniq(
    person.aliases.flatMap((a) => normalize(a).split(/[^a-z0-9]+/)).filter((w) => w.length >= 3),
    (x) => x,
  )
