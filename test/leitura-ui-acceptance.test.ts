import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FONT_DISPLAY, FONT_SANS } from '../public/js/layout.js'
import { SOURCE_SEGMENTS } from '../public/js/format.js'
import { VERCEL_INSIGHTS_TAG } from './pages.js'

// The "Leitura" redesign: one sentence of controls, the map as the figure, a "Como ler"
// chapter that defines PMI on the page itself, and one stylesheet shared by every page. These
// criteria read static markup only; behaviour still goes through the modules.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (name: string) => readFileSync(join(root, 'public', name), 'utf8')

describe('Leitura UI: the recorte is one sentence', () => {
  it('design-5.html holds the five controls inside the sentence, the source one as a select fed by SOURCE_SEGMENTS', () => {
    const html = read('design-5.html')
    const sentence = html.match(/<p class="sentence-line">([\s\S]*?)<\/p>/)?.[1] ?? ''
    for (const id of ['person', 'days', 'source', 'sort', 'limit']) assert.match(sentence, new RegExp(`<select id="${id}"`), `${id} must live in the sentence`)
    assert.doesNotMatch(html, /segSource|class="segbtn"/, 'the source pills are gone; boot() fills <select id="source"> from SOURCE_SEGMENTS')
    assert.ok(SOURCE_SEGMENTS.length >= 8, 'every source still has an option')
  })

  it('the old hero, stamp and method block are gone', () => {
    const html = read('design-5.html')
    for (const gone of ['class="intro"', 'id="stamp"', 'class="method"', 'id="chartTitle"', 'class="footer"']) assert.ok(!html.includes(gone), `${gone} must not survive the redesign`)
  })
})

describe('Leitura UI: the site explains itself on its own page', () => {
  it('como-ler.html carries the "Como ler" chapter that defines frequência, PMI, the weighted size, lines and tone', () => {
    const html = read('como-ler.html')
    const chapter = html.match(/<section class="chapter[^"]*" id="como-ler"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.ok(chapter, 'the chapter must exist with id="como-ler"')
    // The page title is the page's one <h1>, in the masthead above the chapter; inside it a
    // chapter is an <h2> and a topic of that chapter an <h3>. Before this, chapter and topic
    // were both <h3> and the outline said they were the same rank.
    assert.match(html, /<h1 id="comoLerTitle">Como ler o rashomon<\/h1>/)
    assert.equal(html.match(/<h1[\s>]/g)?.length, 1, 'exactly one h1 per page')
    for (const chapterTitle of ['Como fazer uma análise', 'Gráfico 1 · Atlas de palavras', 'PMI']) assert.match(chapter, new RegExp(`<h2>${chapterTitle}<\\/h2>`), chapterTitle)
    for (const topic of ['Frequência', 'Linha entre duas palavras', 'Tom']) assert.match(chapter, new RegExp(`<h3>${topic}<\\/h3>`), topic)
    assert.match(chapter, /<div id="pmi">\s*<h2>PMI<\/h2>/, 'PMI is a chapter of its own, not a topic inside avaliação')
    assert.match(chapter, /mais do que apareceria por acaso/, 'PMI must be defined in plain words')
    assert.match(chapter, /PMI × ln\(1 \+ documentos\)/, 'the weighted size must be spelled out')
    assert.match(chapter, /Só existe nos textos que vêm do GDELT/, 'tone stays a GDELT-only fact')
    assert.match(html, /<link rel="stylesheet" href="atlas\.css">/)
    assert.doesNotMatch(html, /<style[\s>]/i, 'the reading page is markup only')
    // Nothing but the platform analytics tag: no inline script, no module of our own.
    assert.doesNotMatch(html.replaceAll(VERCEL_INSIGHTS_TAG, ''), /<script/i, 'the reading page runs no JavaScript of its own')
  })

  it('design-5.html no longer carries the chapter and links to the page from the header and from each figure', () => {
    const html = read('design-5.html')
    assert.doesNotMatch(html, /id="como-ler"/)
    // Issue #91: compare.html is deleted, the third figure lives on this page instead, so the
    // nav link now points at an in-page anchor rather than a separate file (AC15).
    assert.match(html, /<a class="compare-link" href="#compare">comparar pessoas<\/a><a href="como-ler\.html">como ler<\/a>/, 'the header links to the page')
    assert.match(html, /href="como-ler\.html#atlas"/)
    assert.match(html, /href="como-ler\.html#avaliacao"/)
  })
})

describe('Leitura UI: one stylesheet, one type system', () => {
  it('atlas.css declares the two faces and layout.js measures text with the same families', () => {
    const css = read('atlas.css')
    assert.match(css, /--sans:\s*'Instrument Sans'/)
    assert.match(css, /--display:\s*'League Spartan'/)
    assert.ok(FONT_SANS.startsWith("'Instrument Sans'"), 'canvas measurement must use the face the map is painted with')
    assert.ok(FONT_DISPLAY.startsWith("'League Spartan'"), 'the centre name is measured with the display face')
    // compare.html is gone (issue #91): the ruler now lives on design-5.html, already in this
    // loop, so the deleted page's own slot is dropped rather than replaced.
    for (const page of ['design-5.html', 'como-ler.html']) assert.match(read(page), /fonts\.googleapis\.com\/css2\?family=League\+Spartan[^"]*Instrument\+Sans/, `${page} loads both faces`)
  })

  it('atlas.css sizes type from one --t-* ramp, and its floor is 11px', () => {
    const css = read('atlas.css')
    const ramp = [...css.matchAll(/--t-[a-z0-9]+:\s*([^;]+);/g)].map((m) => m[1])
    assert.ok(ramp.length >= 7, 'the ramp must exist and have real steps')
    // Every px in the ramp, fluid steps included: clamp(38px, 5.6vw, 68px) contributes 38 and 68.
    const rampPx = ramp.flatMap((v) => [...v.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])))
    assert.deepEqual(rampPx.filter((s) => s < 11), [], 'no step of the ramp goes under 11px')
    // A component sizes itself from the ramp. The only literals left are the ones that are not
    // type at all -- icon boxes and the like -- so a stray font-size in px is the thing to catch.
    const literals = [...css.matchAll(/font(?:-size)?:\s*(?:\d+\s+)?(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
    assert.deepEqual(literals, [], 'every font-size comes from the ramp')
    assert.ok(css.match(/font-size:\s*var\(--t-/g)!.length > 40, 'the ramp is what the components read')
  })
})
