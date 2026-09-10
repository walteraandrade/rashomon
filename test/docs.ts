import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Documentation is asserted as facts, never as prose. A criterion says "this collector
// ships documented", so these helpers search every page at once: a page may be rewritten,
// split or renamed and the criterion still holds as long as the fact is still written
// down somewhere. Assertions bound to one file's wording broke on PR #81's README split
// while the facts themselves had simply moved.

const repoFile = (relPath: string) => readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf8')

const docsDir = fileURLToPath(new URL('../docs/', import.meta.url))

/** Every markdown page a reader is expected to find, README first. */
export const docPages = ['README.md', ...readdirSync(docsDir).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)]

/** Page path to its text, for a check that belongs to one page. */
export const docPageText = new Map<string, string>(docPages.map((page) => [page, repoFile(page)]))

/** All of them concatenated, for "is this fact written down anywhere" checks. */
export const docsText = docPages.map((page) => docPageText.get(page) ?? '').join('\n')

export type SourceRow = { what: string; byDefault: boolean }

/** The source table in `docs/sources.md`, one row per collector, keyed by source name. */
export const sourceTable = new Map<string, SourceRow>(
  (docPageText.get('docs/sources.md') ?? '')
    .split('\n')
    .map((line) => /^\|\s*`(\w+)`\s*\|([^|]*)\|([^|]*)\|/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1], { what: m[2].trim(), byDefault: /^yes\b/i.test(m[3].trim()) }]),
)
