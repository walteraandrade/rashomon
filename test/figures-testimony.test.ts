import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pageMarkup, siteFile } from './pages.js'
import './close.js'

// Figure 2 is a component now (test/components/Testimony.spec.ts owns behaviour); this file keeps
// what the page and the reading guide say about it.

const read = (name: string) => siteFile(name)
const figureOf = (html: string) => html.match(/<section class="figure testimony" id="testimony"([\s\S]*?)<\/section>/)?.[1] ?? ''

describe('the page holds the figure and explains it', () => {
  it('the atlas page gives the avaliação its own figure: title with the score, the strip, then the lists', () => {
    const html = pageMarkup('/')
    const figure = figureOf(html)
    assert.ok(figure, 'the second figure must exist')
    assert.match(figure, /<h2 id="testimonyTitle">Avaliação por veículo <b id="testimonyLabel">/)
    assert.match(figure, /<figure class="strip"[^>]* id="strip"[^>]*>/)
    assert.match(figure, /<div class="testimony-lists"[^>]* id="testimonyList"[^>]*>/)
    assert.ok(figure.indexOf('id="strip"') < figure.indexOf('id="testimonyList"'), 'the chart comes before its lists')
    assert.ok(figure.indexOf('id="testimonyList"') < figure.indexOf('id="outlets"'), 'the outlet list closes the figure')
    assert.ok(html.indexOf('id="workspace"') < html.indexOf('id="testimony"'), 'after the atlas figure')
  })

  it('the "Como ler" page defines the scale, the cut and the name bias', () => {
    const chapter = read('como-ler.html').match(/<section class="chapter[^"]*" id="como-ler"[\s\S]*?<\/section>/)?.[0] ?? ''
    const help = read('atlas.html').match(/id="help-avaliacao"[\s\S]*?(?=<div id="help-comparar")/)?.[0] ?? ''
    assert.ok(help, 'the in-page guide must carry the avaliação section')
    assert.match(chapter, /<h2>Gráfico 2 · Avaliação por veículo<\/h2>/)
    assert.match(chapter, /A nota não é de um jornalista nem do GDELT/)
    assert.match(chapter, /modelo treinado só para isso, o <a href="https:\/\/huggingface\.co\/drifting-walter\/kikori" target="_blank" rel="noopener">kikori<\/a>/)
    assert.match(help, /A nota não é de um jornalista nem do GDELT/)
    assert.match(help, /modelo treinado só para isso, o <a href="https:\/\/huggingface\.co\/drifting-walter\/kikori" target="_blank" rel="noopener">kikori<\/a>/)
    assert.match(chapter, /contra \(−10\) ou a favor \(\+10\)/)
    assert.match(chapter, /Até −2,5 conta como contra; de \+2,5 para cima, a favor/)
    assert.match(chapter, /nunca compare a nota de uma pessoa com a de outra/)
    assert.match(chapter, /Vale para todas as fontes, ao contrário do tom/)
  })

  it("como-ler's #avaliacao section states both outlet-grouping caveats (AC14)", () => {
    const section = read('como-ler.html').match(/<div id="avaliacao">[\s\S]*?(?=\n\s*<div id="pmi">)/)?.[0] ?? ''
    assert.ok(section, 'the #avaliacao section must exist')
    assert.match(section, /vocabulário parecido[\s\S]{0,120}(não é a mesma coisa que|não é) linha editorial/i, 'shared vocabulary is not editorial lean')
    assert.match(section, /número de cada grupo não significa nada[\s\S]{0,120}(entre|comparad)/i, "a field's number carries no meaning across rebuilds")
  })

  it('atlas.css styles the panel from the type ramp, never from a loose px', () => {
    const css = read('atlas.css')
    assert.match(css, /\.testimony \.verdict dd \{[^}]*var\(--tone, var\(--ink\)\)/)
    assert.match(css, /\.strip-mean \{[^}]*var\(--pos/, 'the strip is the one ruler left, and it still places the mean')
    assert.doesNotMatch(css, /\.testimony \.scale/, 'the second ruler under the strip is gone')
    const sizes = [...css.matchAll(/\.testimony[^{]*\{[^}]*font-size:\s*var\((--t-[a-z0-9]+)\)/g)].map((m) => m[1])
    assert.ok(sizes.length >= 3, 'the panel sizes itself from the ramp')
    assert.deepEqual(sizes.filter((s) => s === '--t-micro'), [], 'the 11px floor is for SVG labels only')
  })

  it('the strip is the chart of the second figure, and the como-ler page explains it', () => {
    const figure = figureOf(pageMarkup('/'))
    assert.match(figure, /<\/header>\s*<figure class="strip"[^>]* id="strip" aria-label="Veículos na régua da avaliação"/)
    const chapter = read('como-ler.html').match(/<section class="chapter[^"]*" id="como-ler"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.match(chapter, /<b>A régua<\/b>/)
    assert.match(chapter, /a linha vertical é a média da pessoa/)
  })

  it('the figure is one column, with no second ruler and no second outlet ranking', () => {
    const figure = figureOf(pageMarkup('/'))
    assert.ok(figure, 'the second figure must exist')
    assert.doesNotMatch(figure, /figure-lists/, 'the two-column grid left half the width empty')
    assert.doesNotMatch(figure, /<details/, 'the one outlet list is the figure, not a disclosure beside it')
    assert.ok(figure.indexOf('id="testimonyList"') < figure.indexOf('id="outletList"'), 'the summary comes before the list')
  })
})
