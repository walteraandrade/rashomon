// node docs/agent-cost/summarize.mjs [logs-dir] > analysis.md
// Reads every <id>.meta.json + <id>.jsonl that run.sh left, writes runs.csv
// and reads.csv next to this file, prints the analysis tables as markdown.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const logs = process.argv[2] ?? join(here, 'logs')
const COLUMNS = 'task,commit,run,model,input_tokens,output_tokens,cache_read_tokens,cost_usd,tool_calls,files_read,files_edited,lines_changed_src,lines_changed_test,wall_seconds,tests_green,notes'.split(',')

const treeCache = new Map()
const treeOf = (sha) => {
  if (!treeCache.has(sha)) {
    const out = execFileSync('git', ['-C', here, 'ls-tree', '-r', '--full-tree', '--name-only', sha], { encoding: 'utf8' })
    treeCache.set(sha, new Set(out.split('\n').filter(Boolean)))
  }
  return treeCache.get(sha)
}

const lines = (shortstat) => {
  const m = /(\d+) insertion/.exec(shortstat), d = /(\d+) deletion/.exec(shortstat)
  return (m ? +m[1] : 0) + (d ? +d[1] : 0)
}

const pathsIn = (text, tree, wt) => {
  const found = new Set()
  for (const raw of String(text ?? '').split(/[\s'"`(),;:=]+/)) {
    let p = raw.replace(/^\.\//, '')
    if (wt && p.startsWith(wt)) p = p.slice(wt.length).replace(/^\//, '')
    if (tree.has(p)) found.add(p)
  }
  return found
}

const parseRun = (meta) => {
  const id = `${meta.task}-${meta.commit}-${meta.run}`
  const tree = treeOf(meta.sha)
  const events = readFileSync(join(logs, `${id}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const wt = events.find((e) => e.type === 'system' && e.subtype === 'init')?.cwd ?? ''
  const uses = new Map()
  const read = new Set(), edited = new Set()
  let toolCalls = 0, denials = 0
  for (const e of events) {
    if (e.type === 'assistant') for (const b of e.message?.content ?? []) {
      if (b.type !== 'tool_use') continue
      toolCalls++
      uses.set(b.id, b)
      const i = b.input ?? {}
      if (b.name === 'Read') for (const p of pathsIn(i.file_path, tree, wt)) read.add(p)
      if (b.name === 'Edit' || b.name === 'Write' || b.name === 'MultiEdit') for (const p of pathsIn(i.file_path, tree, wt)) edited.add(p)
      if (b.name === 'Bash') for (const p of pathsIn(i.command, tree, wt)) read.add(p)
    }
    if (e.type === 'user') for (const b of e.message?.content ?? []) {
      if (b.type !== 'tool_result') continue
      const use = uses.get(b.tool_use_id)
      if (!use) continue
      const text = Array.isArray(b.content) ? b.content.map((c) => c.text ?? '').join('\n') : String(b.content ?? '')
      if (/permission|not allowed|denied/i.test(text) && b.is_error) denials++
      const isSearch = use.name === 'Grep' || (use.name === 'Bash' && /\b(grep|rg)\b/.test(use.input?.command ?? ''))
      if (isSearch) for (const p of pathsIn(text, tree, wt)) read.add(p)
    }
  }
  const result = events.find((e) => e.type === 'result') ?? {}
  const usage = result.usage ?? {}
  const model = Object.keys(result.modelUsage ?? {}).join('+') || meta.model_alias
  const notes = []
  if (meta.exit_code !== 0) notes.push(`exit ${meta.exit_code}`)
  if (result.subtype && result.subtype !== 'success') notes.push(result.subtype)
  if (!meta.typecheck_green) notes.push('typecheck red')
  if (denials) notes.push(`${denials} denied tool calls`)
  if (meta.shortstat_public) notes.push(`public: ${meta.shortstat_public.trim()}`)
  if (result.num_turns) notes.push(`${result.num_turns} turns`)
  return {
    task: meta.task, commit: meta.commit, run: meta.run, model,
    input_tokens: usage.input_tokens ?? '', output_tokens: usage.output_tokens ?? '',
    cache_read_tokens: usage.cache_read_input_tokens ?? '',
    cache_creation_tokens: usage.cache_creation_input_tokens ?? '',
    cost_usd: result.total_cost_usd == null ? '' : +result.total_cost_usd.toFixed(4),
    tool_calls: toolCalls, files_read: read.size, files_edited: edited.size,
    lines_changed_src: lines(meta.shortstat_src), lines_changed_test: lines(meta.shortstat_test),
    wall_seconds: meta.wall_seconds, tests_green: meta.tests_green ? 'y' : 'n',
    notes: notes.join('; '), reads: [...read].sort(), edits: [...edited].sort(),
  }
}

const runs = readdirSync(logs).filter((f) => f.endsWith('.meta.json'))
  .map((f) => parseRun(JSON.parse(readFileSync(join(logs, f), 'utf8'))))
  .sort((a, b) => a.task.localeCompare(b.task) || a.commit.localeCompare(b.commit) || a.run - b.run)

const csvCell = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)
writeFileSync(join(here, 'runs.csv'), [COLUMNS.join(','), ...runs.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n')
writeFileSync(join(here, 'reads.csv'), ['task,commit,run,path', ...runs.flatMap((r) => r.reads.map((p) => `${r.task},${r.commit},${r.run},${p}`))].join('\n') + '\n')

const COMMITS = [...new Set(runs.map((r) => r.commit))]
const TASKS = [...new Set(runs.map((r) => r.task))]
const median = (xs) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!s.length) return NaN; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const of = (task, commit) => runs.filter((r) => r.task === task && r.commit === commit)
const fmt = (x, d = 2) => Number.isFinite(x) ? x.toFixed(d) : 'n/a'
const stat = (task, commit, f) => median(of(task, commit).map(f))
const perLine = (r) => r.lines_changed_src > 0 ? r.cost_usd / r.lines_changed_src : NaN

const out = []
const range = (task, commit, f) => { const xs = of(task, commit).map(f).filter(Number.isFinite); return xs.length ? `${fmt(median(xs))} (${fmt(Math.min(...xs))}–${fmt(Math.max(...xs))})` : 'n/a' }
out.push('### Cost per task per commit, USD: median (min–max) of 3 runs', '', `| task | ${COMMITS.join(' | ')} |`, `|---|${COMMITS.map(() => '---').join('|')}|`)
for (const t of TASKS) out.push(`| ${t} | ${COMMITS.map((c) => range(t, c, (r) => r.cost_usd)).join(' | ')} |`)
out.push('', '### Median lines changed under `src/` and cost per line (USD)', '', `| task | ${COMMITS.map((c) => `${c} lines`).join(' | ')} | ${COMMITS.map((c) => `${c} $/line`).join(' | ')} |`, `|---|${COMMITS.map(() => '---').join('|')}|${COMMITS.map(() => '---').join('|')}|`)
for (const t of TASKS) out.push(`| ${t} | ${COMMITS.map((c) => fmt(stat(t, c, (r) => r.lines_changed_src), 0)).join(' | ')} | ${COMMITS.map((c) => fmt(stat(t, c, perLine), 3)).join(' | ')} |`)
out.push('', '### Median tokens, tool calls, files read, wall time', '', '| task | commit | input | output | cache read | tool calls | files read | files edited | wall s | green |', '|---|---|---|---|---|---|---|---|---|---|')
for (const t of TASKS) for (const c of COMMITS) {
  const rs = of(t, c)
  out.push(`| ${t} | ${c} | ${fmt(median(rs.map((r) => +r.input_tokens)), 0)} | ${fmt(median(rs.map((r) => +r.output_tokens)), 0)} | ${fmt(median(rs.map((r) => +r.cache_read_tokens)), 0)} | ${fmt(median(rs.map((r) => r.tool_calls)), 0)} | ${fmt(median(rs.map((r) => r.files_read)), 0)} | ${fmt(median(rs.map((r) => r.files_edited)), 0)} | ${fmt(median(rs.map((r) => r.wall_seconds)), 0)} | ${rs.filter((r) => r.tests_green === 'y').length}/${rs.length} |`)
}
out.push('', '### Ratio wiring / drawing (median cost, and median cost per src line)', '', '| commit | T2/T1 cost | T3/T1 cost | T2/T1 $/line | T3/T1 $/line |', '|---|---|---|---|---|')
for (const c of COMMITS) {
  const t1 = stat('T1', c, (r) => r.cost_usd), l1 = stat('T1', c, perLine)
  out.push(`| ${c} | ${fmt(stat('T2', c, (r) => r.cost_usd) / t1)} | ${fmt(stat('T3', c, (r) => r.cost_usd) / t1)} | ${fmt(stat('T2', c, perLine) / l1)} | ${fmt(stat('T3', c, perLine) / l1)} |`)
}
const mustRead = (rs) => rs.length ? rs.map((r) => new Set(r.reads)).reduce((a, b) => new Set([...a].filter((p) => b.has(p)))) : new Set()
out.push('', '### Files read in every run (the must-read set)', '')
for (const t of TASKS) {
  out.push(`- **${t}, all commits**: ${[...mustRead(runs.filter((r) => r.task === t))].map((p) => `\`${p}\``).join(', ') || 'none'}`)
  for (const c of COMMITS) out.push(`  - ${c}: ${[...mustRead(of(t, c))].map((p) => `\`${p}\``).join(', ') || 'none'}`)
}
const freq = new Map()
for (const r of runs) for (const p of r.reads) freq.set(p, (freq.get(p) ?? 0) + 1)
out.push('', '### Most read paths across all runs', '', '| path | runs |', '|---|---|')
for (const [p, n] of [...freq].sort((a, b) => b[1] - a[1]).slice(0, 15)) out.push(`| \`${p}\` | ${n}/${runs.length} |`)
out.push('', '### Files edited, per run', '', '| run | edited |', '|---|---|')
for (const r of runs) out.push(`| ${r.task}-${r.commit}-${r.run} | ${r.edits.map((p) => `\`${p}\``).join(', ')} |`)
console.log(out.join('\n'))
