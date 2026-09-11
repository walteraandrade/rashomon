import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FONT_DISPLAY, FONT_SANS } from '../src/ui/layout.js'
import { SOURCE_SEGMENTS } from '../src/ui/format.js'
import { VERCEL_INSIGHTS_TAG } from './pages.js'

// The "Leitura" redesign: one sentence of controls, the map as the figure, a "Como ler"
// chapter that defines PMI on the page itself, and one stylesheet shared by every page. These
// criteria read static markup only (design-5.html, como-ler.html, atlas.css); behaviour goes
// through the modules, in the per-module files.

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

  it('design-5.html no longer carries the chapter and keeps como-ler.html as the shareable copy', () => {
    const html = read('design-5.html')
    assert.doesNotMatch(html, /id="como-ler"/)
    // Issue #91: compare.html is deleted, the third figure lives on this page instead, so the
    // nav link now points at an in-page anchor rather than a separate file (AC15).
    assert.match(html, /<nav><a class="help-link" href="como-ler\.html">como ler<\/a><\/nav>/, 'the header still names the shareable guide')
    assert.match(html, /href="como-ler\.html#atlas"/)
    assert.match(html, /href="como-ler\.html#avaliacao"/)
    assert.match(html, /id="helpDialog"/, 'the atlas intercepts those links into an in-page dialog')
    for (const id of ['workspace', 'testimony', 'compare']) {
      const figure = html.match(new RegExp(`id="${id}"[\\s\\S]*?</section>`))?.[0] ?? ''
      assert.match(figure, /<dl class="figure-key">/, `${id} carries its own key`)
    }
  })

  it("figure 1's key on the page and in the dialog name the same encodings", () => {
    const html = read('design-5.html')
    const dts = (chunk: string) =>
      [...(chunk.match(/<dl class="figure-key">[\s\S]*?<\/dl>/)?.[0] ?? '').matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map((m) =>
        m[1].replace(/<[^>]+>/g, '').replace(/Aa/g, '').trim(),
      )
    const figure = html.match(/id="workspace"[\s\S]*?<\/section>/)?.[0] ?? ''
    const help = html.match(/id="help-atlas"[\s\S]*?(?=<div id="help-pmi")/)?.[0] ?? ''
    assert.deepEqual(dts(figure), ['Tamanho', 'Cor', 'Posição', 'Clique'])
    assert.deepEqual(dts(help), dts(figure))
  })

  it('the dialog and the shareable page keep the facts the figure itself cannot say', () => {
    const dialog = read('design-5.html').match(/id="helpDialog"[\s\S]*?<\/dialog>/)?.[0] ?? ''
    const page = read('como-ler.html')
    for (const [hay, label] of [
      [dialog, 'dialog'],
      [page, 'como-ler.html'],
    ] as const) {
      assert.match(hay, /expressão/i, `${label} names phrases`)
      assert.match(hay, /arrasta pelo topo/, `${label} names the floating docs card`)
      assert.match(hay, /no centro/i, `${label} names the atlas centre entry`)
      assert.match(hay, /primeira linha da lista/, `${label} names the list-head entry`)
      assert.match(hay, /não couberam/, `${label} names the ruler overflow list`)
      assert.match(hay, /não entra na régua/, `${label} names own-name words dropped from the ruler`)
    }
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

  it('the mask and ruler swatches use SCALE_MID, not --muted', () => {
    const css = read('atlas.css')
    assert.match(css, /--scale-mid:\s*#8b909c/)
    assert.match(css, /\.mask-scale \{[^}]*var\(--scale-mid\)/)
    assert.match(css, /\.key-pair \{[^}]*var\(--scale-mid\)/)
    assert.doesNotMatch(css, /\.top nav \.help-link \{[^}]*--accent/, '"como ler" in the nav is chrome, not a live control')
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

describe('the page is a sequence of graphs', () => {
  it('design-5.html carries three figures, each with a numbered eyebrow, a title and a subtitle, and no side column', () => {
    const html = read('design-5.html')
    const figures = [...html.matchAll(/<section class="figure[^"]*" id="([^"]+)"/g)].map((m) => m[1])
    // Issue #91 adds a third figure, the ruler comparing two people, after #testimony.
    assert.deepEqual(figures, ['workspace', 'testimony', 'compare'])
    // Issue #92 moved the stats badge into this heading (<b id="atlasStats">), next to
    // <b id="testimonyLabel"> in figure 2's own heading below.
    assert.match(html, /<span class="eyebrow">Gráfico 1<\/span><h2 id="atlasTitle">Atlas de palavras <b id="atlasStats"><\/b><\/h2>/)
    assert.match(html, /<span class="eyebrow">Gráfico 2<\/span><h2 id="testimonyTitle">Avaliação por veículo/)
    assert.match(html, /<span class="eyebrow">Gráfico 3<\/span><h2 id="compareTitle">/)
    assert.equal(html.match(/<p class="figure-sub">/g)?.length, 3)
    for (const id of ['workspace', 'testimony', 'compare']) {
      const figure = html.match(new RegExp(`id="${id}"[\\s\\S]*?</section>`))?.[0] ?? ''
      assert.match(figure, /<dl class="figure-key">/, `${id} carries its own key`)
    }
    assert.doesNotMatch(html, /class="side"/)
    // The atlas keeps its toolbar and its detail column inside its own figure.
    const atlas = html.match(/id="workspace"[\s\S]*?<\/section>/)?.[0] ?? ''
    for (const id of ['search', 'modeMap', 'mask', 'zoomIn', 'clear', 'viewport', 'legend', 'inspector']) assert.match(atlas, new RegExp(`id="${id}"`), `${id} belongs to the atlas figure`)
  })

  it('there is no page-wide outlet filter: no chip under the sentence, and each figure keeps its own controls', () => {
    const html = read('design-5.html')
    assert.doesNotMatch(html, /id="domainClear"/)
    assert.doesNotMatch(html, /id="domainChip"/)
    // Issue #92 gave figure 2 its own sentence (person/days/source, 3 controls) alongside
    // figure 1's original five; issue #91 adds figure 3's own six (compareA/B/days/source/
    // measure/limit), so the shared count is 14 now — split per figure below.
    assert.equal(html.match(/<span class="pick">/g)?.length, 14)
    const workspace = html.match(/id="workspace"[\s\S]*?<\/section>/)?.[0] ?? ''
    const testimony = html.match(/id="testimony"[\s\S]*?<\/section>/)?.[0] ?? ''
    const compare = html.match(/id="compare"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.equal(workspace.match(/<span class="pick">/g)?.length, 5, "figure 1's sentence keeps its five controls")
    assert.equal(testimony.match(/<span class="pick">/g)?.length, 3, "figure 2's own sentence has person/days/source, no sort/limit")
    assert.equal(compare.match(/<span class="pick">/g)?.length, 6, "figure 3's own sentence has both people, days, source, measure and limit")
  })
})

describe('issue #92 AC10/AC11: the sentence and the stats badge moved into each figure', () => {
  it('#stats no longer lives in header.top; #atlasStats lives in #workspace instead', () => {
    const html = read('design-5.html')
    const header = html.match(/<header class="top">[\s\S]*?<\/header>/)?.[0] ?? ''
    assert.doesNotMatch(header, /id="stats"/, 'header.top no longer describes the whole page with a number')
    const workspace = html.match(/id="workspace"[\s\S]*?<\/section>/)?.[0] ?? ''
    const figureTitle = workspace.match(/<div class="figure-title">[\s\S]*?<\/div>/)?.[0] ?? ''
    assert.match(figureTitle, /id="atlasStats"/, '#atlasStats belongs to #workspace\'s own figure-title now')
  })

  it('there is no top-level <section class="sentence">', () => {
    assert.doesNotMatch(read('design-5.html'), /<section class="sentence"/, 'the sentence moved inside each figure\'s own figure-head')
  })

  it("#workspace's figure-head carries its own sentence-line with person/days/source/sort/limit", () => {
    const workspace = read('design-5.html').match(/id="workspace"[\s\S]*?<\/section>/)?.[0] ?? ''
    const head = workspace.match(/<header class="figure-head">[\s\S]*?<\/header>/)?.[0] ?? ''
    const sentence = head.match(/class="sentence-line">[\s\S]*?<\/p>/)?.[0] ?? ''
    for (const id of ['person', 'days', 'source', 'sort', 'limit']) assert.match(sentence, new RegExp(`id="${id}"`), `#${id} must sit inside #workspace's own sentence-line`)
  })

  it("#testimony's figure-head carries its own sentence-line with testimonyPerson/testimonyDays/testimonySource", () => {
    const testimony = read('design-5.html').match(/id="testimony"[\s\S]*?<\/section>/)?.[0] ?? ''
    const head = testimony.match(/<header class="figure-head">[\s\S]*?<\/header>/)?.[0] ?? ''
    const sentence = head.match(/class="sentence-line">[\s\S]*?<\/p>/)?.[0] ?? ''
    for (const id of ['testimonyPerson', 'testimonyDays', 'testimonySource']) assert.match(sentence, new RegExp(`id="${id}"`), `#${id} must sit inside #testimony's own sentence-line`)
  })
})

describe('every page finds what it names', () => {
  it('every relative href and src in a served page resolves to a file under public/', () => {
    for (const page of readdirSync(join(root, 'public')).filter((f) => f.endsWith('.html'))) {
      const html = readFileSync(join(root, 'public', page), 'utf8')
      const hrefs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
      const local = hrefs.filter((h) => !/^(https?:)?\/\/|^#|^mailto:|^\/_vercel\//.test(h))
      for (const href of local) {
        const rel = href.split(/[?#]/)[0].replace(/^\//, '')
        if (!rel) continue
        assert.ok(existsSync(join(root, 'public', rel)), `public/${page} links to ${href}, which does not exist under public/`)
      }
    }
  })

  it('atlas.css keeps the sentence controls and the mode segment usable on mobile widths (issue #28)', () => {
    const css = read('atlas.css')
    assert.match(css, /\.pick select\s*\{[^}]*max-width:\s*100%;/, 'every select in the sentence must shrink to the screen')
    assert.match(css, /\.segment\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/)
  })

  it('the workspace carries an id so a reload can dim it in place instead of blanking the map', () => {
    assert.match(read('design-5.html'), /<section class="figure workspace" id="workspace"/)
    assert.match(read('atlas.css'), /\.workspace\.is-loading \.viewport[^{]*\{[^}]*opacity/)
  })

  it('the como-ler page explains the centring of the mask', () => {
    const chapter = read('como-ler.html').match(/<section class="chapter[^"]*" id="como-ler"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.match(chapter, /<b>Colorir por avaliação<\/b>/)
    assert.match(chapter, /com a média da pessoa no recorte, e não com o zero/)
    assert.match(chapter, /menos de 3 textos avaliados/)
  })
})
