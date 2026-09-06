import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { domainOf, hashtags, mentions, nameTokens, normalize, words } from '../src/extract.js'

describe('normalize', () => {
  it('lowercases and strips accents', () => {
    assert.equal(normalize('Tarcísio ÀÇÃO'), 'tarcisio acao')
  })
})

describe('words', () => {
  it('drops short words, numbers, stopwords, urls and mentions', () => {
    const ts = words('Lula diz que a reforma https://x.co/a @alguem 2026 vai bem').map((t) => t.term)
    assert.deepEqual(ts, ['lula', 'reforma'])
  })

  it('drops onomatopoeia and stretched words', () => {
    const ts = words('kkkkk hahaha goooool reforma').map((t) => t.term)
    assert.deepEqual(ts, ['reforma'])
  })
})

describe('hashtags', () => {
  it('keeps hashtags as their own kind, normalized', () => {
    assert.deepEqual(hashtags('#Reforma e #ELEIÇÃO'), [
      { term: 'reforma', kind: 'hashtag' },
      { term: 'eleicao', kind: 'hashtag' },
    ])
  })
})

describe('mentions', () => {
  const leite = { id: 'leite', name: 'Eduardo Leite', aliases: ['Eduardo Leite'] }
  const lula = { id: 'lula', name: 'Lula', aliases: ['Lula', 'Luiz Inácio'] }

  it('matches aliases as whole words, ignoring case and accents', () => {
    assert.ok(mentions('LUIZ INACIO fala', lula))
    assert.ok(mentions('o presidente Lula.', lula))
  })

  it('does not match inside other words or partial aliases', () => {
    assert.ok(!mentions('preço do leite subiu', leite))
    assert.ok(!mentions('lulista convicto', lula))
  })
})

describe('nameTokens', () => {
  it('lists alias words of three letters or more, once each', () => {
    assert.deepEqual(nameTokens({ id: 'x', name: 'x', aliases: ['Romeu Zema', 'Zema'] }), ['romeu', 'zema'])
  })
})

describe('domainOf', () => {
  it('strips www and applies outlet aliases', () => {
    assert.equal(domainOf('https://www.g1.globo.com/politica/x'), 'g1.globo.com')
    assert.equal(domainOf('https://www1.folha.uol.com.br/x'), 'folha.uol.com.br')
    assert.equal(domainOf('not a url'), undefined)
  })
})
