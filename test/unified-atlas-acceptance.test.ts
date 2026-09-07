import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const design5Path = join(root, 'public', 'design-5.html')
const legacyPath = join(root, 'public', 'atlas-legacy.html')
const html = () => readFileSync(design5Path, 'utf8')

describe('unified atlas acceptance criteria (issue #28)', () => {
  it('starts in clean live mode without fake data or external script dependencies', () => {
    const source = html()
    assert.match(source, /^<!doctype html>/i)
    assert.doesNotMatch(source, /<script[^>]*\bsrc=/i, 'design-5 must stay self-contained')
    assert.match(source, /load\(\)\s*\n<\/script>/, 'page should boot by loading the real API')
    assert.match(source, /Nenhum grafo fictício será exibido\./)
    assert.doesNotMatch(source, /mock|fixture|fake graph/i)
  })

  it('packing accounts for every term by placing it or exposing it in the overflow selector', () => {
    const source = html()
    assert.match(source, /const packPass = .*placed=\[\], overflow=\[\]/)
    assert.match(source, /if\(best\) placed\.push\(\{\.\.\.n/)
    assert.match(source, /else overflow\.push\(n\)/)
    assert.match(source, /overflow\.map\(n=>`<button class="quiet-button" data-node="\$\{esc\(n\.id\)\}"/)
  })

  it('legacy atlas remains reachable from the new atlas and links back to root', () => {
    assert.ok(existsSync(legacyPath), 'public/atlas-legacy.html must exist')
    assert.match(html(), /href="atlas-legacy\.html"/)
    const legacy = readFileSync(legacyPath, 'utf8')
    assert.match(legacy, /class="brand" href="\/"/, 'legacy brand must link back to the new atlas')
  })

  it('search highlighting does not rebuild the inspector or wipe loaded documents', () => {
    const source = html()
    assert.match(source, /\$\('search'\)\.addEventListener\('input',\(\)=>\{ paintSelection\(\) \}\)/)
    assert.doesNotMatch(source, /\$\('search'\)\.addEventListener\('input',[\s\S]{0,80}inspect\(/)
  })

  it('source segment fits mobile widths and its label is not clickable as a button proxy', () => {
    const source = html()
    assert.match(source, /\.source-field \{ max-width:100%; \}/)
    assert.match(source, /\.segment \{[^}]*max-width:100%;[^}]*overflow-x:auto;/)
    assert.match(source, /<div class="field source-field"><span id="sourceLabel">Fonte<\/span><div class="segment" id="segSource"/)
    assert.doesNotMatch(source, /<label>Fonte<div class="segment" id="segSource"/)
  })

  it('source labels shown in pt-BR avoid raw English tokens like fonte all', () => {
    const source = html()
    assert.match(source, /const sourceLabels = \{all:'todas as fontes'/)
    assert.match(source, /`Base local · \$\{source\} · mínimo de 2 documentos`/)
    assert.doesNotMatch(source, /fonte \$\{state\.source\}|fonte all/)
  })
})
