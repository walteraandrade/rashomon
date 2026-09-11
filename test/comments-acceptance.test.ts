import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

// Issue #134: comment-line density, no "master" in comments, Style contract, two named
// stories gone, two keeper constraints kept, executable src unchanged vs origin/master.

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')

const srcTsRel = (dir = srcDir, prefix = 'src/'): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${prefix}${entry.name}`
    if (entry.isDirectory()) return srcTsRel(join(dir, entry.name), `${rel}/`)
    return entry.name.endsWith('.ts') ? [rel] : []
  })

const readSrc = (rel: string) => readFileSync(join(root, rel), 'utf8')

const commentLine = (line: string) => line.trimStart().startsWith('//')

const trailingComment = (line: string): string | null => {
  if (commentLine(line)) return null
  const m = /(?<!:)\/\/(.*)$/.exec(line)
  return m ? m[1] : null
}

const blockComments = (src: string) => [...src.matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => m[0])

const commentsAttachedTo = (src: string, decl: RegExp): string => {
  const lines = src.split('\n')
  const i = lines.findIndex((line) => decl.test(line))
  assert.ok(i >= 0, `no declaration matching ${decl}`)
  const block: string[] = []
  for (let j = i - 1; j >= 0; j--) {
    const t = lines[j].trim()
    if (t.startsWith('//')) block.push(lines[j])
    else if (t === '') {
      if (block.length) break
    } else break
  }
  return block.reverse().join('\n')
}

/** Drop comments so only executable text remains. `://` in URLs is not a comment. */
const executable = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, '').trimEnd())
    .filter((line) => line.trim() !== '')
    .join('\n')

const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd()

describe('issue #134: comments state constraints, not history', () => {
  const files = srcTsRel()

  it('AC1: src/**/*.ts comment-line density (stripped line starts with //) is under 10%', () => {
    let comments = 0
    let total = 0
    for (const rel of files) {
      for (const line of readSrc(rel).split('\n')) {
        total++
        if (commentLine(line)) comments++
      }
    }
    assert.ok(total > 0, 'src/**/*.ts must not be empty')
    const density = comments / total
    assert.ok(
      density < 0.1,
      `comment-line density is ${(density * 100).toFixed(2)}% (${comments}/${total}), not under 10%`,
    )
  })

  it('AC2: no src/**/*.ts comment contains the word master', () => {
    const hits: string[] = []
    for (const rel of files) {
      const src = readSrc(rel)
      for (const [i, line] of src.split('\n').entries()) {
        const body = commentLine(line) ? line : trailingComment(line)
        if (body && /\bmaster\b/i.test(body)) hits.push(`${rel}:${i + 1}`)
      }
      for (const block of blockComments(src)) {
        if (/\bmaster\b/i.test(block)) hits.push(`${rel} block comment`)
      }
    }
    assert.deepEqual(hits, [], `comments still contain the word master: ${hits.join(', ')}`)
  })

  it('AC3: CLAUDE.md Style states that a comment states the constraint and history lives in git and docs', () => {
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    const style = claude.split(/^## Style\s*$/m)[1]?.split(/^## /m)[0] ?? ''
    assert.ok(style, 'CLAUDE.md must have a Style section')
    assert.match(style, /comment states the constraint/i)
    assert.match(style, /history lives in git and docs/i)
  })

  it('AC4: gkg.ts does not say master reported null; DAYS does not retell the 365-key/issue story', () => {
    const gkg = readSrc('src/collectors/gkg.ts')
    assert.doesNotMatch(gkg, /master reported as [`']?null/i)
    assert.doesNotMatch(gkg, /which master reported/i)

    const days = commentsAttachedTo(readSrc('src/query.ts'), /^export const DAYS\b/)
    assert.doesNotMatch(days, /365 distinct/i)
    assert.doesNotMatch(days, /\?days=364/)
    assert.doesNotMatch(days, /clamped to \[1,\s*365\]/)
    assert.doesNotMatch(days, /issues?\s*#\d+/i)
  })

  it('AC5: keeper comments still state the constraint: MAX_RESPONSE_BYTES and inTransaction', () => {
    const http = commentsAttachedTo(readSrc('src/http.ts'), /^export const MAX_RESPONSE_BYTES\b/)
    assert.ok(http, 'MAX_RESPONSE_BYTES must have a comment stating the constraint')
    assert.match(http, /ceiling|limit|bound/i)
    assert.match(http, /network|response|download|wire/i)

    const tx = commentsAttachedTo(readSrc('src/store.ts'), /^export const inTransaction\b/)
    assert.ok(tx, 'inTransaction must have a comment stating the constraint')
    assert.match(tx, /nested/i)
    assert.match(tx, /begin/)
    assert.match(tx, /commit/)
    assert.match(tx, /transaction/)
  })

  it('AC6: vs origin/master, executable (non-comment) code of src/**/*.ts is unchanged', () => {
    git(['rev-parse', '--verify', 'origin/master'])
    const oldFiles = git(['ls-tree', '-r', '--name-only', 'origin/master', '--', 'src'])
      .split('\n')
      .filter((f) => f.endsWith('.ts'))
      .sort()
    const nowFiles = files.slice().sort()
    assert.deepEqual(nowFiles, oldFiles, 'src/**/*.ts file set must match origin/master')

    const changed = nowFiles.filter((rel) => executable(readSrc(rel)) !== executable(git(['show', `origin/master:${rel}`])))
    assert.deepEqual(changed, [], `executable code changed vs origin/master in: ${changed.join(', ')}`)
  })
})
