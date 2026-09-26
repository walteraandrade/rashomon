import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Cause, Effect, Exit } from 'effect'
import { body, collect as collectRss, fetchFeed, toDoc } from '../src/collectors/rss.js'
import { collect as collectGnews } from '../src/collectors/gnews.js'
import { collect as collectJuridico } from '../src/collectors/juridico.js'
import { collect as collectOficial } from '../src/collectors/oficial.js'
import { collect as collectNicho } from '../src/collectors/nicho.js'
import { MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS, ResponseTooLarge } from '../src/http.js'
import type { Person } from '../src/types.js'
import { drain, failureOf, fakeFetch, hanging, runTest, type Call } from './effect.js'

const ana: Person = { id: 'ana', name: 'Ana Souza', aliases: ['Ana Souza'] }
const bento: Person = { id: 'bento', name: 'Bento Lima', aliases: ['Bento Lima'] }

const rssBody = (encoding = 'UTF-8') =>
  `<?xml version="1.0" encoding="${encoding}"?><rss><channel><item><link>https://x/1</link><title>Fulano fala</title></item></channel></rss>`

// Shaped like Planalto's real feed: items sit as siblings of <channel>, not nested inside it.
const rdfBody = (items = '<item rdf:about="https://www.gov.br/planalto/pt-br/1"><title>Planalto anuncia medida</title><link>https://www.gov.br/planalto/pt-br/1</link><description>Resumo da medida.</description><content:encoded><![CDATA[<p>Texto integral da medida.</p>]]></content:encoded><dc:date>2026-09-02T18:34:00Z</dc:date></item>') =>
  `<?xml version="1.0" encoding="UTF-8"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel rdf:about="https://www.gov.br/planalto/pt-br/acompanhe-o-planalto/noticias/RSS"><title>Planalto</title></channel>${items}</rdf:RDF>`

describe('fetchFeed — behaviour, driven through a stub HttpClient.Fetch (no global fetch)', () => {
  it('parses a feed under the cap into docs', async () => {
    const fetchFn = fakeFetch(() => new Response(rssBody(), { status: 200 }))
    const exit = await runTest(fetchFeed('rss')('https://example.org/feed'), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.equal(exit.value.length, 1)
    assert.equal(exit.value[0].uri, 'https://x/1')
  })

  it('decodes a latin1-declared prolog correctly', async () => {
    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><item><link>https://x/2</link><title>Eleiu00e7u00f5es</title></item></channel></rss>`
      .replace('Eleiu00e7u00f5es', 'Eleições')
    const bytes = new Uint8Array([...Buffer.from(xml, 'latin1')])
    const fetchFn = fakeFetch(() => new Response(bytes, { status: 200 }))
    const exit = await runTest(fetchFeed('rss')('https://example.org/feed'), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.match(exit.value[0].text, /Eleições/)
  })

  it('fails on a declared content-length over MAX_RESPONSE_BYTES before reading any of the body, the message naming the feed', async () => {
    let read = false
    const stream = new ReadableStream<Uint8Array>({ pull: () => void (read = true) }, { highWaterMark: 0 })
    const fetchFn = fakeFetch(() => new Response(stream, { status: 200, headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } }))
    const error = failureOf(await runTest(fetchFeed('rss')('https://example.org/feed'), fetchFn))
    assert.ok(error instanceof ResponseTooLarge)
    assert.equal(error.stage, 'declared')
    assert.equal(read, false)
    assert.match(error.message, /^https:\/\/example\.org\/feed: response too large/)
  })

  it('fails once the streamed body exceeds MAX_RESPONSE_BYTES with no declared length, the message naming the feed', async () => {
    const chunk = new Uint8Array(MAX_RESPONSE_BYTES)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk)
        controller.enqueue(new Uint8Array([1]))
        controller.close()
      },
    })
    const fetchFn = fakeFetch(() => new Response(stream, { status: 200 }))
    const error = failureOf(await runTest(fetchFeed('rss')('https://example.org/feed'), fetchFn))
    assert.ok(error instanceof ResponseTooLarge)
    assert.equal(error.stage, 'streaming')
    assert.match(error.message, /^https:\/\/example\.org\/feed: response too large/)
  })

  it('fails with "<source> <url> <status>" on a non-2xx status, unchanged from before', async () => {
    const fetchFn = fakeFetch(() => new Response('nope', { status: 500 }))
    const error = failureOf(await runTest(fetchFeed('rss')('https://example.org/feed'), fetchFn))
    assert.match(String(error), /rss https:\/\/example\.org\/feed 500/)
  })

  it('parses an RDF (RSS 1.0) feed whose items sit as siblings of channel', async () => {
    const fetchFn = fakeFetch(() => new Response(rdfBody(), { status: 200 }))
    const exit = await runTest(fetchFeed('oficial')('https://example.org/rdf-feed'), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.equal(exit.value.length, 1)
    assert.equal(exit.value[0].uri, 'https://www.gov.br/planalto/pt-br/1')
    assert.match(exit.value[0].text, /Planalto anuncia medida/)
  })

  it('uses dc:date as publishedAt when pubDate is absent', async () => {
    const fetchFn = fakeFetch(() => new Response(rdfBody(), { status: 200 }))
    const exit = await runTest(fetchFeed('oficial')('https://example.org/rdf-feed'), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.equal(exit.value[0].publishedAt, new Date('2026-09-02T18:34:00Z').toISOString())
  })

  it('falls back to now when an RDF item has neither pubDate nor dc:date', async () => {
    const noDateItem = '<item rdf:about="https://www.gov.br/planalto/pt-br/2"><title>Sem data</title><link>https://www.gov.br/planalto/pt-br/2</link><description>Resumo.</description></item>'
    const fetchFn = fakeFetch(() => new Response(rdfBody(noDateItem), { status: 200 }))
    const exit = await runTest(fetchFeed('oficial')('https://example.org/rdf-feed'), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    assert.equal(exit.value.length, 1)
    assert.ok(exit.value[0].publishedAt)
  })

  it('a timed-out feed fails with "<source> <url>: <reason>", so a stalled feed among several is identifiable', async () => {
    const fetchFn = fakeFetch(hanging)
    const exit = await runTest(drain(fetchFeed('rss')('https://example.org/feed'), REQUEST_TIMEOUT_MS), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    const { exit: inner, elapsedMs } = exit.value
    const error = failureOf(inner)
    assert.equal(elapsedMs, REQUEST_TIMEOUT_MS)
    assert.ok(!Cause.isTimeoutError(error), 'fetchFeed wraps the bare TimeoutError with its own feed-identifying message')
    assert.match(String(error), /rss https:\/\/example\.org\/feed: /)
  })
})

describe('one failing feed short-circuits the whole run and interrupts its siblings', () => {
  it('a second, hanging feed never resolves once the first one fails', async () => {
    const fetchFn = fakeFetch((c) => (c.url.href === 'https://a/' ? new Response('boom', { status: 500 }) : hanging(c)))
    const run = Effect.forEach(['https://a/', 'https://b/'], fetchFeed('rss'), { concurrency: 'unbounded' })
    const exit = await runTest(run, fetchFn)
    assert.ok(Exit.isFailure(exit))
    const bCall = fetchFn.calls.find((c) => c.url.href === 'https://b/')
    assert.ok(bCall === undefined || bCall.signal.aborted === true, 'the sibling request must never fire, or be aborted once the run fails')
  })
})

describe('rss/juridico/oficial/nicho — each fetches its own hardcoded feed list, stamped with the family source, never a tone', () => {
  // One doc per stubbed feed URL (the stub returns the same one-item body regardless of url),
  // so the doc count also proves each family fetches its own list, not another's or none.
  const cases: [string, Effect.Effect<any[], unknown, any>, number][] = [
    ['rss', collectRss, 8],
    ['juridico', collectJuridico, 3],
    ['oficial', collectOficial, 5],
    ['nicho', collectNicho, 10],
  ]

  for (const [family, collect, feedCount] of cases) {
    it(`${family}: fetches its own ${feedCount} feeds, every RawDoc carries source: '${family}' and no tone field`, async () => {
      const fetchFn = fakeFetch(() => new Response(rssBody(), { status: 200 }))
      const exit = await runTest(collect, fetchFn)
      assert.ok(Exit.isSuccess(exit))
      assert.equal(exit.value.length, feedCount, `${family} must fetch exactly its own ${feedCount} hardcoded feeds`)
      for (const doc of exit.value) {
        assert.equal(doc.source, family)
        assert.equal('tone' in doc, false)
      }
    })
  }
})

describe('gnews — one request per person, and the query carries q/hl/gl/ceid', () => {
  it('fetches one feed per person, sequentially', async () => {
    const fetchFn = fakeFetch(() => new Response(rssBody(), { status: 200 }))
    const exit = await runTest(collectGnews([ana, bento]), fetchFn)
    assert.ok(Exit.isSuccess(exit))
    const search = (c: Call) => c.url.host === 'news.google.com'
    const calls = fetchFn.calls.filter(search)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].url.searchParams.get('q'), 'Ana Souza')
    assert.equal(calls[0].url.searchParams.get('hl'), 'pt-BR')
    assert.equal(calls[0].url.searchParams.get('gl'), 'BR')
    assert.equal(calls[0].url.searchParams.get('ceid'), 'BR:pt-419')
    assert.equal(calls[1].url.searchParams.get('q'), 'Bento Lima')
    for (const doc of exit.value) assert.equal(doc.source, 'gnews')
  })
})

describe('rss body(): content:encoded is the article a publisher syndicates on purpose', () => {
  it('prefers content:encoded over description when it carries more text', () => {
    const item = { description: '<p>Resumo curto.</p>', 'content:encoded': `<p>${'Texto integral da matéria. '.repeat(20)}</p>` }
    assert.match(body(item), /^Texto integral da mat/)
    assert.ok(body(item).length > 400)
  })

  it('keeps description when content:encoded is only a caption or an embed', () => {
    const item = { description: `<p>${'Um resumo bem longo do texto. '.repeat(20)}</p>`, 'content:encoded': '<img src="x.jpg"><figcaption>Foto: Agência</figcaption>' }
    assert.match(body(item), /^Um resumo bem longo/)
  })

  it('is inert on a feed with no content:encoded at all', () => {
    assert.equal(body({ description: '<p>Só o resumo.</p>' }), 'Só o resumo.')
    assert.equal(body({}), '')
  })

  it('strips the HTML and decodes entities, exactly as description already was', () => {
    assert.equal(body({ 'content:encoded': '<p>Lula &amp; Bolsonaro</p><p>no Congresso</p>' }), 'Lula & Bolsonaro no Congresso')
  })

  it('reaches the RawDoc: toDoc builds text from title plus the full body', () => {
    const doc = toDoc('rss')({
      link: 'https://example.org/full',
      title: 'Manchete curta',
      description: 'Resumo.',
      'content:encoded': `<p>${'Corpo inteiro da matéria com muito mais texto. '.repeat(10)}</p>`,
    })
    assert.match(doc?.text ?? '', /^Manchete curta\. Corpo inteiro/)
    assert.ok((doc?.text.length ?? 0) > 400)
  })
})

describe('collectors on Effect, drop the Promise helpers (issue #183)', () => {
  it('juridico, oficial and nicho each fetch their own distinct hardcoded feed list, every doc stamped with the family source and never a tone (issue #183 AC4)', async () => {
    const seen = new Map<string, Set<string>>()
    const stub = (name: string) =>
      fakeFetch((c) => {
        const set = seen.get(name) ?? new Set<string>()
        set.add(c.url.href)
        seen.set(name, set)
        return new Response(rssBody(), { status: 200 })
      })
    const cases: [string, Effect.Effect<any[], unknown, any>][] = [
      ['juridico', collectJuridico],
      ['oficial', collectOficial],
      ['nicho', collectNicho],
    ]
    for (const [name, collect] of cases) {
      const fetchFn = stub(name)
      const exit = await runTest(collect, fetchFn)
      assert.ok(Exit.isSuccess(exit))
      assert.ok(exit.value.length > 0, `${name} must fetch at least one feed`)
      for (const doc of exit.value) {
        assert.equal(doc.source, name)
        assert.equal('tone' in doc, false)
      }
    }
    const [juridicoUrls, oficialUrls, nichoUrls] = ['juridico', 'oficial', 'nicho'].map((n) => [...(seen.get(n) ?? new Set())].sort().join('|'))
    assert.ok(juridicoUrls && oficialUrls && nichoUrls, 'each family must actually issue requests')
    assert.equal(new Set([juridicoUrls, oficialUrls, nichoUrls]).size, 3, 'each family must fetch its own distinct feed list, not another\'s')
  })

  it('a declared content-length over the cap fails before any byte is read, and a body that grows past the cap while streaming fails and cancels the stream (issue #183 AC5)', async () => {
    let readDeclared = false
    const declaredStream = new ReadableStream<Uint8Array>({ pull: () => void (readDeclared = true) }, { highWaterMark: 0 })
    const declaredFetch = fakeFetch(() => new Response(declaredStream, { status: 200, headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } }))
    const declaredError = failureOf(await runTest(fetchFeed('rss')('https://example.org/big'), declaredFetch))
    assert.ok(declaredError instanceof ResponseTooLarge)
    assert.equal(declaredError.stage, 'declared')
    assert.equal(readDeclared, false, 'must not read any byte once the declared length is over the cap')

    // Four chunks, not two: the first two sum to exactly MAX_RESPONSE_BYTES (not over, the
    // check is strict >), the third tips it over -- with a fourth still queued and unread, so
    // the underlying stream is still 'readable' (not already closed) when getBytes cancels it,
    // proving a genuine cancellation rather than a no-op on an already-drained stream.
    let cancelled = false
    const half = Math.floor(MAX_RESPONSE_BYTES / 2)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(half))
        controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES - half))
        controller.enqueue(new Uint8Array([1]))
        controller.enqueue(new Uint8Array([1]))
        controller.close()
      },
      cancel: () => void (cancelled = true),
    })
    const streamingFetch = fakeFetch(() => new Response(stream, { status: 200 }))
    const streamingError = failureOf(await runTest(fetchFeed('rss')('https://example.org/stream'), streamingFetch))
    assert.ok(streamingError instanceof ResponseTooLarge)
    assert.equal(streamingError.stage, 'streaming')
    assert.equal(cancelled, true, 'the stream must be cancelled once the running total exceeds the cap, no partial body kept')
  })

  it('one failing feed among several fails the whole run and interrupts the in-flight siblings (issue #183 AC6)', async () => {
    const fetchFn = fakeFetch((c) => (c.url.href === 'https://fails.example/' ? new Response('boom', { status: 500 }) : hanging(c)))
    const run = Effect.forEach(['https://fails.example/', 'https://sibling-a.example/', 'https://sibling-b.example/'], fetchFeed('rss'), { concurrency: 'unbounded' })
    const exit = await runTest(run, fetchFn)
    assert.ok(Exit.isFailure(exit))
    for (const url of ['https://sibling-a.example/', 'https://sibling-b.example/']) {
      const call = fetchFn.calls.find((c) => c.url.href === url)
      assert.ok(call === undefined || call.signal.aborted === true, `${url} must either never fire or be interrupted once the run fails`)
    }
  })
})
