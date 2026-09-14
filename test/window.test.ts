import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import seedJson from '../seed.json' with { type: 'json' }
import { MAX_LENGTH, approxTokens, firstMention, fitsApprox, scoredText } from '../src/scorers/window.js'
import type { Person } from '../src/types.js'
import fixtures from './kikori-fixtures.json' with { type: 'json' }

// Issue #154: the scorer used to send the head of the text, so on long docs the person often
// sat outside the cut. scoredText is the one function both pnpm score and pnpm export-docs use.

const seed = seedJson as Person[]
const byName = (name: string) => seed.find((p) => p.name === name) as Person
const lula = byName('Lula')
const words = (n: number, w = 'palavra') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ')
const person = (id: string, ...aliases: string[]): Person => ({ id, name: aliases[0], aliases })

const CHARS = 900
const byChars = (s: string) => s.length <= CHARS
// A tokenizer for which every character outside whitespace is a token: the densest text there is.
const DENSE = 250
const byDense = (s: string) => s.replace(/\s/g, '').length <= DENSE
const MENTION = /(?<![a-z0-9])Lula(?![a-z0-9])/

describe('firstMention', () => {
  it('finds the earliest alias, whole word, case- and accent-insensitive, in original offsets', () => {
    const text = 'Hoje TARCÍSIO falou; Tarcisio de Freitas repetiu.'
    const hit = firstMention(text, person('tarcisio', 'Tarcísio de Freitas', 'Tarcísio'))
    assert.deepEqual(hit, { start: 5, end: 13 })
    assert.equal(text.slice(hit!.start, hit!.end), 'TARCÍSIO')
  })

  it('prefers the longer alias on the same start', () => {
    const text = 'Flávio Bolsonaro chegou.'
    assert.deepEqual(firstMention(text, person('flavio', 'Flávio', 'Flávio Bolsonaro')), { start: 0, end: 16 })
  })

  it('does not match inside another word, and returns null with no alias or no hit', () => {
    assert.equal(firstMention('Lulasomething', person('lula', 'Lula')), null)
    assert.equal(firstMention('Lula', { id: 'lula', name: 'Lula', aliases: [] }), null)
    assert.equal(firstMention('nada aqui', person('lula', 'Lula', '')), null)
  })

  it('keeps offsets right when normalization changes string length', () => {
    const text = 'ﬁm İstanbul Lula'
    const hit = firstMention(text, person('lula', 'Lula'))
    assert.equal(text.slice(hit!.start, hit!.end), 'Lula')
  })
})

// The same claiming rule personsMentioned tags with: a longer alias, another person's or one of
// this person's own `exclude` names, takes its span first. Without it the window for Jair
// Bolsonaro centres on Flávio's surname and the one for Ciro Gomes on Ciro Nogueira.
describe('firstMention against seed.json', () => {
  const far = words(300)
  const mention = (text: string, who: Person) => {
    const hit = firstMention(text, who, seed)
    return hit && text.slice(hit.start, hit.end)
  }

  it('does not let "Flávio Bolsonaro" anchor Jair Bolsonaro\'s window', () => {
    const text = `Flávio Bolsonaro ${far} Jair Bolsonaro ${words(50)}`
    assert.equal(mention(text, byName('Jair Bolsonaro')), 'Jair Bolsonaro')
    assert.equal(mention(text, byName('Flávio Bolsonaro')), 'Flávio Bolsonaro')
    const out = scoredText(text, byName('Jair Bolsonaro'), seed, byChars)
    assert.match(out, /Jair Bolsonaro/)
    assert.doesNotMatch(out, /Flávio/)
  })

  it('does not let "Ciro Nogueira", an excluded name, anchor Ciro Gomes\'s window', () => {
    const text = `Ciro Nogueira ${far} Ciro Gomes ${words(50)}`
    assert.equal(mention(text, byName('Ciro Gomes')), 'Ciro Gomes')
    assert.doesNotMatch(scoredText(text, byName('Ciro Gomes'), seed, byChars), /Nogueira/)
  })

  it('does not let "Vinicius de Moraes" anchor Alexandre de Moraes\'s window', () => {
    const text = `Vinicius de Moraes ${far} Alexandre de Moraes ${words(50)}`
    assert.equal(mention(text, byName('Alexandre de Moraes')), 'Alexandre de Moraes')
    assert.doesNotMatch(scoredText(text, byName('Alexandre de Moraes'), seed, byChars), /Vinicius/)
  })

  it('finds no mention at all when only an excluded name is present, so the head goes', () => {
    const text = `Ciro Nogueira ${far}`
    assert.equal(mention(text, byName('Ciro Gomes')), null)
    assert.equal(mention(text, byName('Jair Bolsonaro')), null)
    assert.match(scoredText(text, byName('Ciro Gomes'), seed, byChars), /^Ciro Nogueira /)
  })

  it('uses the caller\'s own person over a stale copy of it in the list', () => {
    const text = `Xandão ${far}`
    const stale = { ...byName('Alexandre de Moraes'), aliases: ['Alexandre de Moraes'] }
    assert.equal(mention(text, stale), null)
    assert.equal(firstMention(text, byName('Alexandre de Moraes'), [stale])?.start, 0)
  })
})

describe('scoredText', () => {
  it('returns a text that fits untouched, aliases or not', () => {
    const short = 'x'.repeat(CHARS)
    assert.equal(scoredText(short, person('x', 'x'), [], byChars), short)
    assert.equal(scoredText('Lula falou.', lula, seed, byChars), 'Lula falou.')
  })

  it('returns the head, cut to the budget, when no alias matches: never the whole text', () => {
    const long = words(400)
    const out = scoredText(long, lula, seed, byChars)
    assert.ok(out.length <= CHARS && out.length > CHARS - 40, `${out.length}`)
    assert.ok(long.startsWith(out))
    assert.equal(scoredText(long, { id: 'lula', name: 'Lula', aliases: [] }, [], byChars), out)
  })

  it('centres the largest window that fits on the first mention, cut at word boundaries', () => {
    const text = `${words(300)} Lula ${words(300)}`
    const out = scoredText(text, lula, seed, byChars)
    assert.ok(out.length <= CHARS)
    assert.ok(out.length > CHARS - 40)
    assert.match(out, MENTION)
    const centre = out.indexOf('Lula') + 2
    assert.ok(Math.abs(centre - out.length / 2) < 30, `mention at ${centre} of ${out.length}`)
    assert.ok(text.includes(out))
    assert.match(out, /^\S/)
    assert.match(out, /\S$/)
    for (const w of out.split(' ')) assert.match(w, /^(palavra\d+|Lula)$/, `broken word ${w}`)
  })

  it('clamps to the head when the mention is near the start and to the tail when near the end', () => {
    const head = `Lula ${words(400)}`
    assert.match(scoredText(head, lula, seed, byChars), /^Lula /)
    const tail = `${words(400)} Lula`
    assert.match(scoredText(tail, lula, seed, byChars), / Lula$/)
    assert.ok(scoredText(tail, lula, seed, byChars).length <= CHARS)
  })

  it('never cuts the mention away, even inside one huge word', () => {
    const text = `${words(200)} ${'a'.repeat(600)}.Lula.${'b'.repeat(600)} ${words(200)}`
    const out = scoredText(text, lula, seed, byChars)
    assert.match(out, /\.Lula\./)
    assert.ok(out.length <= CHARS)
  })

  // The budget is the caller's tokens, not characters: a window that fits leaves pairIds's head
  // cut nothing to remove, so a mention at the very end of a dense text survives. Under a
  // 900-character cut it sat at token 480 of a 250-token budget on juridico text.
  it('fits the caller\'s token budget on dense text, so a mention at the tail of the window survives', () => {
    const dense = (n: number) => Array.from({ length: n }, (_, i) => `x${i}`).join(' ')
    const tail = `${dense(400)} Lula`
    const out = scoredText(tail, lula, seed, byDense)
    assert.ok(byDense(out), `${out.replace(/\s/g, '').length} tokens`)
    assert.match(out, / Lula$/)
    assert.ok(out.replace(/\s/g, '').length > DENSE - 40, 'and it is the largest such window')
    const middle = `${dense(400)} Lula ${dense(400)}`
    const mid = scoredText(middle, lula, seed, byDense)
    assert.ok(byDense(mid))
    assert.match(mid, MENTION)
    assert.ok(Math.abs(mid.indexOf('Lula') - mid.length / 2) < 30)
  })

  it('shrinks a window of prose to the budget when its tail turns dense', () => {
    const text = `${words(100)} Lula ${'a.b.c.d.e.f.g.h '.repeat(100)}`
    const out = scoredText(text, lula, seed, byDense)
    assert.ok(byDense(out))
    assert.match(out, MENTION)
  })

  it('keeps the person inside the window on every long kikori fixture, with her real aliases', () => {
    const long = fixtures.filter((f) => f.text.length > CHARS && firstMention(f.text, byName(f.person), seed))
    assert.ok(long.length >= 6)
    for (const f of long) {
      const out = scoredText(f.text, byName(f.person), seed, byChars)
      assert.ok(out.length <= CHARS, f.person)
      assert.ok(firstMention(out, byName(f.person), seed), `${f.person} lost`)
      assert.ok(f.text.includes(out), `${f.person} window is not a slice of the text`)
    }
  })
})

// The export runs without the model, so it estimates. Real counts from kikori's tokenizer
// (revision d03d7853) on 2026-09-14; the estimate must stay within a tenth of them.
describe('approxTokens', () => {
  const samples: [string, number][] = [
    ['O presidente Lula afirmou nesta terça-feira que a reforma tributária deve ser votada ainda neste semestre, apesar da resistência de parte do Congresso e das críticas de governadores.', 35],
    ['EMENTA: AGRAVO REGIMENTAL. ART. 5º, LIV, CF/88. Rel. Min. Alexandre de Moraes, j. 12/03/2024, DJe nº 47, p. 1.203-1.210. Precedentes: RE 1.234.567/SP; ADI 4.815/DF.', 91],
    ['Leia mais em https://www1.folha.uol.com.br/poder/2024/03/lula-diz-que-reforma-sai-em-2024.shtml?utm_source=rss&utm_medium=feed#comentarios', 75],
  ]

  it('stays within 10% of the tokenizer on prose, juridico and a URL', () => {
    for (const [text, real] of samples) {
      const est = approxTokens(text)
      assert.ok(Math.abs(est - real) / real <= 0.1, `${est} vs ${real}: ${text.slice(0, 30)}`)
    }
    assert.equal(approxTokens('Lula'), 1)
    assert.equal(approxTokens(''), 0)
    assert.equal(approxTokens('   '), 0)
  })

  it('fitsApprox leaves the text max_length minus the person and the three specials', () => {
    const fits = fitsApprox(lula)
    const budget = MAX_LENGTH - 1 - 3
    assert.ok(fits(Array(budget).fill('de').join(' ')))
    assert.ok(!fits(Array(budget + 1).fill('de').join(' ')))
    assert.ok(fitsApprox(lula, 10)(Array(6).fill('de').join(' ')))
    assert.ok(!fitsApprox(lula, 10)(Array(7).fill('de').join(' ')))
  })
})
