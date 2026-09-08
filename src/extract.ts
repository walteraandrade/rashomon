import type { Person, RawDoc, Term } from './types.js'

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

export const words = (text: string): Term[] =>
  normalize(decodeEntities(text).replace(/https?:\/\/\S+/g, ' ').replace(/[#@]\S+/g, ' '))
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !/(.)\1\1/.test(w) && !/^(ha|he|hu|hi|rs|ks)+$/.test(w) && !stopwords.has(w))
    .map((term) => ({ term, kind: 'word' }))

export const terms = (text: string, extra: Term[] = []): Term[] =>
  uniq([...hashtags(text), ...words(text), ...extra], (t) => `${t.kind}:${t.term}`)

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(\w+);/g, (m, n) => entities[n] ?? m)

const aliasRe = (alias: string) => new RegExp(`(?<![a-z0-9])${escapeRe(normalize(alias))}(?![a-z0-9])`, 'g')

// Longer aliases claim their span first, so "Flávio Bolsonaro" cannot also feed
// the bare "Bolsonaro" alias of another person. Matched text is blanked out.
// A person's `exclude` entries are aliases owned by nobody: "Ciro Nogueira" is
// blanked before the bare "Ciro" of Ciro Gomes gets a look.
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

// Candidate discovery (issue #32). Cheap and noisy on purpose: a run of two or more
// capitalized words, particles allowed in between ("Alexandre de Moraes"), that does
// not open a sentence, since the first word of a sentence is capitalized for grammar,
// not because it is a name. Only . ! ? end a sentence: a colon, quote or dash breaks
// a run but does not start a sentence, so "STF: Alexandre de Moraes manda" keeps Moraes.
// gkg docs skip the heuristic and use the V1Persons column.
const particles = new Set(['de', 'da', 'do', 'das', 'dos'])
const sentenceSplit = /[.!?\n\r]+/
const runBreakers = /[,:;|—–"“”«»()\[\]]/g
const capitalized = /^\p{Lu}[\p{L}'’-]*$/u

export const capitalizedRuns = (text: string): string[] =>
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
    .map((name) => normalize(name).replace(/\s+/g, ' ').trim())

// Names that already match an alias (or an `exclude` entry) exactly are not candidates:
// seed.json stays the curated layer on top of discovery. Exact, not containment, so
// "Michelle Bolsonaro" still surfaces while only a bare "Bolsonaro" is tracked.
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
