import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { db } from '../src/db.js'
import { body, toDoc } from '../src/collectors/rss.js'
import { terms } from '../src/extract.js'
import { insertDoc, insertDocs } from '../src/store.js'
import { derivedCounts, persons, rowVersion, seed, termsOf } from './fixture.js'
import './close.js'

const now = () => new Date().toISOString()
const textOf = async (uri: string) => (await db.query<{ text: string }>(`select text from docs where uri = $1`, [uri])).rows[0]?.text ?? null
const words = (text: string) => new Set(terms(text, [], new Set<string>()).map((t) => `${t.kind}:${t.term}`))

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

describe('the longer text wins on a known uri, and its terms are re-derived', () => {
  before(seed)
  const uri = 'https://example.org/syndicated-1'
  const headline = { source: 'gnews' as const, uri, text: 'Lula fala sobre a pauta tributária', publishedAt: now(), domain: 'example.org' }
  const article = {
    source: 'rss' as const,
    uri,
    text: 'Lula fala sobre a pauta tributária. O presidente detalhou a proposta de isenção durante entrevista, citando a arrecadação prevista e o calendário de votação no Congresso.',
    publishedAt: now(),
    domain: 'example.org',
  }

  it('lands the headline first, with the headline terms', async () => {
    assert.equal(await insertDoc(headline, persons), true)
    assert.ok((await termsOf(uri)).includes('tributaria'))
    assert.ok(!(await termsOf(uri)).includes('arrecadacao'))
  })

  it('replaces the stored text when the same uri arrives with the whole article', async () => {
    const before = await rowVersion(uri)
    // Not counted as new: the uri was already known, so `written` stays 0.
    assert.equal(await insertDoc(article, persons), false)
    assert.equal(await textOf(uri), article.text)
    assert.notEqual(await rowVersion(uri), before)
  })

  it('derives the article terms and drops nothing but the stale ones', async () => {
    const stored = await termsOf(uri)
    assert.ok(stored.includes('arrecadacao'), 'a word only the article has must be there')
    assert.ok(stored.includes('tributaria'), 'a word both have must survive')
    assert.deepEqual(stored, [...new Set(stored)].sort(), 'no term may be stored twice')
  })

  it('keeps the person the headline named', async () => {
    assert.equal((await derivedCounts(uri))?.persons, 1)
  })

  it('refuses a shorter text: a truncating feed cannot undo an enrichment', async () => {
    const before = await rowVersion(uri)
    assert.equal(await insertDoc(headline, persons), false)
    assert.equal(await textOf(uri), article.text)
    assert.equal(await rowVersion(uri), before, 'nothing changed, so no row version is written')
  })
})

describe('insertDocs counts enrichment apart from new documents', () => {
  before(seed)
  const uri = 'https://example.org/syndicated-2'
  const short = { source: 'gnews' as const, uri, text: 'Bolsonaro comenta o julgamento', publishedAt: now(), domain: 'example.org' }
  const long = {
    source: 'rss' as const,
    uri,
    text: 'Bolsonaro comenta o julgamento. O ex-presidente afirmou que recorrerá da decisão e criticou o relatório apresentado pela acusação na sessão desta semana.',
    publishedAt: now(),
    domain: 'example.org',
  }
  const other = { source: 'rss' as const, uri: 'https://example.org/syndicated-3', text: 'Tarcísio anuncia investimento em Santos', publishedAt: now(), domain: 'example.org' }

  it('reports written for the new one and enriched for the replaced one', async () => {
    assert.deepEqual(await insertDocs([short], persons), { written: 1, enriched: 0, failed: 0 })
    assert.deepEqual(await insertDocs([long, other], persons), { written: 1, enriched: 1, failed: 0 })
  })

  it('counts a replay as neither: the same documents change nothing', async () => {
    assert.deepEqual(await insertDocs([long, other], persons), { written: 0, enriched: 0, failed: 0 })
  })
})

describe('stopwords for prose a headline never carried', () => {
  const dropped = ['feira', 'terca', 'quarta', 'quinta', 'sexta', 'setembro', 'outubro', 'novembro', 'dezembro', 'fevereiro', 'abril', 'maio', 'junho', 'julho', 'agosto', 'alem', 'durante', 'foto', 'fotos']

  for (const w of dropped) {
    it(`drops "${w}", a dateline or caption word measured as noise in full-text bodies`, () => {
      assert.ok(!words(`O ministro decidiu ${w} sobre o processo`).has(`word:${w}`))
    })
  }

  it('leaves the words a headline already carried alone', () => {
    const kept = words('O ministro relatou o processo sobre a delacao premiada')
    for (const w of ['ministro', 'relatou', 'processo', 'delacao', 'premiada']) assert.ok(kept.has(`word:${w}`), `${w} must survive`)
  })

  // The five that look like the ones above and are deliberately absent from the set. A stopword
  // also forbids a phrase -- holdsStopword drops a capitalized run holding one, and phrases.ts
  // measures adjacency after this set is dropped -- so each of these is asserted through the
  // phrase it would take with it, which is the thing actually at stake.
  it('keeps "marco", "dois" and "janeiro": their proper nouns still form', () => {
    assert.ok(words('O ministro Marco Aurélio abriu a divergência').has('phrase:marco aurelio'))
    assert.ok(words('A prefeitura de Dois Irmãos assinou o convênio').has('phrase:dois irmaos'))
    // "Rio de Janeiro" alone is not a phrase either way -- `rio` is three letters, below
    // keepWord's floor -- so the run that actually depends on `janeiro` is the longer one.
    assert.ok(words('o plenário da Assembleia Legislativa do Rio de Janeiro votou').has('phrase:assembleia legislativa do rio de janeiro'))
  })

  it('keeps "segundo" and "segunda": their collocations still form', () => {
    const lexicon = new Set(['segundo turno', 'segunda turma'])
    const withLexicon = (text: string) => new Set(terms(text, [], lexicon).map((t) => `${t.kind}:${t.term}`))
    assert.ok(withLexicon('a disputa foi decidida no segundo turno').has('phrase:segundo turno'))
    assert.ok(withLexicon('a segunda turma do supremo decidiu').has('phrase:segunda turma'))
  })

  // What this set does cost, written down rather than discovered later: holdsStopword refuses
  // any capitalized run holding a stopword, so these two names stop being phrases. Both were
  // measured against the corpus before the trade was taken -- "sete de setembro" at one
  // occurrence against 323 dateline uses of the bare "setembro", and "Feira de Santana" at
  // zero against 145 of "feira", which only ever arrives as half of "terça-feira".
  it('costs "Sete de Setembro" and "Feira de Santana" as phrases, the accepted price', () => {
    const setembro = words('a manifestação do Sete de Setembro reuniu apoiadores')
    assert.ok(!setembro.has('phrase:sete de setembro'))
    assert.ok(setembro.has('word:sete'), 'the run breaks, but its other words are not lost')
    const feira = words('o evento de Feira de Santana reuniu candidatos')
    assert.ok(!feira.has('phrase:feira de santana'))
    assert.ok(feira.has('word:santana'))
  })
})
