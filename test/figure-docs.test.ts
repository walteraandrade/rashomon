import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { docsText } from './docs.js'
import { pageMarkup } from './pages.js'

// The docs and the prerendered page carry the facts the components rely on; the components'
// own behaviour is in test/components/.

describe('figure 9 querystring keys are documented (issue #215)', () => {
  it('names the persistence figure id, person and limit bare or prefixed, and weeks prefixed only', () => {
    assert.match(docsText, /persistence\.weeks/)
    assert.match(docsText, /persistence[\s\S]{0,600}\bperson\b[\s\S]{0,120}\blimit\b[\s\S]{0,200}(bare|prefixed)/i)
    assert.match(docsText, /persistence[\s\S]{0,800}\bweeks\b[\s\S]{0,250}(prefixed only|no bare|only (the )?prefixed|never (a )?bare)/i)
  })
})

describe('the comention figure is a Svelte component', () => {
  it('documents that comention is a Svelte component seeded from days, source, lean and min, sharing the single /api/people fetch (AC16)', () => {
    assert.match(docsText, /comention[\s\S]{0,300}Svelte component/i)
    assert.match(docsText, /Comention\.svelte/)
    assert.match(docsText, /comention[\s\S]{0,600}\bdays\b[\s\S]{0,120}\bsource\b[\s\S]{0,200}\blean\b[\s\S]{0,120}\bmin\b/i)
    assert.match(docsText, /comention[\s\S]{0,1200}\/api\/people[\s\S]{0,200}(once|single|shared|one fetch)/i)
  })
})

describe('figure 4 is a Svelte component (#292)', () => {
  it('documents that rising is a Svelte component seeded from bootData with person and source, and no longer a figures/*.ts mount', () => {
    assert.match(docsText, /Rising\.svelte/)
    assert.match(docsText, /rising[\s\S]{0,300}Svelte component/i)
    assert.match(docsText, /rising[\s\S]{0,600}\bperson\b[\s\S]{0,120}\bsource\b/i)
    assert.doesNotMatch(docsText, /figures\/rising/)
  })

  it('the prerendered page carries every figure 4 hook, after figure 3, with only person and source as controls', () => {
    const page = pageMarkup('/')
    for (const id of ['rising', 'risingTitle', 'risingPerson', 'risingSource', 'risingRuler', 'risingAbout']) assert.match(page, new RegExp(`id="${id}"`), `#${id} must be in the page`)
    assert.ok(page.indexOf('id="compare"') >= 0, '#compare must be in the page')
    assert.ok(page.indexOf('id="compare"') < page.indexOf('id="rising"'), '#rising must come after #compare')
    assert.match(page, /<section class="figure[^"]*" id="rising"/)
    const section = page.slice(page.indexOf('id="rising"'))
    const line = section.match(/<[^>]*class="[^"]*sentence-line[^"]*"[\s\S]*?<\/(?:p|div)>/)?.[0] ?? section.slice(0, 2500)
    for (const id of ['risingDays', 'risingBaseline', 'risingKind', 'risingLimit', 'risingMin']) assert.doesNotMatch(line, new RegExp(`id="${id}"`), `#${id} is not a control`)
  })
})

describe('rising docs describe the dumbbell (#327)', () => {
  const paragraphs = (page: string, id: string) => {
    const section = pageMarkup(page).match(new RegExp(`<div id="${id}">[\\s\\S]*?(?=<div id="(?:help-)?semana">)`))?.[0] ?? ''
    return [...section.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, '')).join('\n')
  }
  const facts: [string, RegExp][] = [
    ['the 20 most present words of the last 7 days', /20 palavras mais presentes[\s\S]{0,60}7 dias/],
    ['a before dot and a now dot on one scale', /duas bolinhas na mesma escala/],
    ['occurrences per thousand words, a word counted once per text', /a cada mil palavras escritas sobre a pessoa[\s\S]{0,400}pares texto-palavra[\s\S]{0,400}conta uma vez por texto/],
    ['the 14 days before against the last 7', /14 dias anteriores[\s\S]{0,60}7 últimos dias/],
    ['the ratio now over before with one decimal', /razão agora ÷ antes, com uma casa decimal/],
    ['nova means absent from the 14 days before', /"nova"[\s\S]{0,60}não apareceu nos 14 dias antes/],
    ['rows run from the biggest ratio down, smoothed by one text of brinde', /maior razão para a menor[\s\S]{0,120}brinde \(\+1\) do lado do antes/],
    ['without word totals the unit is texts per hundred texts', /faltam os totais de palavras[\s\S]{0,80}a cada cem textos/],
    ['the list below holds up to 12 and says how many were left out', /fora do gráfico[\s\S]{0,300}até 12[\s\S]{0,60}quantas ficaram de fora/],
    ['a click opens the last week\'s texts', /Clique abre os textos da última semana/],
  ]
  const retired = [/log₂/, /±\s?[13]/, /régua/i, /mesma fatia/, /tamanho da letra/i]

  for (const [label, page, id] of [
    ['the dialog', '/', 'help-em-alta'],
    ['the reading page', '/como-ler', 'em-alta'],
  ] as const) {
    it(`${label} states the dumbbell facts and no ruler, names no figure by number`, () => {
      const text = paragraphs(page, id)
      assert.ok(text, `#${id} must exist`)
      for (const [fact, pattern] of facts) assert.match(text, pattern, `${label} must state ${fact}`)
      for (const pattern of retired) assert.doesNotMatch(text, pattern, `${label} must not state ${pattern}`)
      assert.doesNotMatch(text, /gr[áa]fico \d/i)
    })
  }
})

describe('the rising figure key and copy in the page (#327)', () => {
  const section = () => {
    const page = pageMarkup('/')
    return page.slice(page.indexOf('id="rising"'), page.indexOf('id="rising"') + 6000)
  }

  it('the key names Posição, Cor, Clique and Lista in that order, in the unit of a thousand words, without Tamanho or a 21-day claim', () => {
    const key = section().match(/<dl class="figure-key">[\s\S]*?<\/dl>/)?.[0] ?? ''
    assert.ok(key, 'figure-key must exist')
    const terms = [...key.matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim())
    assert.deepEqual(terms, ['Posição', 'Cor', 'Clique', 'Lista'])
    assert.match(key, /mil palavras/)
    assert.doesNotMatch(key, /Tamanho|21 dias|37 dias/)
  })

  it('the figure names the 14 days before and the last 7, and claims no other window', () => {
    const text = section().replace(/<[^>]+>/g, ' ')
    assert.match(text, /últimos 7 dias, contra os 14 dias antes/)
    assert.doesNotMatch(text, /\b(30|60) dias\b/)
  })
})
