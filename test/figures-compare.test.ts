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

// Figure 3 (issues #91, #93, #99, #293, #326): its behaviour is test/components/compare.spec.ts.
// What stays here needs no component: the route the figure calls and the markup and CSS the page ships.

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
  it('a <section class="figure ..." id="compare"> exists after #testimony, with eyebrow "Gráfico 3" and the sentence controls of both modes', () => {
    const html = design5()
    const testimonyIdx = html.indexOf('id="testimony"')
    const compareIdx = html.indexOf('id="compare"')
    assert.ok(testimonyIdx !== -1 && compareIdx !== -1)
    assert.ok(testimonyIdx < compareIdx, '#compare must come after #testimony')
    assert.match(html, /<section class="figure[^"]*" id="compare"/)
    assert.match(html, /<span class="eyebrow">Gráfico 3<\/span>/)
    const compare = html.match(/id="compare"[\s\S]*?<\/section>/)?.[0] ?? ''
    const sentence = compare.match(/class="sentence-line">[\s\S]*?<\/p>/)?.[0] ?? ''
    for (const id of ['compareMode', 'compareA', 'compareB', 'compareDays', 'compareSource', 'compareMeasure', 'compareLimit', 'comparePerson', 'compareLensA', 'compareLensB'])
      assert.match(sentence, new RegExp(`id="${id}"`), `#${id} must live in the figure's own sentence`)
    assert.match(compare, /<h2 id="compareTitle">Duas pessoas ou dois recortes<\/h2>/)
  })

  it('the key lists Barra, Cor, Ponte and Clique once, and the subtitle names both readings and links the guide (#326 AC23)', () => {
    const compare = design5().match(/id="compare"[\s\S]*?<\/section>/)?.[0] ?? ''
    const key = compare.match(/<dl class="figure-key"[^>]*>[\s\S]*?<\/dl>/)?.[0] ?? ''
    assert.deepEqual([...key.matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()), ['Barra', 'Cor', 'Ponte', 'Clique'])
    const sub = compare.match(/<p class="figure-sub">[\s\S]*?<\/p>/)?.[0] ?? ''
    assert.match(sub, /Duas pessoas/)
    assert.match(sub, /uma pessoa lida por dois recortes/)
    assert.match(sub, /href="\/como-ler#comparar"/)
  })

  it('both sentence variants ship in the markup, each under a wrapper that hides it in the other mode, and the lens selects are hidden behind comboboxes', () => {
    const compare = design5().match(/id="compare"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.match(compare, /<span hidden=\{mode !== 'recortes'\}>[^]*?id="comparePerson"/)
    assert.match(compare, /<span hidden=\{mode !== 'pessoas'\}>[^]*?id="compareA"/)
    assert.match(compare, /<select id="compareLensA"[^>]*hidden/)
    for (const id of ['compareThinNote']) assert.match(compare, new RegExp(`id="${id}"`), id)
    // The comboboxes' ids are props of the component and the outlets' ids are snippet arguments.
    for (const id of ['compareLensAInput', 'compareLensAList', 'compareLensBInput', 'compareLensBList']) assert.match(compare, new RegExp(`(inputId|listId)="${id}"`), id)
    for (const id of ['compareLensAOutlets', 'compareLensBOutlets']) assert.match(compare, new RegExp(`@render groups\\('${id}'\\)`), id)
    assert.match(compare, /<select id="compareMode"[^>]*>\s*<option value="pessoas">duas pessoas<\/option><option value="recortes">uma pessoa, dois recortes<\/option>/)
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

// The whole <div id="..."> including nested divs, which the lazy sectionOf stops short of.
const balanced = (html: string, id: string) => {
  const start = html.indexOf(`<div id="${id}"`)
  if (start < 0) return ''
  let depth = 0
  for (const m of html.slice(start).matchAll(/<div\b|<\/div>/g)) {
    depth += m[0] === '</div>' ? -1 : 1
    if (depth === 0) return html.slice(start, start + m.index! + m[0].length)
  }
  return ''
}

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

  it('does not claim a bar comes out smaller than the real one', () => {
    for (const [label, text] of sections()) assert.doesNotMatch(text, /um pouco menor/, label)
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

  it('the lens block sits inside the compare section and points at its bridge explanation', () => {
    const lentes = balanced(comoLer(), 'lentes')
    assert.ok(lentes, 'como-ler must carry <div id="lentes">')
    assert.match(balanced(comoLer(), 'comparar'), /id="lentes"/, '#lentes is nested inside #comparar')
    assert.match(lentes, /<a href="#ponte">/)
    const help = balanced(pageMarkup('/'), 'help-lentes')
    assert.match(help, /ponte da comparação entre duas pessoas/)
    assert.match(balanced(pageMarkup('/'), 'help-comparar'), /id="help-lentes"/, 'help-lentes is nested inside help-comparar')
  })
})

describe('the #compare figure head describes the butterfly', () => {
  const figure = () => design5().match(/id="compare"[\s\S]*?<\/section>/)?.[0] ?? ''
  const dts = () => [...(figure().match(/<dl class="figure-key"[^>]*>[\s\S]*?<\/dl>/)?.[0] ?? '').matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim())

  it('titles the figure and keeps the eyebrow', () => {
    assert.match(figure(), /<h2 id="compareTitle">Duas pessoas ou dois recortes<\/h2>/)
    assert.match(figure(), /<span class="eyebrow">Gráfico 3<\/span>/)
  })

  it('names both readings, two people and one person by two recortes, and links the guide', () => {
    assert.match(figure(), /<p class="figure-sub">Duas pessoas lidas pelas mesmas palavras, ou uma pessoa lida por dois recortes: um veículo, um viés ou uma fonte\. <a href="\/como-ler#comparar">Como ler<\/a>\.<\/p>/)
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

  it('extends the loading dim to the butterfly and the dumbbell', () => {
    assert.match(css(), /\.compare \.butterfly[^{]*\{[^}]*transition:\s*opacity/)
    assert.match(css(), /\.figure\.is-loading \.butterfly/)
    assert.match(css(), /\.rising \.dumbbell/)
    assert.doesNotMatch(css(), /\.lenses\b/, 'the lenses figure is gone (issue #326)')
  })
})

describe('atlas.css styles the dot halo and the dumbbell, and carries no ruler rule (issue #99 AC7, #327)', () => {
  const css = () => readFileSync(join(root, 'public', 'atlas.css'), 'utf8')

  it('keeps the dot halo blurred and strokeless, and the radial wash rules are gone', () => {
    const rules = css().match(/\.dot-halo[^{]*\{[^}]*\}/g) ?? []
    assert.ok(rules.length > 0, 'a .dot-halo rule must remain')
    for (const rule of rules) assert.doesNotMatch(rule, /stroke/, rule)
    assert.match(css(), /\.dot-halo[^{]*\{[^}]*blur\((\d+)px\)/)
    assert.doesNotMatch(css(), /\.(?:atlas-glow|atlas-hit|center-hit)\b/)
  })

  it('no rule styles the retired ruler', () => {
    assert.doesNotMatch(css(), /\.ruler\b/)
  })

  it('draws the dumbbell dots at --x and keeps the rare list styled', () => {
    assert.match(css(), /\.dumbbell-dot[^{]*\{[^}]*var\(--x\)/)
    assert.match(css(), /\.dumbbell-dot\.cmp-a[^{]*\{[^}]*var\(--cmp-a\)/)
    assert.match(css(), /\.dumbbell-dot\.cmp-b[^{]*\{[^}]*var\(--cmp-b\)/)
    assert.match(css(), /\.dumbbell-rare[^{]*\{/)
  })
})

describe('figure 3 as a Svelte component (#293)', () => {
  it('the page renders Compare.svelte and still ships every id and hook figure 3 had', () => {
    const html = design5()
    for (const id of ['compareTitle', 'compareA', 'compareB', 'compareDays', 'compareSource', 'compareMeasure', 'compareLimit', 'compareStatus', 'compareRuler', 'compareDetail', 'compareHiddenNote', 'compareMode', 'comparePerson', 'compareLensA', 'compareLensB', 'compareThinNote'])
      assert.match(html, new RegExp(`id="${id}"`), `#${id}`)
    assert.ok(existsSync(join(root, 'src', 'ui', 'Compare.svelte')))
    assert.ok(existsSync(join(root, 'src', 'ui', 'Butterfly.svelte')))
    assert.ok(existsSync(join(root, 'src', 'ui', 'Dumbbell.svelte')))
    assert.ok(!existsSync(join(root, 'src', 'ui', 'Ruler.svelte')), 'nothing draws a ruler any more (issue #327)')
  })
})

// Issue #326: the lenses figure became #compare's lens mode; its guide text is the #lentes block
// nested in #comparar, and the figures after it renumber.
describe('the reading page folds the lenses guide into #comparar (issue #326 AC30)', () => {
  const page = () => comoLer()
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

  it('#lentes is a descendant of #comparar and holds the "below what the build kept" sentence', () => {
    assert.match(balanced(page(), 'comparar'), /<div id="lentes">/)
    const lentes = balanced(page(), 'lentes')
    assert.ok(lentes)
    assert.match(lentes, /(abaixo|n[aã]o guardou)[\s\S]{0,200}(constru[cç][aã]o|pr[eé]-comput)/i)
    assert.match(lentes, /abaixo do que a construção pré-computada deste recorte guardou/)
  })

  it('#lentes links the bridge explanation, uses no "régua" and adds no heading above h3', () => {
    const lentes = balanced(page(), 'lentes')
    assert.match(lentes, /<a href="#ponte">/)
    assert.doesNotMatch(lentes, /régua/i)
    assert.doesNotMatch(lentes, /<h[12]\b/)
    assert.match(text(lentes), /uma pessoa, dois recortes/)
  })

  it('the former figure 6 heading is gone, the nav keeps Lentes right after Comparar, and the figure headings read 1 to 9 in order', () => {
    const html = page()
    assert.doesNotMatch(html, /Gráfico 6 · Uma pessoa, duas lentes/)
    assert.match(html, /<a href="#comparar">Comparar<\/a><a href="#lentes">Lentes<\/a>/)
    assert.deepEqual([...html.matchAll(/<h2>Gráfico (\d+) ·/g)].map((m) => Number(m[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9])
    assert.deepEqual([...design5().matchAll(/<span class="eyebrow">Gráfico (\d+)<\/span>/g)].map((m) => Number(m[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('the lede counts as many graphs as the page has figures, and the analysis list no longer sends the reader to figure 6', () => {
    const html = page()
    const words: Record<string, number> = { Sete: 7, Oito: 8, Nove: 9, Dez: 10 }
    const lede = html.match(/<p class="lede">(\w+) gráficos/)?.[1] ?? ''
    assert.equal(words[lede], design5().match(/<section class="figure[^"]*" id="/g)?.length)
    const analysis = balanced(html, 'analise')
    assert.doesNotMatch(analysis, /No 6<\/b>|<b>No 6/)
    assert.match(analysis, /dois recortes/)
    assert.match(analysis, /No 7<\/b>, veja a fatia de cada veículo por pessoa/)
  })
})
