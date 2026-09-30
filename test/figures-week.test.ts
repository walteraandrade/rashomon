import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { weekParams } from '../src/ui/api.js'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pageMarkup } from './pages.js'

const built = join(dirname(dirname(fileURLToPath(import.meta.url))), 'build', 'index.html')

// Figure 5 is src/ui/Week.svelte (issue #291); its behaviour is in test/components/Week.spec.ts.
// Here: the request builder and the prerendered markup hooks.

describe('weekParams stays fixed at days=7', () => {
  it('sends days=7, the full kind set, plus the chosen source and limit', () => {
    const qp = weekParams({ source: 'gdelt', limit: '5' })
    assert.equal(qp.get('days'), '7')
    assert.equal(qp.get('kind'), 'word,hashtag,phrase')
    assert.equal(qp.get('source'), 'gdelt')
    assert.equal(qp.get('limit'), '5')
  })
})

describe('the page carries the fifth figure card', () => {
  it('a <section class="figure week ..." id="week"> exists after #rising, with eyebrow "Gráfico 5" and only person/source/limit in its sentence', () => {
    const html = pageMarkup('/')
    const risingIdx = html.indexOf('id="rising"')
    const weekIdx = html.indexOf('id="week"')
    assert.ok(risingIdx !== -1 && weekIdx !== -1)
    assert.ok(risingIdx < weekIdx, '#week must come after #rising')
    assert.match(html, /<section class="figure[^"]*week[^"]*"[^>]*id="week"|<section[^>]*id="week"/)
    assert.match(html, /<span class="eyebrow">Gráfico 5<\/span>/)
    const week = html.match(/id="week"[\s\S]*?<\/section>/)?.[0] ?? ''
    const sentence = week.match(/class="sentence-line">[\s\S]*?<\/p>/)?.[0] ?? ''
    for (const id of ['weekPerson', 'weekSource', 'weekLimit']) assert.match(sentence, new RegExp(`id="${id}"`))
    assert.doesNotMatch(sentence, /id="weekDays"/)
    for (const id of ['weekChart', 'weekNote']) assert.match(week, new RegExp(`id="${id}"`))
  })
})

describe('the prerendered page keeps the week section hooks', { skip: existsSync(built) ? false : 'run pnpm build first' }, () => {
  it('carries the section, its three selects, the chart and the note, with no days control', () => {
    const html = readFileSync(built, 'utf8')
    const week = html.match(/<section class="figure week[^"]*"[^>]*id="week"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.ok(week, 'the prerendered #week section')
    assert.match(week, /aria-labelledby="weekTitle"/)
    assert.match(week, /<span class="eyebrow">Gráfico 5<\/span><h2 id="weekTitle">A semana<\/h2>/)
    for (const id of ['weekPerson', 'weekSource', 'weekLimit', 'weekChart', 'weekNote']) assert.match(week, new RegExp(`id="${id}"`))
    assert.match(week, /class="week-chart"/)
    assert.match(week, /<dt>Posição<\/dt><dd>só o dia; a altura na coluna não mede nada<\/dd>/)
    assert.doesNotMatch(week, /id="weekDays"|\{@html/)
  })
})
