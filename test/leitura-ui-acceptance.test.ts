import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FONT_DISPLAY, FONT_SANS } from '../public/js/layout.js'
import { SOURCE_SEGMENTS } from '../public/js/format.js'

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

describe('Leitura UI: the page explains itself', () => {
  it('design-5.html carries a "Como ler" chapter that defines frequência, PMI, the weighted size, lines and tone', () => {
    const html = read('design-5.html')
    const chapter = html.match(/<section class="chapter" id="como-ler"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.ok(chapter, 'the chapter must exist with id="como-ler"')
    assert.match(chapter, /<h2[^>]*>Como ler este atlas<\/h2>/)
    for (const heading of ['Como fazer uma análise', 'Frequência', 'PMI', 'Linha entre duas palavras', 'Tom']) assert.match(chapter, new RegExp(`<h3>${heading}<\\/h3>`), heading)
    assert.match(chapter, /mais do que apareceria por acaso/, 'PMI must be defined in plain words')
    assert.match(chapter, /PMI × ln\(1 \+ documentos\)/, 'the weighted size must be spelled out')
    assert.match(chapter, /Só existe nos textos que vêm do GDELT/, 'tone stays a GDELT-only fact')
    assert.match(html, /<a class="compare-link" href="compare\.html">comparar pessoas<\/a><a href="#como-ler">como ler<\/a>/, 'the header links to the chapter')
  })
})

describe('Leitura UI: one stylesheet, one type system', () => {
  it('compare.html links the shared atlas.css and carries no <style> block of its own', () => {
    const html = read('compare.html')
    assert.match(html, /<link rel="stylesheet" href="atlas\.css">/)
    assert.doesNotMatch(html, /<style[\s>]/i)
    assert.deepEqual([...html.matchAll(/style="([^"]*)"/g)], [], 'no inline style= on the compare page either')
  })

  it('atlas.css declares the two faces and layout.js measures text with the same families', () => {
    const css = read('atlas.css')
    assert.match(css, /--sans:\s*'Instrument Sans'/)
    assert.match(css, /--display:\s*'League Spartan'/)
    assert.ok(FONT_SANS.startsWith("'Instrument Sans'"), 'canvas measurement must use the face the map is painted with')
    assert.ok(FONT_DISPLAY.startsWith("'League Spartan'"), 'the centre name is measured with the display face')
    for (const page of ['design-5.html', 'compare.html']) assert.match(read(page), /fonts\.googleapis\.com\/css2\?family=League\+Spartan[^"]*Instrument\+Sans/, `${page} loads both faces`)
  })

  it('atlas.css has no type smaller than 12px and no 10px uppercase labels', () => {
    const css = read('atlas.css')
    const sizes = [...css.matchAll(/font(?:-size)?:\s*(?:\d+\s+)?(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
    assert.ok(sizes.length > 20, 'the scan must see the stylesheet')
    assert.deepEqual(sizes.filter((s) => s < 11), [], 'nothing below 11px')
    assert.doesNotMatch(css, /font-size:\s*10(\.\d+)?px/, 'no 10px text')
  })
})
