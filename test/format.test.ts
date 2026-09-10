import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  domainSuffix,
  fmt,
  html,
  kinds,
  label,
  matching,
  normalize,
  relatedTo,
  safeDocUrl,
  score,
  scoreName,
  sourceLabels,
  raw,
  toneColor,
} from '../src/ui/format.js'

describe('html', () => {
  it('escapes the five HTML-sensitive characters in every interpolation', () => {
    assert.equal(String(html`<p>${`<a href="x">&'</a>`}</p>`), '<p>&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;</p>')
  })
  it('passes nested html through, joins arrays, drops null and undefined, keeps numbers', () => {
    const inner = html`<b>${'<i>'}</b>`
    assert.equal(String(html`<p>${inner}${[inner, '<']}${null}${undefined}${3}</p>`), '<p><b>&lt;i&gt;</b><b>&lt;i&gt;</b>&lt;3</p>')
  })
  it('raw marks markup built elsewhere as trusted', () => {
    assert.equal(String(html`<p>${raw('<b>x</b>')}</p>`), '<p><b>x</b></p>')
  })
})

describe('fmt', () => {
  it('formats with pt-BR grouping and caps at 2 decimals', () => {
    assert.equal(fmt(1234.5), '1.234,5')
    assert.equal(fmt(1234.567), '1.234,57')
  })

  it('treats null/undefined as zero', () => {
    assert.equal(fmt(null), '0')
    assert.equal(fmt(undefined), '0')
  })
})

describe('label', () => {
  it('prefixes a hashtag node with #, leaves other kinds bare', () => {
    assert.equal(label({ kind: 'hashtag', term: 'lula' }), '#lula')
    assert.equal(label({ kind: 'word', term: 'lula' }), 'lula')
    assert.equal(label({ kind: 'theme', term: 'economia' }), 'economia')
  })
})

describe('normalize', () => {
  it('strips accents, lowercases and trims', () => {
    assert.equal(normalize('  TARCÍSIO de Freitas  '), 'tarcisio de freitas')
  })
})

describe('kinds / sourceLabels', () => {
  it('kinds carries a pt-BR label for every graph node kind', () => {
    assert.deepEqual(kinds, { word: 'Palavra', hashtag: 'Hashtag', phrase: 'Expressão' })
  })

  it('sourceLabels never leaves the raw internal token "all" unlabeled in pt-BR UI copy', () => {
    assert.equal(sourceLabels.all, 'todas as fontes')
    assert.notEqual(sourceLabels.all, 'all')
    for (const [key, value] of Object.entries(sourceLabels)) assert.notEqual(value, key, `${key} must not fall back to its raw internal token`)
  })
})

describe('score / scoreName', () => {
  const n = { count: 10, pmi: 2 }

  it('sort=count uses raw count', () => {
    assert.equal(score(n, 'count'), 10)
  })

  it('sort=pmi uses pmi * ln(1 + count), matching src/graph.ts sort=pmi on purpose', () => {
    assert.ok(Math.abs(score(n, 'pmi') - 2 * Math.log1p(10)) < 1e-9)
  })

  it('scoreName names each sort mode in pt-BR', () => {
    assert.equal(scoreName('count'), 'frequência em documentos')
    assert.equal(scoreName('pmi'), 'PMI × ln(1 + docs)')
  })
})

describe('matching', () => {
  it('matches accent- and case-insensitively against the node label', () => {
    assert.ok(matching({ kind: 'word', term: 'inflação' }, 'INFLACAO'))
    assert.ok(!matching({ kind: 'word', term: 'inflação' }, 'emprego'))
  })
})

describe('relatedTo', () => {
  const node = (id: string) => ({ id, term: id, kind: 'word', count: 1, pmi: 1 })
  const nodes = [node('a'), node('b'), node('c')]
  const links = [
    { source: 'a', target: 'b', count: 3 },
    { source: 'c', target: 'a', count: 7 },
  ]

  it('finds neighbors on either side of a link, sorted by count desc', () => {
    const related = relatedTo(nodes, links, 'a')
    assert.deepEqual(
      related.map((r: { node: { id: string } }) => r.node.id),
      ['c', 'b'],
    )
  })

  it('returns nothing for a node with no links', () => {
    assert.deepEqual(relatedTo(nodes, links, 'z'), [])
  })
})

describe('domainSuffix', () => {
  it('is empty for "all", " · <domain>" otherwise', () => {
    assert.equal(domainSuffix('all'), '')
    assert.equal(domainSuffix('estadao.com.br'), ' · estadao.com.br')
  })
})

describe('toneColor', () => {
  it('is transparent for null/undefined/NaN', () => {
    assert.equal(toneColor(null), 'transparent')
    assert.equal(toneColor(undefined), 'transparent')
    assert.equal(toneColor(Number.NaN), 'transparent')
  })

  it('returns an rgb() string for a real tone value', () => {
    assert.match(toneColor(2), /^rgb\(\d+,\d+,\d+\)$/)
    assert.match(toneColor(-2), /^rgb\(\d+,\d+,\d+\)$/)
  })
})

describe('safeDocUrl', () => {
  it('prefers the bsky.app URL for a bluesky doc', () => {
    const d = { source: 'bluesky', domain: 'ana.bsky.social', uri: 'at://did:plc:x/app.bsky.feed.post/abc123' }
    assert.equal(safeDocUrl(d), 'https://bsky.app/profile/ana.bsky.social/post/abc123')
  })

  it('falls back to the raw http(s) uri for other sources', () => {
    assert.equal(safeDocUrl({ source: 'gnews', uri: 'https://g1.globo.com/x' }), 'https://g1.globo.com/x')
  })

  it('rejects a non-http(s) uri and never throws', () => {
    assert.equal(safeDocUrl({ source: 'gnews', uri: 'javascript:alert(1)' }), null)
    assert.equal(safeDocUrl({ source: 'gnews', uri: undefined }), null)
  })
})
