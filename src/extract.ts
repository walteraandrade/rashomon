import type { Person, Term } from './types.js'

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

export const mentions = (text: string, person: Person) => {
  const n = normalize(text)
  return person.aliases.some((a) => new RegExp(`(^|[^a-z0-9])${escapeRe(normalize(a))}([^a-z0-9]|$)`).test(n))
}

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

export const nameTokens = (person: Person) =>
  uniq(
    person.aliases.flatMap((a) => normalize(a).split(/[^a-z0-9]+/)).filter((w) => w.length >= 3),
    (x) => x,
  )
