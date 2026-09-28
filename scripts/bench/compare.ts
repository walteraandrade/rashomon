import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { compare, table, type Report } from './stats.js'

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    cases: { type: 'string', default: '' },
    gain: { type: 'string', default: '0.2' },
    all: { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
  },
})

const [basePath, candPath] = positionals
if (!basePath || !candPath) throw new Error('usage: compare.ts <base.json> <cand.json> --cases a,b [--gain 0.2] [--all] [--strict]')

const load = async (p: string) => JSON.parse(await readFile(p, 'utf8')) as Report
const base = await load(basePath)
const cand = await load(candPath)
const targets = args.cases.split(',').filter(Boolean)
const r = compare(base, cand, targets, Number(args.gain), args.strict)

const out = [
  `base ${base.meta.rev} (calibration ${base.meta.calibrationMs.toFixed(0)} ms) vs candidate ${cand.meta.rev} (calibration ${cand.meta.calibrationMs.toFixed(0)} ms)`,
  '',
  '### Targeted',
  '',
  table(r.targeted),
  '',
  ...(r.diverged.length ? ['### Result sets that differ', '', table(r.diverged), ''] : []),
  ...(r.unverified.length ? ['### Cells with no rows to diff (a side timed out)', '', table(r.unverified), ''] : []),
  ...(r.missing.length ? ['### Cells missing from the candidate', '', r.missing.join('\n'), ''] : []),
  ...(args.all ? ['### Every cell', '', table(r.verdicts), ''] : []),
  `verdict: ${r.kept ? 'KEEP' : 'REJECT'} (${r.diverged.length} diverged, ${r.unverified.length} unverifiable, ${r.slow.length} targeted cells under ${Number(args.gain) * 100}% faster, ${r.missing.length} missing)`,
].join('\n')

console.log(out)
process.exitCode = r.kept ? 0 : 1
