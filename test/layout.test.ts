import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { STRIP_MAX_HEIGHT, STRIP_PAD, stripRadius, termStripLayout, MATRIX_CELL_MAX, MATRIX_CELL_MIN, MATRIX_GAP, MATRIX_ROWHEAD, WEEK_MAX_HEIGHT, WEEK_SIZE_MIN, attentionLayout, logTicks, matrixLayout, niceTicks, peakDay, persistenceLayout, placeLabels, scatterLayout, swarm, swarmBy, weekLayout, type LabelBounds, type LabelItem, type LabelPlacement } from '../src/ui/layout.js'

// src/ui/layout.ts: pure geometry.

// Deterministic stand-in for the browser canvas adapter (measure.ts's
// createCanvasMeasure): width scales linearly with character count and font size, so layout
// behaves predictably without a real <canvas>.
const measure = (text: string, size: number) => text.length * size * 0.6

describe('swarm / swarmBy: one beeswarm skeleton (issue #99 AC6)', () => {
  it('swarm is swarmBy with circle clearance and still keeps every x, never overlapping', () => {
    const items = [
      { id: 'a', x: 10, r: 9 },
      { id: 'b', x: 14, r: 7 },
      { id: 'c', x: 18, r: 5 },
      { id: 'd', x: 12, r: 4 },
    ]
    const placed = swarm(items)
    assert.equal(placed.length, items.length, 'the circle swarm never drops a dot')
    for (const p of placed) assert.equal(p.x, items.find((i) => i.id === p.id)?.x)
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) assert.ok(Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y) >= placed[i].r + placed[j].r - 1e-6, 'two dots may not overlap')
    assert.deepEqual(swarm(items), placed, 'deterministic')
  })

  it('swarmBy sends an item nowhere to go to overflow rather than off the figure', () => {
    const items = [
      { term: 'um', x: 0, w: 40, h: 20 },
      { term: 'dois', x: 0, w: 40, h: 20 },
      { term: 'tres', x: 0, w: 40, h: 20 },
    ]
    const { placed, overflow } = swarmBy(items, {
      size: (d) => d.w,
      reach: (p, item) => (Math.abs(p.x - item.x) < (p.w + item.w) / 2 ? (p.h + item.h) / 2 : null),
      fits: (item, y) => Math.abs(y) + item.h / 2 <= 25,
    })
    assert.equal(placed.length, 1, 'only one 20px box fits inside a 50px band')
    assert.equal(overflow.length, 2)
    assert.equal(placed.length + overflow.length, items.length)
  })

  it('swarm keeps every x, never overlaps two dots and puts the biggest on the axis', () => {
    const items = [
      { id: 'a', x: 100, r: 10 },
      { id: 'b', x: 104, r: 6 },
      { id: 'c', x: 108, r: 6 },
      { id: 'd', x: 300, r: 8 },
      { id: 'e', x: 101, r: 14 },
    ]
    const placed = swarm(items)
    assert.equal(placed.length, items.length)
    for (const p of placed) assert.equal(p.x, items.find((i) => i.id === p.id)?.x, 'x is the score; the swarm may only move y')
    assert.equal(placed.find((p) => p.id === 'e')?.y, 0, 'the biggest dot sits on the axis')
    assert.equal(placed.find((p) => p.id === 'd')?.y, 0, 'a dot with no neighbour sits on the axis')
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j]
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 1.5 - 1e-6, `${a.id} and ${b.id} overlap`)
      }
    assert.deepEqual(swarm(items), placed, 'deterministic')
  })
})

describe('weekLayout (issue #147): one column per day, built on swarmBy', () => {
  const term = (t: string, count: number, kind = 'word') => ({ term: t, kind, count })

  it('returns one column per day, in the order given', () => {
    const days = [[term('reforma', 4)], [], [term('eleicao', 2), term('pauta', 5)]]
    const columns = weekLayout(measure, days)
    assert.equal(columns.length, 3)
    assert.equal(columns[1].words.length, 0, 'an empty day is an empty column, not dropped')
  })

  it('every word in a day is either placed or listed as overflow, never lost', () => {
    const day = Array.from({ length: 40 }, (_, i) => term(`palavradodiaaaaaaaaaaaaaaaaaa${i}`, 40 - i))
    const [column] = weekLayout(measure, [day])
    assert.ok(column.overflow.length > 0, 'this many words cannot fit one column')
    assert.equal(column.words.length + column.overflow.length, day.length)
    for (const w of column.words) assert.ok(w.size >= WEEK_SIZE_MIN, `${w.term} at ${w.size}px is under the floor`)
    assert.ok(column.height <= WEEK_MAX_HEIGHT + 20, 'the column trades overflow for height, not an unbounded column')
  })

  it('two placed words in the same day never overlap vertically', () => {
    const day = [term('reforma', 10), term('pauta', 8), term('eleicao', 6), term('governo', 4)]
    const [column] = weekLayout(measure, [day])
    for (let i = 0; i < column.words.length; i++)
      for (let j = i + 1; j < column.words.length; j++) {
        const a = column.words[i]
        const b = column.words[j]
        assert.ok(Math.abs(a.y - b.y) >= (a.h + b.h) / 2 - 1e-6, `${a.term} and ${b.term} overlap vertically`)
      }
  })

  it('the loudest word of the day sizes larger than the quietest', () => {
    const [column] = weekLayout(measure, [[term('grande', 20), term('pequena', 1)]])
    const big = column.words.find((w) => w.term === 'grande')!
    const small = column.words.find((w) => w.term === 'pequena')!
    assert.ok(big.size > small.size)
  })

  it('sizes on one ramp for the whole week: a loud word on a loud day outsizes the loudest word of a quiet day (#148 review, 5)', () => {
    const [quiet, loud] = weekLayout(measure, [[term('crise', 3), term('pauta', 1)], [term('lei', 300), term('governo', 100)]])
    const quietTop = quiet.words.find((w) => w.term === 'crise')!
    const loudTop = loud.words.find((w) => w.term === 'lei')!
    assert.ok(loudTop.size > quietTop.size, `${loudTop.size}px should beat ${quietTop.size}px`)
    assert.ok(loudTop.size >= 28, 'the loudest word of the week reaches the ruler ceiling, not a 24px cap')
  })

  it('is deterministic: the same day packs to the same picture', () => {
    const day = [term('reforma', 10), term('pauta', 8), term('eleicao', 6)]
    const once = weekLayout(measure, [day])[0]
    const twice = weekLayout(measure, [day])[0]
    assert.deepEqual(once.words, twice.words)
    assert.deepEqual(once.overflow, twice.overflow)
    assert.equal(once.height, twice.height)
  })

  it('the loudest word sets a week-wide ceiling so the largest count is never the one the column hides (validator round 2, 2)', () => {
    const day = [term('presidente', 96), term('candidato', 14), term('crise', 3)]
    const [column] = weekLayout(measure, [day], 120)
    const presidente = column.words.find((w) => w.term === 'presidente')
    assert.ok(presidente, 'presidente leads the day and must be drawn in the column, not listed under it')
    assert.ok(presidente.w <= 120 - 6 + 1e-6, `presidente at ${presidente.w}px overflows the 120px column`)
    assert.equal(column.overflow.length, 0)
    const byCount = [...column.words].sort((a, b) => b.count - a.count)
    for (let i = 1; i < byCount.length; i++) {
      assert.ok(byCount[i - 1].size > byCount[i].size, `${byCount[i - 1].term}@${byCount[i - 1].size} must be larger than ${byCount[i].term}@${byCount[i].size}`)
    }
    assert.ok(presidente.size < 30, 'a 120px column cannot hold presidente at 30px, so the ceiling drops')
    assert.equal(column.words.find((w) => w.term === 'crise')!.size, WEEK_SIZE_MIN, 'the floor never moves')
  })

  it('the ceiling only drops when the column forces it: the same day reaches 30px at 342px', () => {
    const day = [term('presidente', 96), term('candidato', 14), term('crise', 3)]
    const [column] = weekLayout(measure, [day], 342)
    assert.equal(column.words.find((w) => w.term === 'presidente')!.size, 30)
  })

  it('the ceiling is shared by the whole week: a quiet day never outsizes the loud one whose word forced it down', () => {
    const [loud, quiet] = weekLayout(measure, [[term('presidente', 96), term('crise', 3)], [term('lei', 60), term('voto', 3)]], 120)
    const presidente = loud.words.find((w) => w.term === 'presidente')!
    const lei = quiet.words.find((w) => w.term === 'lei')!
    assert.ok(presidente.size > lei.size, `presidente:96@${presidente.size} must beat lei:60@${lei.size}`)
  })

  it('eight short words at mixed counts all place in a 159px column, none pushed out by the height cap (validator round 1, 2)', () => {
    const day = [term('governo', 67), term('reforma', 40), term('pauta', 31), term('eleicao', 20), term('crise', 12), term('lei', 8), term('voto', 5), term('urna', 3)]
    const [column] = weekLayout(measure, [day], 159)
    assert.equal(column.overflow.length, 0, `${column.overflow.map((w) => w.term).join(', ')} did not fit`)
    assert.equal(column.words.length, 8)
    assert.ok(column.height <= WEEK_MAX_HEIGHT + 20)
  })

  it('a word wider than a narrow column even at the floor size is listed under the column, never drawn across the next day (#148 review, 1)', () => {
    const day = [term('pronunciamento', 96), term('crise', 3)]
    const [column] = weekLayout(measure, [day], 84)
    assert.ok(!column.words.some((w) => w.term === 'pronunciamento'), 'one word cannot break, does not fit 84px at 12px and must not be placed')
    assert.ok(column.overflow.some((w) => w.term === 'pronunciamento'), 'it is still reachable in the overflow list')
    for (const w of column.words) assert.ok(w.w <= 84 - 6 + 1e-6)
  })

  it('a phrase wraps at its spaces, never inside a word, and is placed as one box as tall as its lines', () => {
    const day = [term('supremo tribunal federal', 96, 'phrase'), term('crise', 3)]
    const [column] = weekLayout(measure, [day], 145)
    const stf = column.words.find((w) => w.term === 'supremo tribunal federal')
    assert.ok(stf, 'the phrase fits once wrapped and is drawn, not listed')
    assert.deepEqual(stf!.lines, ['supremo', 'tribunal', 'federal'])
    assert.equal(stf!.h, Math.round(stf!.size * 1.24) * 3)
    assert.ok(stf!.w <= 145 - 6 + 1e-6, 'the box is as wide as its longest line')
    assert.ok(stf!.size > WEEK_SIZE_MIN, 'the loudest word wraps at a size well above the floor instead of pulling the ceiling down')
    assert.equal(column.overflow.length, 0)
  })

  it('a long one-word term below the loudest phrase is listed, not placed, since the ceiling is the loudest words\' and lowering it for every unwrappable word would flatten the week (#166 review, 1)', () => {
    const day = [term('supremo tribunal federal', 96, 'phrase'), term('presidente', 90), term('crise', 3)]
    const [column] = weekLayout(measure, [day], 145)
    const stf = column.words.find((w) => w.term === 'supremo tribunal federal')!
    assert.ok(stf.size > 20, `the wrapped phrase keeps the ceiling up, at ${stf.size}px`)
    assert.ok(column.overflow.some((w) => w.term === 'presidente'), 'presidente does not fit at the size its count earns and is listed with its count')
    assert.ok(!column.words.some((w) => w.term === 'presidente'))
  })

  it('twelve mixed phrases and words, the widest limit the sentence offers, all place at 145px and 159px: the height cap counts lines (#166 review, 2)', () => {
    const day = [term('supremo tribunal federal', 96, 'phrase'), term('ministro da fazenda', 80, 'phrase'), term('primeiro turno', 70, 'phrase'), term('reforma tributaria', 60, 'phrase'), term('presidente', 50), term('governo', 45), term('congresso', 40), term('camara dos deputados', 35, 'phrase'), term('senado', 30), term('eleicao', 20), term('lei', 10), term('voto', 5)]
    for (const width of [145, 159]) {
      const [column] = weekLayout(measure, [day], width)
      assert.equal(column.overflow.length, 0, `${column.overflow.map((w) => w.term).join(', ')} did not fit at ${width}px`)
      assert.equal(column.words.length, 12)
      assert.ok(column.height > WEEK_MAX_HEIGHT, 'the column grows past the one-line cap instead of dropping the quietest words')
    }
  })

  it('a hyphenated word breaks after its hyphen, the break weekLayout prefers (#166 review, nit)', () => {
    const [column] = weekLayout(measure, [[term('vice-presidente', 96), term('crise', 3)]], 145)
    const vice = column.words.find((w) => w.term === 'vice-presidente')!
    assert.deepEqual(vice.lines, ['vice-', 'presidente'])
    assert.ok(vice.size > WEEK_SIZE_MIN + 2, `the ceiling stays up at ${vice.size}px instead of the one-line floor`)
  })

  it('a one-word line keeps every single word on one line: no wrap means lines is [text]', () => {
    const [column] = weekLayout(measure, [[term('crise', 3)]], 145)
    assert.deepEqual(column.words[0].lines, ['crise'])
    assert.equal(column.words[0].h, Math.round(column.words[0].size * 1.24))
  })
})

// Issue #216 (figure 7): peakDay is the pure helper both the mentions and the views series
// share -- each series arrives as one { day, value } pair per calendar day, already reduced to
// the one number that series scores by (mentions' own count, or a day's pageviews).
describe('peakDay (issue #216)', () => {
  it('a single maximum returns that day (AC2)', () => {
    const series = [
      { day: '2026-09-01', value: 3 },
      { day: '2026-09-02', value: 9 },
      { day: '2026-09-03', value: 1 },
    ]
    assert.equal(peakDay(series), '2026-09-02')
  })

  it('a tie between two or more days sharing the maximum returns the earliest, oldest one (AC2)', () => {
    const series = [
      { day: '2026-09-01', value: 5 },
      { day: '2026-09-02', value: 9 },
      { day: '2026-09-03', value: 9 },
    ]
    assert.equal(peakDay(series), '2026-09-02')
  })

  it('a tie fed in reversed order still returns the oldest day, never the one the loop met first (AC2)', () => {
    const series = [
      { day: '2026-09-03', value: 9 },
      { day: '2026-09-02', value: 5 },
      { day: '2026-09-01', value: 9 },
    ]
    assert.equal(peakDay(series), '2026-09-01')
  })

  it('an all-zero series has no peak, returns null (AC2)', () => {
    const series = [
      { day: '2026-09-01', value: 0 },
      { day: '2026-09-02', value: 0 },
      { day: '2026-09-03', value: 0 },
    ]
    assert.equal(peakDay(series), null)
  })
})

// Issue #216 (figure 7): 30 columns at 640px (or fewer, wider ones on mobile at 343px) must
// never let one day's mark box reach into its neighbour's, at realistic values (views
// 4 210-51 000, mentions 12-120).
describe('attentionLayout (issue #216), no adjacent overlap on a 30-day grid', () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`)
  const mentions = (n: number) => days(n).map((day, i) => ({ day, count: 12 + ((i * 37) % 108) }))
  const views = (n: number) => days(n).map((day, i) => ({ day, views: 4210 + ((i * 4013) % 46790) }))

  const assertNoOverlap = (marks: { x: number; barW: number }[], label: string) => {
    const sorted = [...marks].sort((a, b) => a.x - b.x)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const cur = sorted[i]
      const prevRight = prev.x + prev.barW / 2
      const curLeft = cur.x - cur.barW / 2
      assert.ok(curLeft >= prevRight, `${label}: day ${i} overlaps day ${i - 1} (prev right ${prevRight}, cur left ${curLeft})`)
    }
  }

  it('30 days, 5-digit views, width 640: no two adjacent marks overlap in either row', () => {
    const layout = attentionLayout(measure, mentions(30), views(30), 640)
    assertNoOverlap(layout.mentions, 'mentions')
    assertNoOverlap(layout.views, 'views')
  })

  it('30 days, 5-digit views, width 343 (mobile): no two adjacent marks overlap in either row', () => {
    const layout = attentionLayout(measure, mentions(30), views(30), 343)
    assertNoOverlap(layout.mentions, 'mentions')
    assertNoOverlap(layout.views, 'views')
  })

  it("each row's largest day renders at that row's own ceiling size (AC4)", () => {
    const mentionSeries = [
      { day: '2026-08-01', count: 3 },
      { day: '2026-08-02', count: 3 },
      { day: '2026-08-03', count: 40 },
    ]
    const viewSeries = [
      { day: '2026-08-01', views: 50000 },
      { day: '2026-08-02', views: 1000 },
      { day: '2026-08-03', views: 1000 },
    ]
    const layout = attentionLayout(measure, mentionSeries, viewSeries, 640)
    const mentionSizes = layout.mentions.map((m) => m.size)
    const viewSizes = layout.views.map((v) => v.size)
    assert.equal(mentionSizes[2], Math.max(...mentionSizes), "mentions' own peak day (index 2) must render at its own row's ceiling")
    assert.equal(viewSizes[0], Math.max(...viewSizes), "views' own peak day (index 0) must render at its own row's ceiling")
  })
})

describe('matrixLayout (figure 9, issue #207)', () => {
  it('keys a pair by its own a/b, independent of the row/column order the persons array gives, pinning the positional-key bug hit while building', () => {
    // persons is name-ordered ("Ana" < "Bia" < "Rita"), which here differs from the id order the
    // pair travels in (a=lula, b=tarcisio, alphabetically 'lula' < 'tarcisio' regardless of name).
    const persons = [
      { id: 'tarcisio', name: 'Ana' },
      { id: 'lula', name: 'Bia' },
      { id: 'bolsonaro', name: 'Rita' },
    ]
    const { cellSize, cells } = matrixLayout(persons, [{ a: 'lula', b: 'tarcisio', count: 4 }], 900)
    assert.equal(cells.length, (persons.length * (persons.length - 1)) / 2, 'one cell per upper-triangle slot, a<b in row/column order')
    const filled = cells.filter((c) => c.count !== null)
    assert.equal(filled.length, 1, 'exactly one non-null cell')
    assert.deepEqual(filled[0], { a: 'tarcisio', b: 'lula', count: 4, ink: 1 })
    for (const c of cells) if (c.a !== 'tarcisio' || c.b !== 'lula') assert.equal(c.count, null, `${c.a}/${c.b} must be null`)
    assert.ok(cellSize >= MATRIX_CELL_MIN && cellSize <= MATRIX_CELL_MAX)
  })

  it('clamps cellSize to MATRIX_CELL_MIN/MAX regardless of how narrow or wide the container is', () => {
    const persons = Array.from({ length: 27 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }))
    const narrow = matrixLayout(persons, [], 10)
    assert.equal(narrow.cellSize, MATRIX_CELL_MIN)
    const wide = matrixLayout(persons, [], 4000)
    assert.equal(wide.cellSize, MATRIX_CELL_MAX)
  })

  const many = Array.from({ length: 27 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }))

  it('returns pitch as cellSize plus both gaps, with the gap and row head constants', () => {
    for (const width of [10, 895, 900, 1247, 1440, 4000]) {
      const l = matrixLayout(many, [], width)
      assert.equal(l.gap, MATRIX_GAP)
      assert.equal(l.gap, 1)
      assert.equal(l.rowhead, MATRIX_ROWHEAD)
      assert.equal(l.rowhead, 140)
      assert.equal(l.pitch, l.cellSize + 2 * l.gap)
    }
  })

  it('fits rowhead plus 27 pitches inside the width at and above the floor width', () => {
    for (const width of [896, 900, 1000, 1247, 1300, 1328, 1440, 4000]) {
      const l = matrixLayout(many, [], width)
      assert.ok(l.rowhead + 27 * l.pitch <= width, `width ${width}: ${l.rowhead} + 27 * ${l.pitch} overflows`)
    }
  })

  it('pins the fit at the 26 floor, 27, 41 and 42 ceiling boundaries for 27 persons', () => {
    const at = (width: number) => matrixLayout(many, [], width).cellSize
    assert.equal(at(895), 26)
    assert.equal(at(896), 26)
    assert.equal(at(923), 27)
    assert.equal(at(1327), 41)
    assert.equal(at(1328), 42)
    assert.equal(at(4000), 42)
  })

  it('below the floor keeps the 26 cell and reports a grid wider than the width', () => {
    for (const width of [10, 895]) {
      const l = matrixLayout(many, [], width)
      assert.equal(l.cellSize, MATRIX_CELL_MIN)
      assert.ok(l.rowhead + 27 * l.pitch > width)
      assert.equal(l.cells.length, 351)
    }
  })

  it('never yields NaN or a negative size for no persons, one person, a zero width or no pairs', () => {
    for (const persons of [[], many.slice(0, 1)]) {
      for (const width of [0, 1, 4000]) {
        const l = matrixLayout(persons, [], width)
        assert.equal(l.cells.length, 0)
        assert.ok(Number.isFinite(l.cellSize) && l.cellSize >= MATRIX_CELL_MIN)
      }
    }
    assert.ok(matrixLayout(many, [], 0).cells.every((c) => c.count === null))
  })
})

// Issue #215 (figure 10): persistenceLayout is a fixed table grid, not a beeswarm: one row per
// term, one cell per week in series order, and a level per cell on ONE ramp for the whole
// figure, keyed to the largest count shown. It takes the GET /persistence payload and returns
// { rows: [{ term, kind, cells: [{ week, count, level }] }] }; a null count has level 0 and a
// positive count never does.
describe('persistenceLayout (figure 10, issue #215)', () => {
  const weeks = (n: number) => Array.from({ length: n }, (_, i) => `2026-08-${String(3 + 7 * i).padStart(2, '0')}`)
  const row = (term: string, counts: (number | null)[], kind = 'word') => ({
    term,
    kind,
    series: counts.map((count, i) => ({ week: weeks(counts.length)[i], count })),
    streak: 0,
    half_life: null,
  })
  const payload = (terms: ReturnType<typeof row>[]) => ({ weeks: terms[0]?.series.length ?? 0, since: '2026-09-09', first_week: '2026-08-03', horizon: 60, terms })
  const cellsOf = (l: ReturnType<typeof persistenceLayout>) => (l as unknown as { rows: { term: string; kind: string; cells: { week: string; count: number | null; level: number }[] }[] }).rows

  it('one row per term and one cell per week, in series order, so every row has the same number of columns', () => {
    const rows = cellsOf(persistenceLayout(payload([row('anistia', [null, 2, 3, 4]), row('golpe', [5, null, null, 1])]) as never))
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map((r) => r.term), ['anistia', 'golpe'])
    for (const r of rows) assert.deepEqual(r.cells.map((c) => c.week), weeks(4))
  })

  it('a null count is level 0 and every positive count is above it, however small next to the largest', () => {
    const rows = cellsOf(persistenceLayout(payload([row('anistia', [null, 1, 500, 2])]) as never))
    const [none, one, big, two] = rows[0].cells
    assert.equal(none.level, 0)
    assert.ok(one.level > 0, 'a count of 1 next to 500 is still visibly filled')
    assert.ok(two.level > 0)
    assert.ok(big.level >= two.level && two.level >= one.level, 'level never falls as the count grows')
  })

  it('one ramp for the whole figure: the same count has the same level in every row, and the largest count anywhere has the top level', () => {
    const rows = cellsOf(persistenceLayout(payload([row('anistia', [3, 3, null, 10]), row('golpe', [40, 3, 10, null])]) as never))
    const all = rows.flatMap((r) => r.cells)
    const levelOf = (count: number) => new Set(all.filter((c) => c.count === count).map((c) => c.level))
    for (const count of [3, 10, 40]) assert.equal(levelOf(count).size, 1, `count ${count} has one level across rows`)
    const top = Math.max(...all.map((c) => c.level))
    assert.equal([...levelOf(40)][0], top)
    assert.ok([...levelOf(3)][0] < top)
  })

  it('a grid of one count everywhere never paints an empty cell', () => {
    const rows = cellsOf(persistenceLayout(payload([row('anistia', [2, 2, 2, 2])]) as never))
    assert.ok(rows[0].cells.every((c) => c.level > 0))
  })

  it('no terms lays out no rows', () => {
    assert.deepEqual(cellsOf(persistenceLayout({ weeks: 12, since: '2026-09-09', first_week: null, horizon: 60, terms: [] } as never)), [])
  })
})

describe('#149 AC2/AC3/AC4: termStripLayout, words on the kikori axis', () => {
  const personTestimony = { method: 'kikori:q8', score: -1, n: 200 }
  const golpe = { id: 'word:golpe', term: 'golpe', kind: 'word', count: 41, pmi: 2.1, testimony: { score: -3.97, n: 12 } }
  const reforma = { id: 'word:reforma', term: 'reforma', kind: 'word', count: 20, pmi: 1.4, testimony: { score: 0, n: 6 } }
  const agenda = { id: 'word:agenda', term: 'agenda', kind: 'word', count: 15, pmi: 1.1, testimony: { score: 2.5, n: 9 } }
  const rare = { id: 'word:rare', term: 'rara', kind: 'word', count: 3, pmi: 0.5, testimony: { score: 4, n: 2 } } // n < MASK_MIN
  const unscored = { id: 'word:unscored', term: 'silencio', kind: 'word', count: 7, pmi: 0.8, testimony: null } // testimony: null
  const missing = { id: 'word:missing', term: 'ausente', kind: 'word', count: 5, pmi: 0.6 } // testimony: undefined
  const stripNodes = [golpe, reforma, agenda, rare, unscored, missing]

  it('only the nodes termMask accepts are included, and x is monotonic non-decreasing in score', () => {
    const layout = termStripLayout(stripNodes, personTestimony, 860)
    const ids = new Set(layout.dots.map((d: { id: string }) => d.id))
    assert.deepEqual(ids, new Set(['word:golpe', 'word:reforma', 'word:agenda']), 'rare (n<3), unscored (testimony: null) and missing (testimony: undefined) must be excluded')
    const byScore = [...layout.dots].sort((a: { score: number }, b: { score: number }) => a.score - b.score)
    for (let i = 1; i < byScore.length; i++) assert.ok(byScore[i].x >= byScore[i - 1].x, 'x must never decrease as score increases')
  })

  it('excludes every node when the person has no eligible score (stats.testimony absent or its score null/undefined)', () => {
    assert.equal(termStripLayout(stripNodes, { method: 'kikori', score: null, n: 0 }, 860).dots.length, 0, 'a null person score')
    assert.equal(termStripLayout(stripNodes, undefined, 860).dots.length, 0, 'an absent stats.testimony')
  })

  it('the domain widens to at least 2 with exactly one eligible word', () => {
    const layout = termStripLayout([golpe], personTestimony, 860)
    assert.equal(layout.dots.length, 1)
    assert.ok(layout.domainMax - layout.domainMin >= 2, `domain must widen for a single point: got [${layout.domainMin}, ${layout.domainMax}]`)
  })

  it('the domain widens when every eligible word ties the person mean', () => {
    const tied = [
      { id: 'word:a', term: 'a', kind: 'word', count: 5, pmi: 1, testimony: { score: -1, n: 4 } },
      { id: 'word:b', term: 'b', kind: 'word', count: 6, pmi: 1, testimony: { score: -1, n: 5 } },
    ]
    const layout = termStripLayout(tied, personTestimony, 860)
    assert.ok(layout.domainMax - layout.domainMin >= 2, `domain must widen when every word ties the mean: got [${layout.domainMin}, ${layout.domainMax}]`)
  })

  // issue #149 gap: a float personScore (e.g. -3.97) can sit a hair from its floor/ceil edge
  // (-4) without ever equaling it, so an exact-value guard misses it and the dashed mean line
  // draws on the last slice of the axis.
  it('gap: a float person score near its domain edge still gets pushed off the edge', () => {
    const floatPerson = { method: 'kikori:q8', score: -3.97, n: 200 }
    const wide = [
      { id: 'word:a', term: 'a', kind: 'word', count: 20, pmi: 1, testimony: { score: -1, n: 10 } },
      { id: 'word:b', term: 'b', kind: 'word', count: 20, pmi: 1, testimony: { score: 2, n: 10 } },
    ]
    const layout = termStripLayout(wide, floatPerson, 860)
    assert.ok(layout.domainMin < Math.floor(floatPerson.score), `domainMin must widen past the plain floor(-3.97) = -4: got ${layout.domainMin}`)
    const overallX = layout.x(floatPerson.score)
    const innerStart = STRIP_PAD
    const span = layout.domainMax - layout.domainMin
    const fraction = (overallX - innerStart) / (860 - 2 * innerStart)
    assert.ok(fraction > 0.03, `the mean must sit clear of the left edge, got fraction=${fraction} (domain [${layout.domainMin}, ${layout.domainMax}], span ${span})`)
  })

  // issue #149 gap: termStripLayout only reads the nodes array it is handed; it filters
  // eligibility with termMask but never applies any alias/own-name filtering of its own.
  it('gap: termStripLayout consumes only the nodes array it is handed, never filtering by name', () => {
    const layout = termStripLayout([golpe], personTestimony, 860)
    const ids = new Set(layout.dots.map((d: { id: string }) => d.id))
    assert.deepEqual(ids, new Set(['word:golpe']), 'a node absent from the given array never appears, regardless of what it is named')
    // A node shaped like a tracked person's own name: real alias filtering happens upstream
    // in graphFor, so it never reaches here in production, but termStripLayout itself must
    // apply no such rule — an eligible node it is handed is drawn regardless of its term.
    const ownName = { id: 'word:lula', term: 'lula', kind: 'word', count: 30, pmi: 1, testimony: { score: -0.5, n: 5 } }
    const withOwnName = termStripLayout([golpe, ownName], personTestimony, 860)
    assert.deepEqual(
      new Set(withOwnName.dots.map((d: { id: string }) => d.id)),
      new Set(['word:golpe', 'word:lula']),
      'termStripLayout draws every eligible node handed to it, with no alias/own-name filtering of its own',
    )
    const full = termStripLayout(stripNodes, personTestimony, 860)
    assert.deepEqual(
      new Set(full.dots.map((d: { id: string }) => d.id)),
      new Set(['word:golpe', 'word:reforma', 'word:agenda']),
      'every eligible node handed in appears; termStripLayout applies no filter beyond termMask',
    )
  })

  // issue #149 gap: at count >= 100 with 24 nodes (limit=24, the widest select option), the
  // strip must still fit STRIP_MAX_HEIGHT by shrinking dots together. All 24 sharing one score
  // is the worst case for stacking (a spread-out score, like -5+(i%10) across 10 x-slots, never
  // reaches STRIP_MAX_HEIGHT at all and so never exercises the while loop this pins).
  it('gap: 24 same-score nodes with count >= 100 force the shrink loop and still fit STRIP_MAX_HEIGHT', () => {
    const many = Array.from({ length: 24 }, (_, i) => ({
      id: `word:w${i}`,
      term: `w${i}`,
      kind: 'word',
      count: 100 + i,
      pmi: 1,
      testimony: { score: -1, n: 20 },
    }))
    const unshrunk = stripRadius(100, 860)
    const layout = termStripLayout(many, personTestimony, 860)
    assert.equal(layout.dots.length, 24)
    assert.ok(layout.height <= STRIP_MAX_HEIGHT, `height ${layout.height} must fit STRIP_MAX_HEIGHT (${STRIP_MAX_HEIGHT})`)
    assert.ok(
      (layout.dots[0] as { r: number }).r < unshrunk - 1e-6,
      `the shrink loop must have run: dot radius ${(layout.dots[0] as { r: number }).r} must be smaller than the unshrunk ${unshrunk}`,
    )
  })
})

describe('logTicks (issue #328 AC13)', () => {
  it('lists the 1-2-5 values inside the range, ascending', () => {
    assert.deepEqual(logTicks(3, 480), [5, 10, 20, 50, 100, 200])
  })

  it('brackets a range with fewer than two values inside', () => {
    assert.deepEqual(logTicks(1, 1), [1, 2])
    assert.deepEqual(logTicks(7, 7), [5, 10])
    assert.deepEqual(logTicks(5, 5), [2, 5, 10])
  })

  it('clamps a minimum below 1 to 1', () => {
    assert.equal(logTicks(0, 40)[0], 1)
    assert.deepEqual(logTicks(-3, 8), [1, 2, 5])
  })
})

describe('niceTicks (issue #328 AC13)', () => {
  it('covers the data, ascending, and keeps 0 when the range crosses it', () => {
    const ticks = niceTicks(-1.4, 3.2)
    assert.ok(ticks.includes(0))
    assert.ok(ticks[0] <= -1.4 && ticks[ticks.length - 1] >= 3.2)
    assert.deepEqual([...ticks].sort((a, b) => a - b), ticks)
  })

  it('returns at least two finite values for a single value, bracketing it', () => {
    const ticks = niceTicks(2, 2)
    assert.ok(ticks.length >= 2 && ticks.every(Number.isFinite))
    assert.ok(ticks[0] <= 2 && ticks[ticks.length - 1] >= 2)
  })

  it('steps are 1, 2 or 5 times a power of ten, with no float residue', () => {
    for (const [lo, hi] of [[0.2, 2.9], [0, 0.7], [-30, 900], [1.4, 2.1]]) {
      const ticks = niceTicks(lo, hi)
      assert.ok(ticks[0] <= lo && ticks[ticks.length - 1] >= hi, `${lo}..${hi}`)
      const step = ticks[1] - ticks[0]
      const mantissa = step / 10 ** Math.floor(Math.log10(step))
      assert.ok([1, 2, 5].some((m) => Math.abs(m - mantissa) < 1e-6), `step ${step}`)
      for (const t of ticks) assert.equal(t, Number(t.toPrecision(12)))
    }
  })
})

describe('scatterLayout scales (issue #328 AC12)', () => {
  const pt = (id: string, count: number, pmi: number | null) => ({ id, term: id, kind: 'word', count, pmi: pmi as number })
  const by = (layout: ReturnType<typeof scatterLayout>, id: string) => layout.points.find((p) => p.id === id)!

  it('x grows with count on a log scale, y falls as pmi rises', () => {
    const layout = scatterLayout(measure, [pt('a', 1, 0.5), pt('b', 10, 1.5), pt('c', 100, 2.5)], 860)
    assert.ok(by(layout, 'a').x < by(layout, 'b').x && by(layout, 'b').x < by(layout, 'c').x)
    assert.ok(by(layout, 'a').y > by(layout, 'b').y && by(layout, 'b').y > by(layout, 'c').y)
    assert.ok(Math.abs(by(layout, 'b').x - by(layout, 'a').x - (by(layout, 'c').x - by(layout, 'b').x)) < 1e-6, '1, 10, 100 are equally spaced')
  })

  it('keeps every point inside the plot box and the largest count rightmost', () => {
    const nodes = [pt('a', 3, -0.4), pt('b', 480, 3.1), pt('c', 40, 1), pt('d', 0, 0)]
    const layout = scatterLayout(measure, nodes, 600)
    for (const p of layout.points) {
      assert.ok(p.x >= layout.plot.left && p.x <= layout.plot.right, `${p.id} x ${p.x}`)
      assert.ok(p.y >= layout.plot.top && p.y <= layout.plot.bottom, `${p.id} y ${p.y}`)
    }
    assert.equal(layout.points.reduce((m, p) => (p.x > m.x ? p : m)).id, 'b')
  })

  it('draws a tick label position for every tick, inside the plot', () => {
    const layout = scatterLayout(measure, [pt('a', 3, 0.5), pt('b', 480, 2.5)], 860)
    assert.deepEqual(layout.xTicks.map((t) => t.value), logTicks(layout.xTicks[0].value, layout.xTicks.at(-1)!.value))
    for (const t of layout.xTicks) assert.ok(t.x >= layout.plot.left - 1e-6 && t.x <= layout.plot.right + 1e-6)
    for (const t of layout.yTicks) assert.ok(t.y >= layout.plot.top - 1e-6 && t.y <= layout.plot.bottom + 1e-6)
  })

  it('puts a negative pmi below the zero line and reads a null pmi as 0', () => {
    const layout = scatterLayout(measure, [pt('neg', 5, -1.2), pt('pos', 9, 2), pt('none', 7, null)], 860)
    assert.notEqual(layout.zeroY, null)
    assert.ok(by(layout, 'neg').y > (layout.zeroY as number))
    assert.ok(Math.abs(by(layout, 'none').y - (layout.zeroY as number)) < 1e-6)
    const absent = scatterLayout(measure, [pt('neg', 5, -1.2), pt('pos', 9, 2), { id: 'gone', term: 'gone', kind: 'word', count: 7 } as never], 860)
    assert.ok(Number.isFinite(by(absent, 'gone').y) && Math.abs(by(absent, 'gone').y - (absent.zeroY as number)) < 1e-6)
  })

  it('has no zero line when every pmi is above 0 and the first tick stays above it', () => {
    const layout = scatterLayout(measure, [pt('a', 5, 1.4), pt('b', 9, 2.1)], 860)
    assert.ok(layout.yTicks[0].value > 0)
    assert.equal(layout.zeroY, null)
  })

  it('puts the zero line on the bottom edge when 0 is the first tick', () => {
    const layout = scatterLayout(measure, [pt('a', 5, 0), pt('b', 9, 2.1)], 860)
    assert.equal(layout.yTicks[0].value, 0)
    assert.equal(layout.zeroY, layout.plot.bottom)
  })

  it('stays finite for one node, equal counts and equal pmi', () => {
    for (const nodes of [[pt('a', 7, 1)], [pt('a', 7, 1), pt('b', 7, 2)], [pt('a', 3, 1.5), pt('b', 90, 1.5)], [pt('a', 0, 0)]]) {
      const layout = scatterLayout(measure, nodes, 860)
      for (const p of layout.points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y))
      assert.equal(layout.points.length, nodes.length)
    }
  })

  it('widens the x domain to the 1-2-5 values around the counts and draws its ticks', () => {
    const span = (nodes: ReturnType<typeof pt>[]) => {
      const layout = scatterLayout(measure, nodes, 860)
      return [layout.xTicks[0].value, layout.xTicks.at(-1)!.value, layout]
    }
    const [lo, hi, layout] = span([pt('a', 3, 1), pt('b', 480, 2)]) as [number, number, ReturnType<typeof scatterLayout>]
    assert.deepEqual([lo, hi], [2, 500])
    assert.equal(layout.xTicks[0].x, layout.plot.left)
    assert.equal(layout.xTicks.at(-1)!.x, layout.plot.right)
    assert.deepEqual(span([pt('a', 10, 1), pt('b', 10, 2)]).slice(0, 2), [10, 20])
    assert.deepEqual(span([pt('a', 7, 1)]).slice(0, 2), [5, 10])
    assert.deepEqual(span([pt('a', 1, 1), pt('b', 100, 2)]).slice(0, 2), [1, 200])
  })

  it('spans the plot with the y ticks: the first tick on the bottom edge, the last on the top edge', () => {
    const layout = scatterLayout(measure, [pt('a', 4, -1.4), pt('b', 9, 3.2)], 860)
    assert.equal(layout.yTicks[0].y, layout.plot.bottom)
    assert.equal(layout.yTicks.at(-1)!.y, layout.plot.top)
    assert.ok(layout.yTicks[0].value <= -1.4 && layout.yTicks.at(-1)!.value >= 3.2)
    assert.ok(layout.yTicks.every((t, i, all) => i === 0 || (t.value > all[i - 1].value && t.y < all[i - 1].y)))
  })

  it('reads a count of 0 as 1 before the log', () => {
    const layout = scatterLayout(measure, [pt('zero', 0, 1), pt('one', 1, 1), pt('ten', 10, 1)], 860)
    assert.equal(by(layout, 'zero').x, by(layout, 'one').x)
    assert.ok(Number.isFinite(by(layout, 'zero').x))
  })

  it('lays a point out the same whatever its neighbours, so a pick or a search never moves it', () => {
    const a = scatterLayout(measure, [pt('a', 5, 1), pt('b', 90, 2)], 860)
    const b = scatterLayout(measure, [pt('a', 5, 1), pt('b', 90, 2)].reverse(), 860)
    assert.deepEqual(by(a, 'a'), by(b, 'a'))
    assert.deepEqual(by(a, 'b'), by(b, 'b'))
  })

  it('sizes the height from the width within 320 and 460, and is deterministic', () => {
    assert.equal(scatterLayout(measure, [pt('a', 2, 1)], 200).height, 320)
    assert.equal(scatterLayout(measure, [pt('a', 2, 1)], 2000).height, 460)
    const nodes = [pt('a', 12, 1), pt('b', 14, 1.1), pt('c', 90, 0.4)]
    const once = scatterLayout(measure, nodes, 700)
    const twice = scatterLayout(measure, nodes, 700)
    assert.deepEqual([...once.labels], [...twice.labels])
    assert.deepEqual(once.points, twice.points)
  })
})

describe('placeLabels order and bounds (issue #328 AC14)', () => {
  const bounds: LabelBounds = { left: 0, top: 0, right: 400, bottom: 200 }
  const gap = 4
  const item = (id: string, x: number, y: number, w = 40, h = 14, r = 5): LabelItem => ({ id, x, y, r, w, h })
  const box = (it: LabelItem, p: LabelPlacement) => {
    const left = p.anchor === 'start' ? p.x : p.anchor === 'end' ? p.x - it.w : p.x - it.w / 2
    return { left, right: left + it.w, top: p.y - it.h / 2, bottom: p.y + it.h / 2 }
  }

  it('puts an isolated item on its right', () => {
    const placed = placeLabels([item('a', 100, 100)], bounds, gap)
    assert.equal(placed.get('a')?.side, 'right')
    assert.equal(placed.get('a')?.anchor, 'start')
    assert.equal(placed.get('a')?.x, 100 + 5 + gap)
    assert.equal(placed.get('a')?.y, 100)
  })

  it('falls to left, then above, then below as the others are blocked, and gives up boxed in', () => {
    const wall = (id: string, x: number, y: number) => item(id, x, y, 40, 14, 5)
    const a = item('a', 200, 100)
    const right = wall('r', 230, 100)
    const left = wall('l', 170, 100)
    const above = wall('u', 200, 80)
    const below = wall('d', 200, 120)
    assert.equal(placeLabels([a, right], bounds, gap).get('a')?.side, 'left')
    assert.equal(placeLabels([a, right, left], bounds, gap).get('a')?.side, 'above')
    assert.equal(placeLabels([a, right, left, above], bounds, gap).get('a')?.side, 'below')
    assert.equal(placeLabels([a, right, left, above, below], bounds, gap).has('a'), false)
  })

  it('never overlaps two labels, a label and another point, or leaves the bounds', () => {
    const items = Array.from({ length: 30 }, (_, i) => item(`p${i}`, 20 + ((i * 53) % 360), 15 + ((i * 37) % 170), 24 + (i % 5) * 9))
    const placed = placeLabels(items, bounds, gap)
    const boxes = [...placed].map(([id, p]) => ({ id, ...box(items.find((i) => i.id === id)!, p) }))
    for (const b of boxes) {
      assert.ok(b.left >= bounds.left && b.right <= bounds.right && b.top >= bounds.top && b.bottom <= bounds.bottom, `${b.id} left the bounds`)
      for (const o of items.filter((i) => i.id !== b.id)) {
        const nx = Math.max(b.left, Math.min(o.x, b.right))
        const ny = Math.max(b.top, Math.min(o.y, b.bottom))
        assert.ok(Math.hypot(o.x - nx, o.y - ny) >= o.r + gap - 1e-9, `${b.id} touches the point ${o.id}`)
      }
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const clash = a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap
        assert.equal(clash, false, `${a.id} and ${b.id} overlap`)
      }
    assert.ok(placed.size > 0 && placed.size < items.length + 1)
  })

  it('lets the earlier item win a contested spot', () => {
    const a = item('a', 100, 100)
    const b = item('b', 100, 100)
    const placed = placeLabels([a, b], bounds, gap)
    assert.equal(placed.get('a')?.side, 'right')
    assert.notEqual(placed.get('b')?.side, 'right')
    assert.equal(placeLabels([b, a], bounds, gap).get('b')?.side, 'right')
  })

  it('puts each side at its documented offset, centred on the point', () => {
    const a = item('a', 200, 100)
    const wall = (id: string, x: number, y: number) => item(id, x, y, 40, 14, 5)
    const left = placeLabels([a, wall('r', 230, 100)], bounds, gap).get('a')!
    assert.deepEqual([left.side, left.anchor, left.x, left.y], ['left', 'end', 200 - 5 - gap, 100])
    const above = placeLabels([a, wall('r', 230, 100), wall('l', 170, 100)], bounds, gap).get('a')!
    assert.deepEqual([above.side, above.anchor, above.x, above.y], ['above', 'middle', 200, 100 - 5 - gap - 14 / 2])
    const below = placeLabels([a, wall('r', 230, 100), wall('l', 170, 100), wall('u', 200, 80)], bounds, gap).get('a')!
    assert.deepEqual([below.side, below.anchor, below.x, below.y], ['below', 'middle', 200, 100 + 5 + gap + 14 / 2])
  })

  it('never lets a label cover a point of a later item, and never returns an item it dropped', () => {
    const a = item('a', 100, 100, 60)
    const sitting = item('b', 100 + 5 + gap + 20, 100)
    const placed = placeLabels([a, sitting], bounds, gap)
    assert.notEqual(placed.get('a')?.side, 'right')
    assert.deepEqual([...placeLabels([item('tiny', 5, 5, 400, 14)], bounds, gap).keys()], [])
  })

  it('a label for a point at each corner stays inside the bounds', () => {
    const corners = [item('tl', 2, 2), item('tr', 398, 2), item('bl', 2, 198), item('br', 398, 198)]
    for (const [id, p] of placeLabels(corners, bounds, gap)) {
      const it = corners.find((c) => c.id === id)!
      const b = box(it, p)
      assert.ok(b.left >= 0 && b.right <= 400 && b.top >= 0 && b.bottom <= 200, id)
    }
  })

  it('flips left instead of leaving the bounds on the right edge', () => {
    const placed = placeLabels([item('a', 390, 100)], bounds, gap)
    assert.equal(placed.get('a')?.side, 'left')
  })

  it('returns equal maps for equal input', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`p${i}`, 30 + i * 28, 60 + (i % 3) * 30))
    assert.deepEqual([...placeLabels(items, bounds, gap)], [...placeLabels(items, bounds, gap)])
  })
})
