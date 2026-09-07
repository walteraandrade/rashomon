import type { Collector, Person, RawDoc } from '../types.js'
import { sequential, sleep, slowGet } from '../http.js'

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

const log = (msg: string) => console.log(`[camara] ${msg}`)

const fetchSpeeches = async (camaraId: string, attempt = 1): Promise<any[]> => {
  const { status, body } = await slowGet(speechesUrl(camaraId))
  if ((status === 429 || status >= 500) && attempt <= 3) {
    const wait = pauseMs * 4 * attempt
    log(`${camaraId}: ${status}, retrying in ${Math.round(wait / 1000)}s (attempt ${attempt}/3)`)
    return sleep(wait).then(() => fetchSpeeches(camaraId, attempt + 1))
  }
  if (status < 200 || status >= 300) throw new Error(`camara ${status}: ${body.trim().slice(0, 120)}`)
  return (JSON.parse(body) as { dados?: any[] }).dados ?? []
}

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

const collectPerson = async (person: Person): Promise<RawDoc[]> => {
  if (!person.camaraId) return []
  const speeches = await fetchSpeeches(person.camaraId).catch((e: Error) => (console.error(`[camara] ${person.id}: ${e.message}`), []))
  log(`${person.id}: ${speeches.length} speeches`)
  await sleep(pauseMs)
  return speeches.map((s) => toDoc(person, s)).filter((d): d is RawDoc => d !== null)
}

export const camara: Collector = async (persons) => (await sequential(persons, collectPerson)).flat()
