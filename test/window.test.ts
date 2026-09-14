import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SCORED_CHARS, firstMention, scoredText } from '../src/scorers/window.js'
import fixtures from './kikori-fixtures.json' with { type: 'json' }

// Issue #154: the scorer used to send the head of the text, so on long docs the person often
// sat outside the cut. scoredText is the one function both pnpm score and pnpm export-docs use.

const words = (n: number, w = 'palavra') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ')

describe('firstMention', () => {
  it('finds the earliest alias, whole word, case- and accent-insensitive, in original offsets', () => {
    const text = 'Hoje TARCÍSIO falou; Tarcisio de Freitas repetiu.'
    const hit = firstMention(text, ['Tarcísio de Freitas', 'Tarcísio'])
    assert.deepEqual(hit, { start: 5, end: 13 })
    assert.equal(text.slice(hit!.start, hit!.end), 'TARCÍSIO')
  })

  it('prefers the longer alias on the same start', () => {
    const text = 'Flávio Bolsonaro chegou.'
    assert.deepEqual(firstMention(text, ['Flávio', 'Flávio Bolsonaro']), { start: 0, end: 16 })
  })

  it('does not match inside another word, and returns null with no alias or no hit', () => {
    assert.equal(firstMention('Lulasomething', ['Lula']), null)
    assert.equal(firstMention('Lula', []), null)
    assert.equal(firstMention('nada aqui', ['Lula', '']), null)
  })

  it('keeps offsets right when normalization changes string length', () => {
    const text = 'ﬁm İstanbul Lula'
    const hit = firstMention(text, ['Lula'])
    assert.equal(text.slice(hit!.start, hit!.end), 'Lula')
  })
})

describe('scoredText', () => {
  it('returns a text that fits untouched, aliases or not', () => {
    const short = 'x'.repeat(SCORED_CHARS)
    assert.equal(scoredText(short, ['x']), short)
    assert.equal(scoredText('Lula falou.', ['Lula']), 'Lula falou.')
  })

  it('returns a long text whole when no alias matches, so the caller keeps its head cut', () => {
    const long = words(400)
    assert.equal(scoredText(long, ['Lula']), long)
    assert.equal(scoredText(long, []), long)
  })

  it('centres a window of SCORED_CHARS on the first mention, cut at word boundaries', () => {
    const text = `${words(300)} Lula ${words(300)}`
    const out = scoredText(text, ['Lula'])
    assert.ok(out.length <= SCORED_CHARS)
    assert.ok(out.length > SCORED_CHARS - 40)
    assert.match(out, /(?<![a-z0-9])Lula(?![a-z0-9])/)
    const centre = out.indexOf('Lula') + 2
    assert.ok(Math.abs(centre - out.length / 2) < 30, `mention at ${centre} of ${out.length}`)
    assert.ok(text.includes(out))
    assert.match(out, /^\S/)
    assert.match(out, /\S$/)
    for (const w of out.split(' ')) assert.match(w, /^(palavra\d+|Lula)$/, `broken word ${w}`)
  })

  it('clamps to the head when the mention is near the start and to the tail when near the end', () => {
    const head = `Lula ${words(400)}`
    assert.match(scoredText(head, ['Lula']), /^Lula /)
    const tail = `${words(400)} Lula`
    assert.match(scoredText(tail, ['Lula']), / Lula$/)
    assert.ok(scoredText(tail, ['Lula']).length <= SCORED_CHARS)
  })

  it('never cuts the mention away, even inside one huge word', () => {
    const text = `${words(200)} ${'a'.repeat(600)}.Lula.${'b'.repeat(600)} ${words(200)}`
    const out = scoredText(text, ['Lula'])
    assert.match(out, /\.Lula\./)
    assert.ok(out.length <= SCORED_CHARS)
  })

  it('keeps the person inside the window on every long kikori fixture', () => {
    const long = fixtures.filter((f) => f.text.length > SCORED_CHARS && firstMention(f.text, [f.person]))
    assert.ok(long.length >= 6)
    for (const f of long) {
      const out = scoredText(f.text, [f.person])
      assert.ok(out.length <= SCORED_CHARS, f.person)
      assert.ok(firstMention(out, [f.person]), `${f.person} lost`)
      assert.ok(f.text.includes(out), `${f.person} window is not a slice of the text`)
    }
  })
})
