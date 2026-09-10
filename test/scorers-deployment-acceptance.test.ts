import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { methods as methodsFromIndex } from '../src/scorers/index.js'
import { methods as methodsFromMethod } from '../src/scorers/method.js'

// Issue #112: keep @huggingface/transformers out of the serverless deployment. The
// request-serving path (api/index.ts -> src/server.ts -> src/query.ts) must never trace
// into src/scorers/onnx.ts, which is the only file that dynamic-imports the model loader.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const srcDir = join(root, 'src')

const moduleSource = (relPath: string) => readFileSync(join(srcDir, relPath), 'utf8')

// Same shape as test/atlas-modules-acceptance.test.ts's importsOf: both quote styles, both
// single-line and multi-line import/export-from forms.
const importsOf = (source: string) => [...source.matchAll(/(?:^|\n)(?:import\b|export\s*\{)[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1])

// Resolves a relative specifier from `fromRel` (a path relative to srcDir) to another
// path relative to srcDir, with the .js -> .ts extension swap every module in this repo uses.
const resolve = (fromRel: string, spec: string): string => {
  const joined = normalize(join(dirname(fromRel), spec))
  return joined.endsWith('.js') ? `${joined.slice(0, -3)}.ts` : joined
}

// A generic walk: starts at src/server.ts and follows every relative import it finds,
// recursively, regardless of which file or specifier introduces it. Non-relative specifiers
// (bare package names like 'hono') are not filesystem paths and are skipped.
const reachableFrom = (entry: string): Set<string> => {
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const rel = stack.pop() as string
    if (seen.has(rel)) continue
    seen.add(rel)
    for (const spec of importsOf(moduleSource(rel))) {
      if (!spec.startsWith('.')) continue
      const next = resolve(rel, spec)
      if (!seen.has(next)) stack.push(next)
    }
  }
  return seen
}

describe('issue #112: @huggingface/transformers stays out of the deployed function', () => {
  it('src/scorers/method.ts has no import statements', () => {
    const source = moduleSource('scorers/method.ts')
    assert.doesNotMatch(source, /^\s*import\b/m, 'method.ts must declare zero imports, not even type-only ones')
    assert.doesNotMatch(source, /@huggingface\/transformers/, 'method.ts must not reference the model package')
    assert.doesNotMatch(source, /\bimport\s*\(/, 'method.ts must not dynamic-import anything')
  })

  it('the import graph reachable from src/server.ts never includes src/scorers/onnx.ts', () => {
    const reachable = reachableFrom('server.ts')
    assert.ok(!reachable.has('scorers/onnx.ts'), `src/server.ts's import graph must not reach onnx.ts, but it reached: ${[...reachable].sort().join(', ')}`)
  })

  it('scorers/index.ts and scorers/method.ts export the same methods object', () => {
    assert.equal(methodsFromIndex, methodsFromMethod, 'both must be the very same object, not two definitions of the same shape')
  })

  it('package.json lists @huggingface/transformers under optionalDependencies, not dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    assert.equal('@huggingface/transformers' in pkg.dependencies, false, 'must not remain in dependencies')
    assert.equal(pkg.optionalDependencies?.['@huggingface/transformers'], '^4.2.0')
  })
})
