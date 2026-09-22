import { Console, Effect } from 'effect'
import type { HttpClient } from 'effect/unstable/http'
import type { Collector, Person, RawDoc } from '../types.js'
import { getBytes, parseJson, runWithFetch } from '../http.js'

const base = 'https://dadosabertos.camara.leg.br/api/v2/deputados'
const windowDays = 30
const pauseMs = 1000

const isoDate = (d: Date) => d.toISOString().slice(0, 10)

const speechesUrl = (camaraId: string) => {
  const now = new Date()
  const start = new Date(now.getTime() - windowDays * 86_400_000)
  const url = new URL(`${base}/${camaraId}/discursos`)
  url.searchParams.set('dataInicio', isoDate(start))
  url.searchParams.set('dataFim', isoDate(now))
  url.searchParams.set('ordenarPor', 'dataHoraInicio')
  url.searchParams.set('ordem', 'DESC')
  url.searchParams.set('itens', '100')
  url.searchParams.set('formato', 'json')
  return url
}

// 429/5xx retried up to 3 times, waiting pauseMs * 4 * attempt (4s, 8s, 12s) between them; any
// other status, or the 4th attempt, fails with the status and the head of the body.
const attempt = (camaraId: string, n: number): Effect.Effect<any[], Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const { status, body } = yield* getBytes(speechesUrl(camaraId))
    const text = new TextDecoder().decode(body)
    if ((status === 429 || status >= 500) && n <= 3) {
      const wait = pauseMs * 4 * n
      yield* Console.log(`[camara] ${camaraId}: ${status}, retrying in ${Math.round(wait / 1000)}s (attempt ${n}/3)`)
      yield* Effect.sleep(wait)
      return yield* attempt(camaraId, n + 1)
    }
    if (status < 200 || status >= 300) return yield* Effect.fail(new Error(`camara ${status}: ${text.trim().slice(0, 120)}`))
    return (yield* parseJson<{ dados?: any[] }>(text)).dados ?? []
  })

const toDoc = (person: Person, item: any): RawDoc | null => {
  if (!item.dataHoraInicio) return null
  const raw = String(item.dataHoraInicio)
  // dataHoraInicio is an offset-less Brasilia wall-clock; pin -03:00 so
  // publishedAt does not drift with the host's local timezone
  const stamped = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}-03:00`
  const parsed = new Date(stamped)
  if (Number.isNaN(parsed.getTime())) return null
  const publishedAt = parsed.toISOString()
  const uri = item.urlTexto || `https://www.camara.leg.br/discursos/${person.camaraId}/${item.dataHoraInicio}`
  const sumario = String(item.sumario ?? '')
  const text = `${person.name}: ${sumario}`.replace(/\s+/g, ' ').trim()
  return { source: 'camara', uri, text, publishedAt, domain: 'camara.leg.br' }
}

// A person's failure costs that person's speeches and a log line, never the run.
const collectPerson = (person: Person): Effect.Effect<RawDoc[], never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    if (!person.camaraId) return []
    const speeches = yield* attempt(person.camaraId, 1).pipe(
      Effect.catch((e) => Console.error(`[camara] ${person.id}: ${e.message}`).pipe(Effect.as([] as any[]))),
    )
    yield* Console.log(`[camara] ${person.id}: ${speeches.length} speeches`)
    yield* Effect.sleep(pauseMs)
    return speeches.map((s) => toDoc(person, s)).filter((d): d is RawDoc => d !== null)
  })

export const collect = (persons: Person[]): Effect.Effect<RawDoc[], never, HttpClient.HttpClient> =>
  Effect.forEach(persons, collectPerson).pipe(Effect.map((docs) => docs.flat()))

export const camara: Collector = (persons) => runWithFetch(collect(persons))
