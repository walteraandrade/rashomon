import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { methods, scorers } from '../src/scorers/index.js'
import { methods as methodsFromMethod, modelRevision } from '../src/scorers/method.js'
import { onnx, pairIds, scoreFromLogits } from '../src/scorers/onnx.js'
import fixtures from './kikori-fixtures.json' with { type: 'json' }
import { withEnv } from './env.js'

// src/scorers/*: the kikori encoding and score formula, the method label, and the module split
// (issue #112) that keeps the request-serving path away from the model loader. pnpm score itself
// is in test/score.test.ts.

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

// Issue #67: the method label carried the dtype only, so a retrain republished under the same
// name left every existing row alone and scored only the pairs added since — two models under
// one label, with nothing recording the split.
const REV = '8f3c1d2'
const unversioned = { TESTIMONY_DTYPE: undefined, TESTIMONY_REVISION: undefined }

describe('kikori method label', () => {
  it('is kikori:<dtype>, q8 by default, so placeholder `onnx` rows are never reused', async () => {
    await withEnv(unversioned, () => assert.equal(methods.onnx(), 'kikori:q8'))
    await withEnv({ TESTIMONY_DTYPE: 'fp32', TESTIMONY_REVISION: undefined }, () => assert.equal(methods.onnx(), 'kikori:fp32'))
    assert.equal(methods.stub(), 'stub')
  })

  it('AC3 of issue #112: methods from scorers/index.ts and scorers/method.ts are the same object by reference', () => {
    assert.equal(methods, methodsFromMethod, 'both must be the very same object, not two definitions of the same shape')
  })

  it('is kikori:<dtype>:<revision> when TESTIMONY_REVISION is set', async () => {
    await withEnv({ ...unversioned, TESTIMONY_REVISION: REV }, () => {
      assert.equal(modelRevision(), REV)
      assert.equal(methods.onnx(), `kikori:q8:${REV}`)
    })
    await withEnv({ TESTIMONY_DTYPE: 'fp32', TESTIMONY_REVISION: REV }, () =>
      assert.equal(methods.onnx(), `kikori:fp32:${REV}`),
    )
  })

  it('stays kikori:<dtype> when unset, so rows scored before this existed keep matching', async () => {
    await withEnv(unversioned, () => {
      assert.equal(modelRevision(), '')
      assert.equal(methods.onnx(), 'kikori:q8')
    })
  })

  it('treats a revision outside the charset as unset, never as part of the label', async () => {
    const bad = ['a b', 'a:b', 'a/b', '', 'x'.repeat(65), 'rev#1']
    await Promise.all(
      bad.map((v) =>
        withEnv({ ...unversioned, TESTIMONY_REVISION: v }, () => {
          assert.equal(modelRevision(), '', `${JSON.stringify(v)} must not reach the label`)
          assert.equal(methods.onnx(), 'kikori:q8')
        }),
      ),
    )
  })

  it('leaves the stub label alone: it is a pure function with no model behind it', async () => {
    await withEnv({ ...unversioned, TESTIMONY_REVISION: REV }, () => assert.equal(methods.stub(), 'stub'))
  })
})

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const srcDir = join(root, 'src')
const srcSource = (relPath: string) => readFileSync(join(srcDir, relPath), 'utf8')

// Same shape as test/atlas-modules-acceptance.test.ts's importsOf: both quote styles, both
// single-line and multi-line import/export-from forms.
const importsOf = (source: string) => [...source.matchAll(/(?:^|\n)(?:import\b|export\s*\{)[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

// Resolves a relative specifier from `fromRel` (a path relative to srcDir) to another path
// relative to srcDir, with the .js -> .ts extension swap every module in this repo uses.
const resolve = (fromRel: string, spec: string): string => {
  const joined = normalize(join(dirname(fromRel), spec))
  return joined.endsWith('.js') ? `${joined.slice(0, -3)}.ts` : joined
}

// A generic walk: starts at the given entry and follows every relative import it finds,
// recursively, regardless of which file or specifier introduces it. This must catch a future
// edge (graph.ts or server.ts importing scorers/index.js directly), not just query.ts's own
// import line, so it is not driven by any known list of files.
const reachableFrom = (entry: string): Set<string> => {
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const rel = stack.pop() as string
    if (seen.has(rel)) continue
    seen.add(rel)
    for (const spec of importsOf(srcSource(rel))) {
      if (!spec.startsWith('.')) continue
      const next = resolve(rel, spec)
      if (!seen.has(next)) stack.push(next)
    }
  }
  return seen
}

// Every .ts file under src/, for the "score.ts is the only importer of scorers/index.js"
// check (AC5), which must not be limited to a hand-picked list of files either.
const allSrcFiles = (dir = srcDir, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? allSrcFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : entry.name.endsWith('.ts') ? [`${prefix}${entry.name}`] : [],
  )

describe('issue #112 AC1: src/scorers/method.ts is a zero-import module', () => {
  it('AC1: has no import statement at all, not even type-only, and no reference to the model package', () => {
    const source = srcSource('scorers/method.ts')
    assert.doesNotMatch(source, /^\s*import\b/m, 'method.ts must declare zero import statements')
    assert.doesNotMatch(source, /@huggingface\/transformers/, 'method.ts must not name the model package')
    assert.doesNotMatch(source, /\bimport\s*\(/, 'method.ts must not dynamic-import anything either')
  })

  it('AC1: exports dtype(), modelRevision() and the methods map, unmoved', async () => {
    const mod = (await import('../src/scorers/method.js')) as Record<string, unknown>
    assert.equal(typeof mod.dtype, 'function')
    assert.equal(typeof mod.modelRevision, 'function')
    assert.equal(typeof mod.methods, 'object')
    assert.deepEqual(Object.keys(mod.methods as object).sort(), ['onnx', 'stub'])
  })
})

describe('issue #112 AC2: src/scorers/onnx.ts no longer owns the label logic', () => {
  it('AC2: does not declare dtype, modelRevision or kikoriMethod as its own const/function', () => {
    const source = srcSource('scorers/onnx.ts')
    assert.doesNotMatch(source, /\bconst\s+dtype\s*=/, 'dtype must be imported, not redefined')
    assert.doesNotMatch(source, /\bconst\s+modelRevision\s*=/, 'modelRevision must be imported, not redefined')
    assert.doesNotMatch(source, /\bconst\s+kikoriMethod\s*=/, 'kikoriMethod must be imported, not redefined')
    assert.match(source, /from\s+['"]\.\/method\.js['"]/, 'onnx.ts must import dtype/modelRevision back from ./method.js')
  })

  it('AC2: still exports pairIds, scoreFromLogits and the default onnx scorer', () => {
    assert.equal(typeof pairIds, 'function')
    assert.equal(typeof scoreFromLogits, 'function')
    assert.equal(typeof onnx, 'function')
  })
})

describe('issue #112 AC4: the deployed import graph never reaches onnx.ts', () => {
  it('AC4: a generic walk from src/server.ts never visits src/scorers/onnx.ts', () => {
    const reachable = reachableFrom('server.ts')
    assert.ok(!reachable.has('scorers/onnx.ts'), `server.ts's import graph must not reach onnx.ts, but it reached: ${[...reachable].sort().join(', ')}`)
  })
})

describe('issue #112 AC5: query.ts stops importing scorers/index.js', () => {
  it('AC5: src/query.ts does not import from ./scorers/index.js, and imports methods from ./scorers/method.js', () => {
    assert.doesNotMatch(srcSource('query.ts'), /scorers\/index\.js/, 'query.ts must read methods from ./scorers/method.js instead')
    assert.match(srcSource('query.ts'), /from\s+['"]\.\/scorers\/method\.js['"]/)
  })

  it('AC5: src/score.ts is the only file under src/ (outside scorers/index.ts and onnx.ts) importing scorers/index.js', () => {
    const importers = allSrcFiles()
      .filter((file) => file !== 'scorers/index.ts' && file !== 'scorers/onnx.ts')
      .filter((file) => importsOf(srcSource(file)).some((spec) => resolve(file, spec) === 'scorers/index.ts'))
    assert.deepEqual(importers, ['score.ts'], 'only src/score.ts may import scorers/index.js elsewhere under src/')
  })
})

describe('issue #112 AC6: @huggingface/transformers moves to optionalDependencies', () => {
  it('AC6: package.json lists it under optionalDependencies, not dependencies, at the same version range', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    assert.equal('@huggingface/transformers' in pkg.dependencies, false, 'must not remain in dependencies')
    assert.equal(pkg.optionalDependencies?.['@huggingface/transformers'], '^4.2.0')
  })
})

describe('issue #112 AC9: onnx.ts keeps its network-safety gate', () => {
  it('AC9: the Hub import stays a dynamic import() inside a function body, not at module scope', () => {
    const source = srcSource('scorers/onnx.ts')
    assert.doesNotMatch(source, /^\s*import\s+.*@huggingface\/transformers/m, 'the Hub client must never be a static import')
    assert.match(source, /await import\(['"]@huggingface\/transformers['"]\)/, 'the dynamic import must still be present, inside load()')
  })

  it('AC13 of issue #21: importing the onnx scorer module resolves without invoking any model call', async () => {
    const mod = await import('../src/scorers/onnx.js')
    assert.equal(typeof mod.onnx, 'function')
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
