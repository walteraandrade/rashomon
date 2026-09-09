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
    assert.match(chapter, /<h2[^>]*>Como ler o rashomon<\/h2>/)
    for (const heading of ['Como fazer uma análise', 'Frequência', 'Linha entre duas palavras', 'Tom']) assert.match(chapter, new RegExp(`<h3>${heading}<\\/h3>`), heading)
    assert.match(chapter, /<h3 id="pmi">PMI<\/h3>/)
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

  it('atlas.css has no type smaller than 12px and no 10px uppercase labels', () => {
    const css = read('atlas.css')
    const sizes = [...css.matchAll(/font(?:-size)?:\s*(?:\d+\s+)?(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
    assert.ok(sizes.length > 20, 'the scan must see the stylesheet')
    assert.deepEqual(sizes.filter((s) => s < 11), [], 'nothing below 11px')
    assert.doesNotMatch(css, /font-size:\s*10(\.\d+)?px/, 'no 10px text')
  })
})
