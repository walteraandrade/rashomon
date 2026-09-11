import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MASK_MIN,
  SCALE_MID,
  SOURCE_SEGMENTS,
  balanceColor,
  bskyUrl,
  domainSuffix,
  fmt,
  foldTestimonyDomains,
  html,
  kinds,
  label,
  maskColor,
  matching,
  mergeOutlets,
  normalize,
  relatedTo,
  safeDocUrl,
  score,
  scoreName,
  signed,
  sourceLabels,
  raw,
  termMask,
  testimonyClass,
  testimonyColor,
  testimonyFocus,
  testimonyPosition,
  toneColor,
  trendOf,
} from '../src/ui/format.js'

// src/ui/format.ts: pure formatting, labels, colour ramps and the outlet merge. No DOM.

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

describe('bskyUrl', () => {
  it('AC1: maps a well-formed bluesky doc to its bsky.app post URL', () => {
    const d = { source: 'bluesky', domain: 'ana.bsky.social', uri: 'at://did:plc:x/app.bsky.feed.post/abc123' }
    assert.equal(bskyUrl(d), 'https://bsky.app/profile/ana.bsky.social/post/abc123')
  })

  it('AC1: uses the last uri segment as rkey regardless of collection (repost/quote)', () => {
    const d = { source: 'bluesky', domain: 'ana.bsky.social', uri: 'at://did:plc:x/app.bsky.feed.repost/xyz789' }
    assert.equal(bskyUrl(d), 'https://bsky.app/profile/ana.bsky.social/post/xyz789')
  })

  it('AC2: returns null when uri does not start with at://', () => {
    const d = { source: 'bluesky', domain: 'ana.bsky.social', uri: 'https://bsky.app/profile/ana.bsky.social/post/abc123' }
    assert.equal(bskyUrl(d), null)
  })

  it('AC2: returns null when domain is null', () => {
    const d = { source: 'bluesky', domain: null, uri: 'at://did:plc:x/app.bsky.feed.post/abc123' }
    assert.equal(bskyUrl(d), null)
  })

  it('AC2: returns null when domain is an empty string', () => {
    const d = { source: 'bluesky', domain: '', uri: 'at://did:plc:x/app.bsky.feed.post/abc123' }
    assert.equal(bskyUrl(d), null)
  })

  it('AC2: returns null when domain is undefined', () => {
    const d = { source: 'bluesky', uri: 'at://did:plc:x/app.bsky.feed.post/abc123' }
    assert.equal(bskyUrl(d), null)
  })

  it('AC2: returns null when the uri ends in a trailing slash (empty rkey)', () => {
    const d = { source: 'bluesky', domain: 'ana.bsky.social', uri: 'at://did:plc:y/' }
    assert.equal(bskyUrl(d), null)
  })

  it('AC4: returns null for a non-bluesky source, even with an at:// uri and a domain', () => {
    const d = { source: 'gnews', domain: 'ana.bsky.social', uri: 'at://did:plc:x/app.bsky.feed.post/abc123' }
    assert.equal(bskyUrl(d), null)
  })

  it('never throws on malformed input', () => {
    // bskyUrl has no type annotations (plain JS module): these calls exercise the catch-all
    // guard with garbage input a real caller could pass at runtime, deliberately outside what
    // a typed signature would allow.
    assert.doesNotThrow(() => bskyUrl(null))
    assert.equal(bskyUrl(null), null)
    assert.equal(bskyUrl({ source: 'bluesky', domain: 'x', uri: 42 }), null)
  })
})

describe('testimony helpers: testimonyClass, testimonyColor, testimonyPosition, signed', () => {
  it('testimonyClass follows the model cut at ±2.5 and stays null without a score', () => {
    assert.equal(testimonyClass(-2.5), 'negativo')
    assert.equal(testimonyClass(-2.49), 'neutro')
    assert.equal(testimonyClass(2.49), 'neutro')
    assert.equal(testimonyClass(2.5), 'positivo')
    assert.equal(testimonyClass(null), null)
    assert.equal(testimonyClass(undefined), null)
  })

  it('testimonyColor is transparent without a score and saturates at ±5; toneColor keeps its ±3 range', () => {
    assert.equal(testimonyColor(null), 'transparent')
    assert.equal(testimonyColor(-5), testimonyColor(-10), 'below -5 nothing gets redder')
    assert.equal(testimonyColor(5), testimonyColor(10))
    assert.notEqual(testimonyColor(-2), testimonyColor(2))
    assert.equal(toneColor(-3), 'rgb(255,107,125)', 'the tone ramp is unchanged by the refactor')
    assert.equal(toneColor(3), 'rgb(126,231,135)')
    assert.equal(toneColor(0), 'rgb(139,144,156)')
    assert.equal(toneColor(null), 'transparent')
  })

  it('testimonyPosition maps -10..+10 onto 0..100% and signed() shows the sign', () => {
    assert.equal(testimonyPosition(-10), 0)
    assert.equal(testimonyPosition(0), 50)
    assert.equal(testimonyPosition(10), 100)
    assert.equal(testimonyPosition(25), 100, 'clamped')
    assert.equal(signed(1.5), '+1,5')
    assert.equal(signed(-2.16), '-2,16')
    assert.equal(signed(0), '0')
  })
})

describe('the mask colours: maskColor and termMask', () => {
  it('maskColor is translucent on the mean and opaque at the ends; the chip ramps stay opaque', () => {
    assert.equal(maskColor(0), 'rgba(139,144,156,0.50)')
    assert.equal(maskColor(-0.75), 'rgba(197,126,141,0.75)', 'halfway: colour and alpha both halfway')
    assert.equal(maskColor(-1.5), 'rgb(255,107,125)')
    assert.equal(maskColor(9), 'rgb(126,231,135)')
    assert.equal(SCALE_MID, '#8b909c')
    assert.equal(testimonyColor(0), 'rgb(139,144,156)', 'a chip with dark text needs a solid background')
    assert.equal(toneColor(0), testimonyColor(0))
  })

  it('termMask centres on the person, is null under MASK_MIN texts or without a person mean', () => {
    assert.equal(MASK_MIN, 3)
    assert.equal(termMask({ testimony: { score: -2.4, n: 10 } }, -2.4), maskColor(0), 'on the mean: the neutral middle')
    assert.equal(termMask({ testimony: { score: -3.9, n: 10 } }, -2.4), maskColor(-1.5), 'MASK_SPAN below the person: full red')
    assert.equal(termMask({ testimony: { score: -3.9, n: 10 } }, -2.4), termMask({ testimony: { score: -9, n: 10 } }, -2.4), 'clamped past the span')
    assert.equal(termMask({ testimony: { score: -4.9, n: 10 } }, -2.4), toneColor(-3), 'the red end is the same red as tone')
    assert.equal(termMask({ testimony: { score: 3, n: 2 } }, -2.4), null, 'two texts is noise')
    assert.equal(termMask({ testimony: null }, -2.4), null)
    assert.equal(termMask({ testimony: { score: 3, n: 9 } }, null), null)
    assert.equal(termMask({ testimony: { score: -2.4, n: 10 } }, -2.4), termMask({ testimony: { score: 1, n: 10 } }, 1), 'same distance, same colour, whoever the person is')
  })
})

describe('testimonyFocus / foldTestimonyDomains / mergeOutlets: one outlet across its sources', () => {
  it('testimonyFocus folds one outlet across its sources, weighted by texts', () => {
    const rows = [
      { domain: 'g1.globo.com', source: 'gnews', score: -4, n: 3 },
      { domain: 'g1.globo.com', source: 'rss', score: -1, n: 1 },
      { domain: 'bbc.com', source: 'gnews', score: 2, n: 5 },
    ]
    assert.deepEqual(testimonyFocus(rows, 'g1.globo.com'), { score: -3.25, n: 4 })
    assert.deepEqual(testimonyFocus(rows, 'bbc.com'), { score: 2, n: 5 })
    assert.equal(testimonyFocus(rows, 'all'), null)
    assert.equal(testimonyFocus(rows, 'nobody.example'), null)
  })

  it('foldTestimonyDomains merges one outlet across sources, weighted by texts, most texts first', () => {
    const folded = foldTestimonyDomains([
      { domain: 'g1.globo.com', source: 'gnews', score: -4, n: 3 },
      { domain: 'bbc.com', source: 'gnews', score: 2, n: 5 },
      { domain: 'g1.globo.com', source: 'rss', score: -1, n: 1 },
      { domain: 'nil.example', source: 'rss', score: null, n: 0 },
    ])
    assert.deepEqual(folded, [
      { domain: 'bbc.com', sources: ['gnews'], score: 2, n: 5 },
      { domain: 'g1.globo.com', sources: ['gnews', 'rss'], score: -3.25, n: 4 },
    ])
  })

  it('mergeOutlets keeps every outlet, attaches a mean only where one exists, and orders by documents', () => {
    const merged = mergeOutlets(
      [
        { domain: 'small.example', source: 'rss', docs: 2, tone: null },
        { domain: 'g1.globo.com', source: 'gnews', docs: 13, tone: null },
        { domain: 'g1.globo.com', source: 'rss', docs: 5, tone: null },
      ],
      [
        { domain: 'g1.globo.com', source: 'gnews', score: -4, n: 3 },
        { domain: 'g1.globo.com', source: 'rss', score: -1, n: 1 },
      ],
    )
    assert.deepEqual(merged, [
      { domain: 'g1.globo.com', sources: ['gnews', 'rss'], docs: 18, score: -3.25, n: 4 },
      { domain: 'small.example', sources: ['rss'], docs: 2, score: null, n: 0 },
    ])
  })

  it('mergeOutlets survives a missing testimony payload', () => {
    const merged = mergeOutlets([{ domain: 'g1.globo.com', source: 'gnews', docs: 4, tone: null }], [])
    assert.deepEqual(merged, [{ domain: 'g1.globo.com', sources: ['gnews'], docs: 4, score: null, n: 0 }])
  })
})

describe('balanceColor: a red/grey-analogue two-hue ramp (issue #91 AC4)', () => {
  it('balanceColor(0) equals SCALE_MID', () => {
    assert.equal(balanceColor(0), SCALE_MID)
  })

  it('balanceColor(-1) and balanceColor(1) are two distinct, non-grey colours', () => {
    const left = balanceColor(-1)
    const right = balanceColor(1)
    assert.notEqual(left, right)
    assert.notEqual(left, SCALE_MID)
    assert.notEqual(right, SCALE_MID)
  })

  it('is monotonic in |balance| for each sign, walking a few sample points', () => {
    const toRgb = (c: string) => (c.startsWith('#') ? [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16)) : (c.match(/\d+/g) ?? []).map(Number))
    const mid = toRgb(SCALE_MID)
    const dist = (c: string) => {
      const [r, g, b] = toRgb(c)
      const [mr, mg, mb] = mid
      return Math.hypot(r - mr, g - mg, b - mb)
    }
    const negatives = [0, -0.25, -0.5, -0.75, -1].map((b) => dist(balanceColor(b)))
    const positives = [0, 0.25, 0.5, 0.75, 1].map((b) => dist(balanceColor(b)))
    for (let i = 1; i < negatives.length; i++) assert.ok(negatives[i] >= negatives[i - 1], `distance from SCALE_MID must not decrease walking toward -1: ${negatives}`)
    for (let i = 1; i < positives.length; i++) assert.ok(positives[i] >= positives[i - 1], `distance from SCALE_MID must not decrease walking toward +1: ${positives}`)
    assert.ok(negatives[negatives.length - 1] > negatives[0], 'the -1 end must be strictly further from SCALE_MID than the centre')
    assert.ok(positives[positives.length - 1] > positives[0], 'the +1 end must be strictly further from SCALE_MID than the centre')
  })
})

describe('trendOf', () => {
  it('trendOf reads the previous window without ever dividing by it', () => {
    assert.deepEqual(trendOf({ count: 5, previous: 0 }), { cls: 'up', text: 'novo' })
    assert.deepEqual(trendOf({ count: 5, previous: 2 }), { cls: 'up', text: '↑ era 2' })
    assert.deepEqual(trendOf({ count: 1, previous: 2 }), { cls: '', text: '↓ era 2' })
    assert.deepEqual(trendOf({ count: 2, previous: 2 }), { cls: '', text: '= 2' })
  })
})

describe('sourceLabels / SOURCE_SEGMENTS', () => {
  it('carries a pt-BR label and a segment for every collector, including camara, senado and the press families', () => {
    assert.equal(sourceLabels.juridico, 'Jurídico')
    assert.equal(sourceLabels.oficial, 'Oficial')
    assert.equal(sourceLabels.nicho, 'Nicho')
    assert.ok(sourceLabels.senado, 'senado needs a pt-BR label like its siblings')
    for (const [value, text] of [['camara', 'câmara'], ['senado', 'senado'], ['juridico', 'jurídico'], ['oficial', 'oficial'], ['nicho', 'nicho']])
      assert.deepEqual(SOURCE_SEGMENTS.find(([v]) => v === value), [value, text])
    assert.ok(SOURCE_SEGMENTS.length >= 8, 'every source still has an option')
  })
})
