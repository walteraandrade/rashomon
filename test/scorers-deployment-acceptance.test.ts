import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { methods as methodsFromIndex } from '../src/scorers/index.js'
import { methods as methodsFromMethod } from '../src/scorers/method.js'
import { onnx, pairIds, scoreFromLogits } from '../src/scorers/onnx.js'
import { docsText } from './docs.js'
import './close.js'

// Independent verification of issue #112's acceptance criteria, written from the spec text
// rather than from the builder's own module split. The point of the split is that the
// request-serving path (api/index.ts -> src/server.ts -> src/query.ts) never traces into
// src/scorers/onnx.ts, the only file that dynamic-imports @huggingface/transformers.

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

  it('AC2: still exports pairIds, scoreFromLogits and the default onnx scorer, with unchanged behavior', () => {
    assert.equal(typeof pairIds, 'function')
    assert.equal(typeof scoreFromLogits, 'function')
    assert.equal(typeof onnx, 'function')
    const encoded = pairIds([1, 2], [3, 4, 5], 10, 100, 101)
    assert.deepEqual(encoded.input_ids, [100, 1, 2, 101, 3, 4, 5, 101])
    const score = scoreFromLogits([1, -1], ['pos', 'neg'])
    assert.ok(score > 0, 'pos > neg logits must score positive, unchanged from before the split')
  })
})

describe('issue #112 AC3: one source for the label', () => {
  it('AC3: methods exported from scorers/index.ts and scorers/method.ts are the same object by reference', () => {
    assert.equal(methodsFromIndex, methodsFromMethod, 'both must be the very same object, not two definitions of the same shape')
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
})

describe('issue #112 AC12: docs/operations.md states the dependency and size facts', () => {
  it('AC12: @huggingface/transformers is documented as required only by pnpm score and shipped as optional', () => {
    assert.match(docsText, /@huggingface\/transformers[\s\S]{0,80}required only by[\s\S]{0,20}pnpm score/, 'operations docs must say the package is required only by pnpm score')
    assert.match(docsText, /optionalDependencies/, 'operations docs must say it ships as an optional dependency')
  })

  it('AC12: the deployed /api function is documented as excluded from the import graph that reaches the model loader', () => {
    assert.match(docsText, /deployed[\s\S]{0,20}\/api[\s\S]{0,120}never reaches the model loader/i)
  })

  it('AC12: the measured before/after size of .vercel/output/functions/api/index.func is recorded, and after is smaller', () => {
    assert.match(docsText, /index\.func/, 'the docs must name the measured artifact')
    const bytes = [...docsText.matchAll(/before this split,[\s\S]{0,80}?was\s+([\d,]+)\s+bytes[\s\S]{0,200}?after,\s+it is\s+([\d,]+)\s+bytes/g)]
    assert.equal(bytes.length, 1, 'the docs must record one before/after size pair for index.func, in prose next to each other')
    const [, before, after] = bytes[0]
    assert.ok(Number(before.replace(/,/g, '')) > Number(after.replace(/,/g, '')), 'after must be recorded as smaller than before')
    assert.match(docsText, /onnxruntime-node/, 'the docs must name onnxruntime-node among what the before build carried')
    assert.match(docsText, /carries none of them/, 'the docs must state the after build carries none of the excluded packages')
  })
})
