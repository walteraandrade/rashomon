import type { Collector, Person, RawDoc } from '../types.js'
import { sequential, sleep, slowGet } from '../http.js'

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

const log = (msg: string) => console.log(`[senado] ${msg}`)

type Pronunciamento = { UrlTexto?: string; TextoResumo?: string; DataPronunciamento?: string }

const fetchPronunciamentos = async (senadoId: string): Promise<Pronunciamento[]> => {
  const { status, body } = await slowGet(discursosUrl(senadoId))
  if (!body.trim().startsWith('{')) throw new Error(`senado ${status}: ${body.trim().slice(0, 80)}`)
  const parsed = JSON.parse(body) as {
    DiscursosParlamentar?: { Parlamentar?: { Pronunciamentos?: { Pronunciamento?: Pronunciamento | Pronunciamento[] } } }
  }
  const raw = parsed.DiscursosParlamentar?.Parlamentar?.Pronunciamentos?.Pronunciamento ?? []
  return Array.isArray(raw) ? raw : [raw]
}

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

const collectPerson = async (person: Person): Promise<RawDoc[]> => {
  const pronunciamentos = await fetchPronunciamentos(person.senadoId!).catch(
    (e: Error) => (console.error(`[senado] ${person.id}: ${e.message}`), []),
  )
  log(`${person.id}: ${pronunciamentos.length} pronunciamentos`)
  await sleep(pauseMs)
  return pronunciamentos.filter(hasUsableDate).map((p) => toRawDoc(person, p))
}

export const senado: Collector = async (persons) => {
  const tracked = persons.filter((p): p is Person & { senadoId: string } => Boolean(p.senadoId))
  if (!tracked.length) return []
  return (await sequential(tracked, collectPerson)).flat()
}
