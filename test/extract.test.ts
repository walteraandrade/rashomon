import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import seed from '../seed.json' with { type: 'json' }
import { domainOf, hashtags, mentions, nameTokens, normalize, personsMentioned, words } from '../src/extract.js'

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

describe('personsMentioned', () => {
  const ids = (text: string) => personsMentioned(text, seed).map((p) => p.id)

  it('tags only the person whose longer alias owns the surname', () => {
    assert.deepEqual(ids('Flávio Bolsonaro critica o governo'), ['flavio-bolsonaro'])
    assert.deepEqual(ids('Eduardo Bolsonaro viaja aos EUA'), ['eduardo-bolsonaro'])
    assert.deepEqual(ids('Michelle Bolsonaro discursa'), ['michelle-bolsonaro'])
  })

  it('still tags Jair on a bare surname', () => {
    assert.deepEqual(ids('Bolsonaro nega participação'), ['bolsonaro'])
    assert.deepEqual(ids('JAIR BOLSONARO é réu'), ['bolsonaro'])
  })

  it('tags both when the bare surname appears apart from the longer alias', () => {
    assert.deepEqual(ids('Flávio Bolsonaro defende Bolsonaro'), ['flavio-bolsonaro', 'bolsonaro'])
  })

  it('does not tag Ciro Gomes on Ciro Nogueira, an excluded name', () => {
    assert.deepEqual(ids('Ciro Nogueira comenta o orçamento'), [])
    assert.deepEqual(ids('Ciro critica Lula'), ['lula', 'ciro'])
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
