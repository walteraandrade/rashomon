import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pageMarkup } from './pages.js'

// The comention figure is src/ui/Comention.svelte (issue #330); its behaviour is in
// test/components/comention.spec.ts and Comention.server.spec.ts. Here: the markup the page
// carries, the stylesheet rules that must be gone, and the guide prose on both pages.

const css = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'public', 'atlas.css'), 'utf8')

describe('the page carries the comention sentence with a person select', () => {
  it('holds #comentionPerson and five picks, in the order person, days, source, lean, min', () => {
    const section = pageMarkup('/').match(/id="comention"[\s\S]*?<\/section>/)?.[0] ?? ''
    assert.match(section, /<select id="comentionPerson"/)
    assert.equal(section.match(/<span class="pick">/g)?.length, 5)
    const ids = [...section.matchAll(/<select id="(comention\w+)"/g)].map((m) => m[1])
    assert.deepEqual(ids, ['comentionPerson', 'comentionDays', 'comentionSource', 'comentionLean', 'comentionMin'])
    assert.match(section, /<option value="">todas as pessoas<\/option>/)
  })
})

describe('atlas.css no longer swaps the comention list and grid by viewport', () => {
  it('has no rule that hides .comention-grid or shows .comention-list, and the list is never display: none', () => {
    assert.doesNotMatch(css, /\.comention-grid\s*\{\s*display:\s*none/)
    assert.doesNotMatch(css, /\.comention-list\s*\{[^}]*display:\s*none/)
    assert.doesNotMatch(css, /\.comention-list\s*\{\s*display:\s*block/)
    for (const [, query, block] of css.matchAll(/@media\s*([^{]+)\{((?:[^{}]*\{[^}]*\})*[^{}]*)\}/g)) {
      assert.doesNotMatch(block, /\.comention-(grid|list)\b[^{]*\{[^}]*display/, `no comention display rule inside @media ${query.trim()}`)
    }
  })
})

describe('the guide describes the partner list on both pages', () => {
  const junto = pageMarkup('/como-ler').match(/<div id="junto">[\s\S]*?(?=<div id=")/)?.[0] ?? ''
  const help = pageMarkup('/').match(/<div id="help-junto">[\s\S]*?(?=<div id=")/)?.[0] ?? ''
  const prose = (chunk: string) => chunk.replace(/<[^>]+>/g, ' ').replace(/&ldquo;|&rdquo;/g, '"').replace(/\s+/g, ' ')

  for (const [name, chunk] of [
    ['como-ler #junto', junto],
    ['help #help-junto', help],
  ] as const) {
    it(`${name} states the list default, the top 15, the bar scale, the 900px matrix and the min`, () => {
      const text = prose(chunk)
      assert.ok(text.length > 200, `${name} is on the page`)
      assert.match(text, /A lista é a vista de partida/)
      assert.match(text, /todas as pessoas"[\s\S]{0,120}15 pares/)
      assert.match(text, /barra mais longa é o maior número/)
      assert.match(text, /900px ou mais/)
      assert.match(text, /não é concordar/)
      assert.match(text, /mínimo[\s\S]{0,160}esconde/)
      assert.doesNotMatch(text, /700px|vira uma lista|Tela estreita/)
      assert.doesNotMatch(text, /em branco na matriz/)
    })
  }
})
