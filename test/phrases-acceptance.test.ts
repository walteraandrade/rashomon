import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { db } from '../src/db.js'
import { collocations, contentWords, nameTokens, properNouns, standaloneWords, terms, wordPairs } from '../src/extract.js'
import { graphFor } from '../src/graph.js'
import { buildPhrases, loadPhrases, resetPhraseStage, stagePhrases } from '../src/phrases.js'
import { parseKindList, parseQuery } from '../src/query.js'
import { reindexAll } from '../src/reindex.js'
import { insertDoc } from '../src/store.js'
import type { GraphQuery } from '../src/graph.js'
import { persons, seed } from './fixture.js'
import './close.js'

// reindexAll clears and rebuilds every derived table, so this suite owns its own database —
// same reason test/reindex.test.ts does. The fixture is small, so the count floor is lowered
// to 2: what is under test is which pairs the floors keep, never the production numbers.
const lula = persons[0]
const wide: GraphQuery = { days: 2210, source: 'all', domain: 'all', lean: 'all', kind: 'all', limit: 200, min: 1, sort: 'count', method: null }
const termsOfKind = (nodes: { term: string; kind: string }[], kind: string) => nodes.filter((n) => n.kind === kind).map((n) => n.term)

describe('extraction reads several words as one term', () => {
  it('tokenizes once, in reading order, so words and pairs cannot disagree', () => {
    // "sobre" and "a" are stopwords; "defende" and "reforma" are not.
    assert.deepEqual(contentWords('Lula defende sobre a reforma'), ['lula', 'defende', 'reforma'])
    assert.deepEqual(wordPairs('Lula defende sobre a reforma'), [
      { w1: 'lula', w2: 'defende' },
      { w1: 'defende', w2: 'reforma' },
      // The trailing null is the last word's own occurrence, which src/phrases.ts counts as a
      // unigram; without it the last word of every text would be invisible to the denominator.
      { w1: 'reforma', w2: null },
    ])
  })

  it('measures adjacency after stopwords, so "primeiro do turno" is the same pair as "primeiro turno"', () => {
    const lexicon = new Set(['primeiro turno'])
    assert.deepEqual(collocations('primeiro turno decisivo', lexicon), [{ term: 'primeiro turno', kind: 'phrase' }])
    assert.deepEqual(collocations('primeiro do turno', lexicon), [{ term: 'primeiro turno', kind: 'phrase' }])
  })

  it('yields no collocation at all until a lexicon exists', () => {
    assert.deepEqual(collocations('primeiro turno decisivo', new Set()), [])
    assert.deepEqual(terms('primeiro turno decisivo').filter((t) => t.kind === 'phrase'), [])
  })

  it('reads a capitalized run as a phrase without any lexicon, and skips the one opening a sentence', () => {
    assert.deepEqual(properNouns('O ministro Alexandre de Moraes votou contra Jair Bolsonaro'), [
      { term: 'alexandre de moraes', kind: 'phrase' },
      { term: 'jair bolsonaro', kind: 'phrase' },
    ])
    // The first word of a sentence is capitalized for grammar, not because it is a name.
    assert.deepEqual(properNouns('Alexandre de Moraes votou'), [])
  })

  it('lets the capitalized run win over the bare pair, so one name is not spelled two ways', () => {
    const text = 'O relator Alexandre de Moraes decidiu'
    // "de" is a stopword, so the pair "alexandre moraes" would otherwise be staged and, once
    // frequent enough, tagged next to "alexandre de moraes" as a second term for one person.
    assert.deepEqual(wordPairs(text), [
      { w1: 'relator', w2: 'alexandre' },
      { w1: 'alexandre', w2: null },
      { w1: 'moraes', w2: 'decidiu' },
      { w1: 'decidiu', w2: null },
    ])
    assert.deepEqual(collocations(text, new Set(['alexandre moraes'])), [])
    assert.deepEqual(properNouns(text), [{ term: 'alexandre de moraes', kind: 'phrase' }])
  })

  it('still counts every word as a unigram when its pair is suppressed', () => {
    // The suppressed pair keeps its w1 row: src/phrases.ts reads unigram counts from that
    // column, so hiding a pair must never hide the word from the denominator.
    assert.deepEqual(
      wordPairs('O relator Alexandre de Moraes decidiu').map((r) => r.w1),
      contentWords('O relator Alexandre de Moraes decidiu'),
    )
  })

  it('takes the words away: the phrase replaces them, it does not sit beside them', () => {
    const out = terms('primeiro turno decisivo', [], new Set(['primeiro turno']))
    assert.deepEqual(termsOfKind(out, 'word'), ['decisivo'])
    assert.deepEqual(termsOfKind(out, 'phrase'), ['primeiro turno'])
  })

  it('a capitalized run takes its words away too, with no lexicon involved', () => {
    const out = terms('O relator Alexandre de Moraes decidiu hoje')
    assert.deepEqual(termsOfKind(out, 'word'), ['relator', 'decidiu'])
    assert.deepEqual(termsOfKind(out, 'phrase'), ['alexandre de moraes'])
  })

  it('keeps a word that appears once outside the phrase and once inside it', () => {
    // Presence, not count, is what doc_terms records, so the question is whether *any*
    // occurrence survives — not whether the word was ever swallowed.
    const out = terms('a reforma avanca e a reforma tributaria passa', [], new Set(['reforma tributaria']))
    assert.ok(termsOfKind(out, 'word').includes('reforma'))
    assert.ok(!termsOfKind(out, 'word').includes('tributaria'), 'tributaria only ever appears inside the phrase')
    assert.deepEqual(termsOfKind(out, 'phrase'), ['reforma tributaria'])
  })

  it('leaves every word alone while no lexicon exists', () => {
    assert.deepEqual(termsOfKind(terms('primeiro turno decisivo'), 'word'), ['primeiro', 'turno', 'decisivo'])
    assert.deepEqual(standaloneWords('primeiro turno decisivo').map((t) => t.term), ['primeiro', 'turno', 'decisivo'])
  })
})

describe('the lexicon keeps pairs that stick and drops pairs that merely co-occur', () => {
  before(async () => {
    await seed()
    await resetPhraseStage()
  })

  it('keeps a pair whose rarer word has nowhere else to be, and drops a pair riding a common word', async () => {
    process.env.MIN_PHRASE_COUNT = '3'
    process.env.MIN_PHRASE_PERCENT = '35'
    // "turno" appears only inside "primeiro turno" (3/3 = 1.0). "dias" appears eight times and
    // only twice after "faltam" (2/8 = 0.25), which is exactly the shape of the noise the
    // stickiness floor exists to reject — and its count is under the floor besides.
    await stagePhrases([
      'primeiro turno decidido',
      'primeiro turno apertado',
      'primeiro turno tranquilo',
      'faltam dias apenas',
      'faltam dias novamente',
      'poucos dias restantes',
      'longos dias seguidos',
      'outros dias quaisquer',
      'muitos dias passados',
      'certos dias marcados',
      'varios dias contados',
    ])
    await buildPhrases()
    const lexicon = await loadPhrases()
    assert.ok(lexicon.has('primeiro turno'), 'a pair its rarer word never leaves must be a phrase')
    assert.ok(!lexicon.has('faltam dias'), 'a pair riding a common word must not be a phrase')
  })

  it('empties the staging table once the lexicon is built', async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from phrase_stage`)
    assert.equal(rows[0].n, 0)
  })

  it('rebuilds whole, so a pair that stopped clearing the floors leaves', async () => {
    await resetPhraseStage()
    await stagePhrases(['outra coisa qualquer'])
    await buildPhrases()
    assert.equal((await loadPhrases()).has('primeiro turno'), false)
  })
})

describe('reindex builds the lexicon and tags the corpus with it', () => {
  before(async () => {
    await seed()
    process.env.MIN_PHRASE_COUNT = '2'
    process.env.MIN_PHRASE_PERCENT = '35'
    await reindexAll(persons)
  })

  it('reports how many phrases it kept and writes doc_terms rows of kind phrase', async () => {
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from doc_terms where kind = 'phrase'`)
    assert.ok(rows[0].n > 0, 'the fixture must yield at least one phrase row')
  })

  it('surfaces a real collocation from the fixture as one term on the map', async () => {
    const graph = await graphFor(lula, wide)
    assert.ok(termsOfKind(graph.nodes, 'phrase').includes('reforma tributaria'))
  })

  it('no longer carries "tributaria" on its own: every occurrence of it was inside the phrase', async () => {
    const graph = await graphFor(lula, wide)
    assert.ok(!termsOfKind(graph.nodes, 'word').includes('tributaria'))
  })

  it('keeps a tracked name out of the collocation lexicon, so no word is deleted with nothing put in its place', async () => {
    // "Lula defende" is frequent and perfectly sticky in the fixture, and would be a phrase but
    // for this rule. graph.ts would then hide it from Lula's own map — and, since a phrase
    // replaces its words, "defende" would vanish from that map along with it.
    const { rows } = await db.query<{ term: string }>(`select term from phrases`)
    const tracked = new Set(persons.flatMap(nameTokens))
    for (const { term } of rows) for (const word of term.split(' ')) assert.ok(!tracked.has(word), `${term} names a tracked person`)
    const graph = await graphFor(lula, wide)
    assert.ok(termsOfKind(graph.nodes, 'word').includes('defende'))
  })

  it("drops a phrase carrying one of the person's own name words from that person's own map", async () => {
    // Capitalized runs still produce them: seed.json cannot stop anyone from writing the name
    // mid-sentence, so the query-time filter is the one that has to hold.
    await insertDoc({ source: 'rss', uri: 'https://example.org/phrase-name', text: 'O deputado Jair Bolsonaro discursou', publishedAt: new Date().toISOString(), domain: 'example.org' }, persons)
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from doc_terms where kind = 'phrase' and term = 'jair bolsonaro'`)
    assert.equal(rows[0].n, 1, 'sanity: the run this filter has to hide must exist')
    const graph = await graphFor(persons[2], wide)
    for (const term of termsOfKind(graph.nodes, 'phrase')) assert.ok(!term.split(' ').includes('bolsonaro'), `${term} names the person, it is not said about them`)
  })
})

describe('kind travels as a list, so the atlas can leave GDELT themes out', () => {
  before(seed)

  it('parses a comma-separated list, drops unknown tokens and falls back to all', () => {
    assert.equal(parseKindList('word,hashtag,phrase'), 'word,hashtag,phrase')
    assert.equal(parseKindList('word,bogus'), 'word')
    assert.equal(parseKindList('bogus'), 'all')
    assert.equal(parseKindList(undefined), 'all')
    assert.equal(parseKindList('word,word'), 'word', 'duplicates collapse, as in parseSourceList')
    assert.equal(parseQuery({ kind: 'word,phrase' }).kind, 'word,phrase')
  })

  it('a lone kind still scopes exactly as the single-token parameter always did', async () => {
    const graph = await graphFor(lula, { ...wide, kind: 'hashtag' })
    assert.deepEqual([...new Set(graph.nodes.map((n) => n.kind))], ['hashtag'])
  })

  it('the list the atlas sends returns every kind except theme', async () => {
    // The fixture's only theme rows sit past 3400 days, so this one criterion needs its own
    // window; every other assertion here is happy inside `wide`.
    const deep = { ...wide, days: 3500 }
    const all = await graphFor(lula, deep)
    assert.ok(all.nodes.some((n) => n.kind === 'theme'), 'sanity: the fixture must carry a theme term to exclude')
    const atlas = await graphFor(lula, { ...deep, kind: 'word,hashtag,phrase' })
    assert.ok(!atlas.nodes.some((n) => n.kind === 'theme'))
    assert.ok(atlas.nodes.some((n) => n.kind === 'word'))
  })
})
