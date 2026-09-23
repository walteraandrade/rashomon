import { Console, Effect } from 'effect'
import type { HttpClient } from 'effect/unstable/http'
import type { Person, RawDoc } from '../types.js'
import { getBytes, parseJson } from '../http.js'

const base = 'https://legis.senado.leg.br/dadosabertos/senador'
const pauseMs = 500

const pad = (n: number) => String(n).padStart(2, '0')
const yyyymmdd = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
const toIso = (date: string) => `${date}T00:00:00Z`

const discursosUrl = (senadoId: string) => {
  const now = new Date()
  const start = new Date(now.getTime() - 30 * 86_400_000)
  const url = new URL(`${base}/${senadoId}/discursos.json`)
  url.searchParams.set('dataInicio', yyyymmdd(start))
  url.searchParams.set('dataFim', yyyymmdd(now))
  return url
}

type Pronunciamento = { UrlTexto?: string; TextoResumo?: string; DataPronunciamento?: string }

const fetchPronunciamentos = (senadoId: string): Effect.Effect<Pronunciamento[], Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const { status, body } = yield* getBytes(discursosUrl(senadoId))
    const text = new TextDecoder().decode(body)
    if (!text.trim().startsWith('{')) return yield* Effect.fail(new Error(`senado ${status}: ${text.trim().slice(0, 80)}`))
    const parsed = yield* parseJson<{
      DiscursosParlamentar?: { Parlamentar?: { Pronunciamentos?: { Pronunciamento?: Pronunciamento | Pronunciamento[] } } }
    }>(text)
    const raw = parsed.DiscursosParlamentar?.Parlamentar?.Pronunciamentos?.Pronunciamento ?? []
    return Array.isArray(raw) ? raw : [raw]
  })

// Anchored at both ends: rejects an absent date and a future 'YYYY-MM-DD HH:MM:SS' variant alike,
// so toIso never runs on an unparseable value and PGlite never sees a bare 'T00:00:00Z'.
export const hasUsableDate = (p: Pronunciamento): boolean =>
  Boolean(p.UrlTexto) && /^\d{4}-\d{2}-\d{2}$/.test(p.DataPronunciamento ?? '')

export const toRawDoc = (person: Person, p: Pronunciamento): RawDoc => ({
  source: 'senado',
  uri: p.UrlTexto!,
  text: `${person.name}: ${p.TextoResumo ?? ''}`,
  publishedAt: toIso(p.DataPronunciamento!),
  domain: 'senado.leg.br',
})

const collectPerson = (person: Person): Effect.Effect<RawDoc[], never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const pronunciamentos = yield* fetchPronunciamentos(person.senadoId!).pipe(
      Effect.catch((e) => Console.error(`[senado] ${person.id}: ${e.message}`).pipe(Effect.as([] as Pronunciamento[]))),
    )
    yield* Console.log(`[senado] ${person.id}: ${pronunciamentos.length} pronunciamentos`)
    yield* Effect.sleep(pauseMs)
    return pronunciamentos.filter(hasUsableDate).map((p) => toRawDoc(person, p))
  })

// Zero requests when no tracked person carries a senadoId: the filter runs before
// Effect.forEach ever needs the HttpClient service.
export const collect = (persons: Person[]): Effect.Effect<RawDoc[], never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const tracked = persons.filter((p): p is Person & { senadoId: string } => Boolean(p.senadoId))
    if (!tracked.length) return []
    const docs = yield* Effect.forEach(tracked, collectPerson)
    return docs.flat()
  })

