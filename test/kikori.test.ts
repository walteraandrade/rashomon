import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { methods, scorers } from '../src/scorers/index.js'
import { pairIds, scoreFromLogits } from '../src/scorers/onnx.js'
import fixtures from './kikori-fixtures.json' with { type: 'json' }

const CLS = 101
const SEP = 102
const LABELS = ['neg', 'neu', 'pos']

describe('kikori pair encoding', () => {
  it('frames the pair as [CLS] person [SEP] text [SEP] with token types 0 / 1', () => {
    const e = pairIds([7, 8], [1, 2, 3], 256, CLS, SEP)
    assert.deepEqual(e.input_ids, [CLS, 7, 8, SEP, 1, 2, 3, SEP])
    assert.deepEqual(e.token_type_ids, [0, 0, 0, 0, 1, 1, 1, 1])
  })

  it('cuts only the text on long inputs, so the closing [SEP] survives and the frame fits max_length', () => {
    const person = [7, 8, 9]
    const text = Array.from({ length: 1000 }, (_, i) => i + 1)
    const e = pairIds(person, text, 256, CLS, SEP)
    assert.equal(e.input_ids.length, 256)
    assert.equal(e.input_ids[e.input_ids.length - 1], SEP)
    assert.deepEqual(e.input_ids.slice(0, 5), [CLS, 7, 8, 9, SEP])
    assert.equal(e.input_ids.slice(5, -1).length, 256 - person.length - 3)
    assert.equal(e.token_type_ids.length, 256)
    assert.equal(e.token_type_ids.filter((t) => t === 0).length, person.length + 2)
  })

  it('never cuts a text that already fits', () => {
    const e = pairIds([7], [1, 2], 256, CLS, SEP)
    assert.equal(e.input_ids.length, 6)
  })
})

describe('kikori score formula', () => {
  it('is (p_pos - p_neg) * 10 from a softmax over the logits in label order', () => {
    assert.equal(scoreFromLogits([1, 1, 1], LABELS), 0)
    assert.ok(scoreFromLogits([0, 0, 20], LABELS) > 9.99)
    assert.ok(scoreFromLogits([20, 0, 0], LABELS) < -9.99)
    const logits = [0.5, -1, 2]
    const e = logits.map(Math.exp)
    const z = e[0] + e[1] + e[2]
    assert.ok(Math.abs(scoreFromLogits(logits, LABELS) - ((e[2] - e[0]) / z) * 10) < 1e-12)
  })

  it('follows the label order given by the model, not a fixed index', () => {
    assert.ok(scoreFromLogits([0, 0, 20], ['pos', 'neu', 'neg']) < -9.99)
  })
})

describe('kikori method label', () => {
  it('is kikori:<dtype>, q8 by default, so placeholder `onnx` rows are never reused', () => {
    const prev = process.env.TESTIMONY_DTYPE
    delete process.env.TESTIMONY_DTYPE
    assert.equal(methods.onnx(), 'kikori:q8')
    process.env.TESTIMONY_DTYPE = 'fp32'
    assert.equal(methods.onnx(), 'kikori:fp32')
    if (prev === undefined) delete process.env.TESTIMONY_DTYPE
    else process.env.TESTIMONY_DTYPE = prev
    assert.equal(methods.stub(), 'stub')
  })
})

// Opt-in: downloads TESTIMONY_MODEL (default drifting-walter/kikori) into MODEL_DIR and runs the
// real scorer over the model's own fixtures. KIKORI_CHECK=1 runs both dtypes; KIKORI_CHECK=q8
// or =fp32 runs one. Every other suite keeps using `stub`.
const check = process.env.KIKORI_CHECK ?? ''
const dtypes = (['fp32', 'q8'] as const).filter((d) => check === '1' || check === d)
const tolerance = { fp32: 0.01, q8: 1.5 }
const expected = { fp32: 'score_fp32', q8: 'score_int8' } as const

describe('kikori fixtures (real model)', { skip: dtypes.length === 0 && 'set KIKORI_CHECK=1 to download the model and run' }, () => {
  process.env.TESTIMONY_MODEL ??= 'drifting-walter/kikori'
  for (const dtype of dtypes) {
    it(`${dtype} scores every fixture within ${tolerance[dtype]} of ${expected[dtype]}`, async () => {
      process.env.TESTIMONY_DTYPE = dtype
      const diffs: { person: string; got: number; want: number }[] = []
      for (const f of fixtures) {
        const got = await scorers.onnx(f.text, { id: f.person, name: f.person, aliases: [] })
        assert.ok(typeof got === 'number')
        diffs.push({ person: f.person, got, want: f[expected[dtype]] })
      }
      const off = diffs.filter((d) => Math.abs(d.got - d.want) > tolerance[dtype])
      assert.deepEqual(off, [], `${dtype}: ${off.length} of ${fixtures.length} fixtures outside tolerance`)
      const mean = diffs.reduce((a, d) => a + Math.abs(d.got - d.want), 0) / diffs.length
      console.log(`${dtype}: n ${diffs.length} mean |dscore| ${mean.toFixed(4)} max ${Math.max(...diffs.map((d) => Math.abs(d.got - d.want))).toFixed(4)}`)
    })
  }
})
