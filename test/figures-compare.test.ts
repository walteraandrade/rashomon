import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from '../src/server.js'
import { seed } from './fixture.js'
import { compareParams } from '../src/ui/api.js'
import './close.js'
import { pageMarkup } from './pages.js'

// Figure 3 (issues #91, #93, #99, #293): its behaviour is test/components/compare.spec.ts. What
// stays here needs no component: the route the figure calls and the markup and CSS the page ships.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const design5 = () => pageMarkup('/')
const comoLer = () => pageMarkup('/como-ler')

describe('compareParams matches calling /api/compare directly', () => {
  it('produces the same body as calling /api/compare with kind=word,hashtag,phrase and no domain/lean', async () => {
    await seed()
    for (const [qp, direct] of [
      [compareParams({ a: 'lula', b: 'bolsonaro', days: '30', source: 'all', limit: '40' }), '/api/compare?a=lula&b=bolsonaro&days=30&source=all&limit=40&kind=word,hashtag,phrase'],
      [compareParams({ a: 'tarcisio', b: 'bolsonaro', days: '60', source: 'gdelt', limit: '20' }), '/api/compare?a=tarcisio&b=bolsonaro&days=60&source=gdelt&limit=20&kind=word,hashtag,phrase'],
    ] as const) {
      const viaHelper = await app.request('/api/compare?' + qp.toString())
      const viaDirect = await app.request(direct)
      assert.equal(viaHelper.status, 200)
      assert.deepEqual(await viaHelper.json(), await viaDirect.json())
    }
  })
})

describe('atlas.html carries the third figure card', () => {
  it('a <section class="figure ..." id="compare"> exists after #testimony, with eyebrow "Gráfico 3" and the six sentence controls', () => {
    const html = design5()
    const testimonyIdx = html.indexOf('id="testimony"')
    const compareIdx = html.indexOf('id="compare"')
    assert.ok(testimonyIdx !== -1 && compareIdx !== -1)
    assert.ok(testimonyIdx < compareIdx, '#compare must come after #testimony')
    assert.match(html, /<section class="figure[^"]*" id="compare"/)
    assert.match(html, /<span class="eyebrow">Gráfico 3<\/span>/)
    const compare = html.match(/id="compare"[\s\S]*?<\/section>/)?.[0] ?? ''
    const sentence = compare.match(/class="sentence-line">[\s\S]*?<\/p>/)?.[0] ?? ''
    for (const id of ['compareA', 'compareB', 'compareDays', 'compareSource', 'compareMeasure', 'compareLimit']) assert.match(sentence, new RegExp(`id="${id}"`), `#${id} must live in the ruler's own sentence`)
  })
})

describe('public/compare.html no longer exists', () => {
  it('the file is gone from the repository', () => {
    assert.ok(!existsSync(join(root, 'public', 'compare.html')))
  })

  it('GET /compare.html 404s', async () => {
    const res = await app.request('/compare.html')
    assert.equal(res.status, 404)
  })
})

// AC15 said the header nav link had to point at the in-page anchor with the same label. The
// link is gone instead: it pointed at an anchor on the page it was already on, which is the one
// link a page cannot usefully carry, and the ruler is the third figure down the same scroll.
describe('the header carries no in-page link to the ruler', () => {
  it('neither page names it', () => {
    assert.doesNotMatch(design5(), /compare-link|comparar pessoas/)
    assert.doesNotMatch(comoLer(), /compare-link|comparar pessoas/)
  })
})

const sectionOf = (html: string, id: string) => html.match(new RegExp(`<div id="${id}">[\\s\\S]*?</div>`))?.[0] ?? ''

// Criterion 17: the facts the butterfly cannot say by itself live in the reading page and in the
// in-page dialog, which carry the same copy.
describe('the guide explains the butterfly under #comparar and #help-comparar', () => {
  const dialog = () => pageMarkup('/').match(/<div id="help-comparar">[\s\S]*?<\/div>/)?.[0] ?? ''
  const sections = (): [string, string][] => [
    ['como-ler #comparar', sectionOf(comoLer(), 'comparar')],
    ['dialog #help-comparar', dialog()],
  ]

  it('both sections exist and carry the anchor the figure links to', () => {
    assert.match(comoLer(), /id="comparar"/)
    for (const [label, text] of sections()) assert.ok(text, `${label} must exist`)
  })

  it('both state that a bar is a share of that person\'s documents, on one scale for both people', () => {
    for (const [label, text] of sections()) {
      assert.match(text, /fatia dos documentos/, label)
      assert.match(text, /mesma escala para as duas/, label)
    }
  })

  it('both name the three groups and what "só" means', () => {
    for (const [label, text] of sections()) {
      assert.match(text, /só da primeira pessoa, dos dois e só da segunda/, label)
      assert.match(text, /barra desta pessoa existe e a da outra não/, label)
    }
  })

  it('both say the measure choice changes only which words get a row, and that each person contributes their top words', () => {
    for (const [label, text] of sections()) {
      assert.match(text, /“Documentos” ou “PMI ponderado”[\s\S]{0,80}só quais palavras ganham uma linha, nunca o comprimento de uma barra/, label)
      assert.match(text, /até o dobro de linhas/, label)
    }
  })

  it('both say a missing bar can mean below the kept threshold, not zero', () => {
    for (const [label, text] of sections()) assert.match(text, /abaixo do que a construção pré-computada deste recorte guardou, não que a contagem é zero/, label)
  })

  it('both say the own-name words are left out and counted', () => {
    for (const [label, text] of sections()) {
      assert.match(text, /nome de uma das duas pessoas não é desenhado/, label)
      assert.match(text, /quantas palavras saíram aparece embaixo/, label)
    }
  })

  it('both describe the bridge as a mark before the word; #ponte keeps its computation', () => {
    for (const [label, text] of sections()) {
      assert.match(text, /marca âmbar antes da palavra/, label)
      assert.match(text, /A ponte não muda nem a escolha nem a ordem das linhas/, label)
    }
    const page = sectionOf(comoLer(), 'comparar')
    assert.match(page, /<h3 id="ponte">Ponte<\/h3>/)
    assert.match(page, /centralidade de intermediação/)
  })

  it('neither describes a position axis, a letter size, an overflow list or a PMI clamp for this figure', () => {
    for (const [label, text] of sections()) {
      assert.doesNotMatch(text, /posição|tamanho da letra|régua|lista abaixo|não couberam|sublinhad|PMI negativo/i, label)
    }
  })

  it('no sentence in the guide refers to the compare figure as "gráfico 3" or its bridge as "sublinhado âmbar" (titles keep the number)', () => {
    const paragraphs = (html: string) => [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1])
    const compareParagraphs = [...sections().flatMap(([, text]) => paragraphs(text)), ...paragraphs(pageMarkup('/')).filter((p) => /gráfico 3/i.test(p)), ...paragraphs(comoLer()).filter((p) => /gráfico 3/i.test(p))]
    for (const p of compareParagraphs) assert.doesNotMatch(p, /gráfico 3|sublinhado âmbar/i, p)
    const figureKey = pageMarkup('/').match(/id="compare"[\s\S]*?<\/dl>/)?.[0] ?? ''
    assert.doesNotMatch(figureKey, /gráfico 3(?!<\/span>)|sublinhado âmbar/i)
    assert.match(figureKey, /butterfly-bridge-mark/)
  })

  it('the lenses sections point at the compare figure\'s bridge mark by section', () => {
    const page = sectionOf(comoLer(), 'lentes')
    assert.match(page, /marca de ponte da comparação entre duas pessoas/)
    assert.match(page, /<a href="#ponte">Ponte<\/a>/)
    const help = pageMarkup('/').match(/<div id="help-lentes">[\s\S]*?<\/div>/)?.[0] ?? ''
    assert.match(help, /marca de ponte da comparação entre duas pessoas/)
  })
})

describe('the #compare figure head describes the butterfly', () => {
  const figure = () => design5().match(/id="compare"[\s\S]*?<\/section>/)?.[0] ?? ''
  const dts = () => [...(figure().match(/<dl class="figure-key"[^>]*>[\s\S]*?<\/dl>/)?.[0] ?? '').matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim())

  it('titles the figure and keeps the eyebrow', () => {
    assert.match(figure(), /<h2 id="compareTitle">Duas pessoas, palavra a palavra<\/h2>/)
    assert.match(figure(), /<span class="eyebrow">Gráfico 3<\/span>/)
  })

  it('says a bar is a share of each person\'s texts and links the guide', () => {
    assert.match(figure(), /<p class="figure-sub">Cada barra é a fatia dos textos de cada pessoa que traz a palavra\. <a href="\/como-ler#comparar">Como ler<\/a>\.<\/p>/)
  })

  it('keys Barra, Cor, Ponte and Clique, with no Tamanho or Posição, and a bridge mark on Ponte', () => {
    assert.deepEqual(dts(), ['Barra', 'Cor', 'Ponte', 'Clique'])
    assert.match(figure(), /<span class="butterfly-bridge-mark"[^>]*><\/span>Ponte/)
    assert.match(figure(), /key-pair/)
  })

  it('keeps the measure select with its two options and aria-label', () => {
    const select = figure().match(/<select id="compareMeasure"[\s\S]*?<\/select>/)?.[0] ?? ''
    assert.match(select, /aria-label="Medida"/)
    assert.equal(select.match(/<option/g)?.length, 2)
    assert.match(select, /value="count"/)
    assert.match(select, /value="pmi"/)
  })

  it('holds the container as a figure for the butterfly, not the ruler', () => {
    const tag = figure().match(/<figure[^>]*id="compareRuler"[^>]*>/)?.[0] ?? ''
    assert.ok(tag, '#compareRuler is a <figure>')
    assert.match(tag, /class="butterfly"/)
    assert.doesNotMatch(tag, /\bruler\b/)
  })
})

describe('atlas.css styles the butterfly rows', () => {
  const css = () => readFileSync(join(root, 'public', 'atlas.css'), 'utf8')

  it('carries the row, bar, count and bridge-mark rules', () => {
    for (const rule of [/\.butterfly-row \{/, /\.butterfly-bar \{[^}]*calc\(var\(--bar\)/, /\.butterfly-count \{[^}]*font-family:\s*var\(--mono\)/, /\.butterfly-bridge-mark \{[^}]*background:\s*var\(--accent\)/, /\.butterfly-axis-label\.cmp-a \{[^}]*var\(--cmp-a\)/, /\.butterfly-axis-label\.cmp-b \{[^}]*var\(--cmp-b\)/])
      assert.match(css(), rule)
  })

  it('tints the bars with their own side hue and the selected row with both, never --accent', () => {
    assert.match(css(), /\.butterfly-bar\.cmp-a \{[^}]*var\(--cmp-a\)/)
    assert.match(css(), /\.butterfly-bar\.cmp-b \{[^}]*var\(--cmp-b\)/)
    const selected = css().match(/\.butterfly-row\.is-selected \{[^}]*\}/)?.[0] ?? ''
    assert.match(selected, /background:[^;}]*color-mix\([^;}]*var\(--cmp-a\)[^;}]*var\(--cmp-b\)/)
    assert.doesNotMatch(selected, /--accent/)
  })

  it('never underlines the bridge and stacks the row under 520px', () => {
    assert.doesNotMatch(css().match(/\.butterfly-[\w-]*bridge[^{]*\{[^}]*\}/g)?.join('') ?? '', /text-decoration/)
    const narrow = css().match(/@media \(max-width: 519px\) \{[\s\S]*?\n\}/g)?.find((m) => /\.butterfly-row/.test(m)) ?? ''
    assert.ok(narrow, 'a max-width: 519px block must restyle .butterfly-row')
  })

  it('extends the loading dim to the butterfly and keeps the ruler selectors for the other figures', () => {
    assert.match(css(), /\.compare \.butterfly[^{]*\{[^}]*transition:\s*opacity/)
    assert.match(css(), /\.figure\.is-loading \.butterfly/)
    assert.match(css(), /\.rising \.ruler/)
    assert.match(css(), /\.lenses \.ruler/)
  })
})

describe('atlas.css styles words, not dots (issue #99 AC7)', () => {
  it('carries the ruler word rules Rising and Lenses still use and no longer carries the dot rules', () => {
    const css = readFileSync(join(root, 'public', 'atlas.css'), 'utf8')
    assert.match(css, /\.ruler-text \{/)
    // Neither the cursor nor the pick repaints the word: the box behind it carries both, in the
    // word's own side colour, at two strengths. A selected word painted --accent threw away the
    // side it leans to, which is the only thing this figure draws.
    assert.match(css, /\.ruler-text \{[^}]*fill:\s*var\(--wc\)/)
    assert.match(css, /\.ruler-word\.is-selected \.ruler-hit \{[^}]*var\(--wc-soft\)/)
    // No outline on a mark, anywhere: this site draws no borders, so hover and pick are a wash
    // the word sits on, at two strengths, never a box drawn around it.
    for (const rule of css.match(/\.(?:ruler-hit|ruler-glow|atlas-hit|atlas-glow|center-hit|dot-halo)[^{]*\{[^}]*\}/g) ?? []) assert.doesNotMatch(rule, /stroke/, rule)
    // Core plus penumbra: one uniformly blurred rectangle is fog, and fog has no edge to read.
    assert.match(css, /\.atlas-glow, \.ruler-glow \{[^}]*blur\((\d+)px\)/)
    assert.match(css, /\.atlas-hit, \.ruler-hit \{[^}]*blur\((\d+)px\)/)
    assert.doesNotMatch(css, /\.ruler-word:hover \.ruler-text/, 'the cursor must not repaint the word')
    assert.doesNotMatch(css, /\.ruler-word\.is-selected \{[^}]*--wc:\s*var\(--accent\)/, 'nor must the pick')
    assert.match(css, /\.ruler-overflow \{/)
    assert.doesNotMatch(css, /\.ruler-dot/, 'nothing draws a ruler dot any more')
  })
})

describe('figure 3 as a Svelte component (#293)', () => {
  it('the page renders Compare.svelte and still ships every id and hook figure 3 had', () => {
    const html = design5()
    for (const id of ['compareTitle', 'compareA', 'compareB', 'compareDays', 'compareSource', 'compareMeasure', 'compareLimit', 'compareStatus', 'compareRuler', 'compareDetail', 'compareHiddenNote'])
      assert.match(html, new RegExp(`id="${id}"`), `#${id}`)
    assert.ok(existsSync(join(root, 'src', 'ui', 'Compare.svelte')))
    assert.ok(existsSync(join(root, 'src', 'ui', 'Butterfly.svelte')))
    assert.ok(existsSync(join(root, 'src', 'ui', 'Ruler.svelte')), 'Rising and Lenses still draw a ruler')
  })
})
