import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import seed from '../seed.json' with { type: 'json' }
import { readFileSync } from 'node:fs'
import {
  capitalizedRuns,
  collocations,
  contentWords,
  discoverNames,
  domainOf,
  hashtags,
  mentions,
  nameTokens,
  normalize,
  personsMentioned,
  properNouns,
  standaloneWords,
  terms,
  wordPairs,
  words,
} from '../src/extract.js'
import { persons } from './fixture.js'

// Pure text functions in src/extract.ts: no database, no fixture docs.

const termsOfKind = (nodes: { term: string; kind: string }[], kind: string) => nodes.filter((n) => n.kind === kind).map((n) => n.term)
const termKeys = (text: string) => new Set(terms(text, [], new Set<string>()).map((t) => `${t.kind}:${t.term}`))

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

  it('tags the four bare surnames the short headlines use', () => {
    assert.deepEqual(ids('Moraes se declara impedido'), ['moraes'])
    assert.deepEqual(ids('Mendonça afasta o diretor da PF'), ['andre-mendonca'])
    assert.deepEqual(ids('Dino autoriza a PF'), ['dino'])
    assert.deepEqual(ids('Motta pauta a PEC'), ['hugo-motta'])
  })

  it('does not tag the four bare surnames on their homonyms', () => {
    assert.deepEqual(ids('Mendonça Filho disputa vaga no Senado'), [])
    assert.deepEqual(ids('Marília Mendonça, cantora'), [])
    assert.deepEqual(ids('Vinicius de Moraes e Jobim'), [])
    assert.deepEqual(ids('Drica Moraes volta à televisão'), [])
    assert.deepEqual(ids('Ivan Moraes disputa o Recife'), [])
    assert.deepEqual(ids('Ed Motta lança disco'), [])
  })

  it('keeps the tracked person when a homonym shares the doc', () => {
    assert.deepEqual(ids('Hugo Motta aponta Mendonça Filho para a relatoria'), ['hugo-motta'])
    assert.deepEqual(ids('Alexandre de Moraes ouve Vinicius de Moraes'), ['moraes'])
  })

  it('issue #25: tags the speaking senator on a senado doc via its bare name-prefix, with no source-specific branch involved', () => {
    // mirrors src/collectors/senado.ts's `${person.name}: ${TextoResumo}` convention; the
    // resumo body itself never names Alcolumbre, so the tag only lands via the prefix
    assert.deepEqual(
      ids('Davi Alcolumbre: pronunciamento sobre soberania nacional e infraestrutura portuária'),
      ['alcolumbre'],
    )
    const extractSource = readFileSync(new URL('../src/extract.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(extractSource, /source\s*===\s*['"]senado['"]/)
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

describe('extraction reads several words as one term', () => {
  it('tokenizes once, in reading order, so words and pairs cannot disagree', () => {
    // "sobre" and "a" are stopwords; "defende" and "reforma" are not.
    assert.deepEqual(contentWords('Lula defende sobre a reforma'), ['lula', 'defende', 'reforma'])
    assert.deepEqual(wordPairs('Lula defende sobre a reforma'), [
      { w1: 'lula', w2: 'defende' },
      { w1: 'defende', w2: 'reforma' },
      // The trailing null is the last word's own occurrence, which src/phrases.ts counts as a
      // unigram; without it the last word of every text would be invisible to the denominator.
      { w1: 'reforma', w2: null },
    ])
  })

  it('measures adjacency after stopwords, so "primeiro do turno" is the same pair as "primeiro turno"', () => {
    const lexicon = new Set(['primeiro turno'])
    assert.deepEqual(collocations('primeiro turno decisivo', lexicon), [{ term: 'primeiro turno', kind: 'phrase' }])
    assert.deepEqual(collocations('primeiro do turno', lexicon), [{ term: 'primeiro turno', kind: 'phrase' }])
  })

  it('yields no collocation at all until a lexicon exists', () => {
    assert.deepEqual(collocations('primeiro turno decisivo', new Set()), [])
    assert.deepEqual(terms('primeiro turno decisivo').filter((t) => t.kind === 'phrase'), [])
  })

  it('reads a capitalized run as a phrase without any lexicon, and skips the one opening a sentence', () => {
    assert.deepEqual(properNouns('O ministro Alexandre de Moraes votou contra Jair Bolsonaro'), [
      { term: 'alexandre de moraes', kind: 'phrase' },
      { term: 'jair bolsonaro', kind: 'phrase' },
    ])
    // The first word of a sentence is capitalized for grammar, not because it is a name.
    assert.deepEqual(properNouns('Alexandre de Moraes votou'), [])
  })

  it('lets the capitalized run win over the bare pair, so one name is not spelled two ways', () => {
    const text = 'O relator Alexandre de Moraes decidiu'
    // "de" is a stopword, so the pair "alexandre moraes" would otherwise be staged and, once
    // frequent enough, tagged next to "alexandre de moraes" as a second term for one person.
    assert.deepEqual(wordPairs(text), [
      { w1: 'relator', w2: 'alexandre' },
      { w1: 'alexandre', w2: null },
      { w1: 'moraes', w2: 'decidiu' },
      { w1: 'decidiu', w2: null },
    ])
    assert.deepEqual(collocations(text, new Set(['alexandre moraes'])), [])
    assert.deepEqual(properNouns(text), [{ term: 'alexandre de moraes', kind: 'phrase' }])
  })

  it('still counts every word as a unigram when its pair is suppressed', () => {
    // The suppressed pair keeps its w1 row: src/phrases.ts reads unigram counts from that
    // column, so hiding a pair must never hide the word from the denominator.
    assert.deepEqual(
      wordPairs('O relator Alexandre de Moraes decidiu').map((r) => r.w1),
      contentWords('O relator Alexandre de Moraes decidiu'),
    )
  })

  it('takes the words away: the phrase replaces them, it does not sit beside them', () => {
    const out = terms('primeiro turno decisivo', [], new Set(['primeiro turno']))
    assert.deepEqual(termsOfKind(out, 'word'), ['decisivo'])
    assert.deepEqual(termsOfKind(out, 'phrase'), ['primeiro turno'])
  })

  it('reads shouting as shouting, not as a name', () => {
    // A real production post. Every word matches the capitalized test, so the raw heuristic
    // built one run out of the whole sentence — and with substitution that one run deleted
    // every word in the post and put "dias para lula no primeiro turno" in their place.
    const shout = 'FALTAM 29 DIAS PARA LULA NO PRIMEIRO TURNO'
    assert.deepEqual(properNouns(shout), [])
    assert.deepEqual(termsOfKind(terms(shout), 'word'), ['faltam', 'lula', 'primeiro', 'turno'])
    // And the pair must survive to the staging table, or the lexicon can never learn it.
    assert.ok(wordPairs(shout).some((p) => p.w1 === 'primeiro' && p.w2 === 'turno'))
  })

  it('refuses a run longer than a name, and one holding a capitalized stopword', () => {
    assert.deepEqual(properNouns('Preso na Cadeia Publica de Ponta Grossa Hildebrando de Souza ontem'), [])
    assert.deepEqual(properNouns('Falou o Whatsapp Agora sobre isso'), [])
    assert.deepEqual(properNouns('Veja PR Os numeros'), [])
  })

  it('still reads an ordinary name, mixed case, inside a shouting-free sentence', () => {
    assert.deepEqual(properNouns('O relator Alexandre de Moraes decidiu').map((t) => t.term), ['alexandre de moraes'])
  })

  it('leaves /candidates on the raw runs, which is a review queue and tolerates noise', () => {
    assert.ok(capitalizedRuns('FALTAM 29 DIAS PARA LULA NO PRIMEIRO TURNO').length > 0)
  })

  it('a capitalized run takes its words away too, with no lexicon involved', () => {
    const out = terms('O relator Alexandre de Moraes decidiu hoje')
    assert.deepEqual(termsOfKind(out, 'word'), ['relator', 'decidiu'])
    assert.deepEqual(termsOfKind(out, 'phrase'), ['alexandre de moraes'])
  })

  it('keeps a word that appears once outside the phrase and once inside it', () => {
    // Presence, not count, is what doc_terms records, so the question is whether *any*
    // occurrence survives — not whether the word was ever swallowed.
    const out = terms('a reforma avanca e a reforma tributaria passa', [], new Set(['reforma tributaria']))
    assert.ok(termsOfKind(out, 'word').includes('reforma'))
    assert.ok(!termsOfKind(out, 'word').includes('tributaria'), 'tributaria only ever appears inside the phrase')
    assert.deepEqual(termsOfKind(out, 'phrase'), ['reforma tributaria'])
  })

  it('leaves every word alone while no lexicon exists', () => {
    assert.deepEqual(termsOfKind(terms('primeiro turno decisivo'), 'word'), ['primeiro', 'turno', 'decisivo'])
    assert.deepEqual(standaloneWords('primeiro turno decisivo').map((t) => t.term), ['primeiro', 'turno', 'decisivo'])
  })
})

describe('stopwords for prose a headline never carried', () => {
  const dropped = ['feira', 'terca', 'quarta', 'quinta', 'sexta', 'setembro', 'outubro', 'novembro', 'dezembro', 'fevereiro', 'abril', 'maio', 'junho', 'julho', 'agosto', 'alem', 'durante', 'foto', 'fotos']

  for (const w of dropped) {
    it(`drops "${w}", a dateline or caption word measured as noise in full-text bodies`, () => {
      assert.ok(!termKeys(`O ministro decidiu ${w} sobre o processo`).has(`word:${w}`))
    })
  }

  it('leaves the words a headline already carried alone', () => {
    const kept = termKeys('O ministro relatou o processo sobre a delacao premiada')
    for (const w of ['ministro', 'relatou', 'processo', 'delacao', 'premiada']) assert.ok(kept.has(`word:${w}`), `${w} must survive`)
  })

  // The five that look like the ones above and are deliberately absent from the set. A stopword
  // also forbids a phrase -- holdsStopword drops a capitalized run holding one, and phrases.ts
  // measures adjacency after this set is dropped -- so each of these is asserted through the
  // phrase it would take with it, which is the thing actually at stake.
  it('keeps "marco", "dois" and "janeiro": their proper nouns still form', () => {
    assert.ok(termKeys('O ministro Marco Aurélio abriu a divergência').has('phrase:marco aurelio'))
    assert.ok(termKeys('A prefeitura de Dois Irmãos assinou o convênio').has('phrase:dois irmaos'))
    // "Rio de Janeiro" alone is not a phrase either way -- `rio` is three letters, below
    // keepWord's floor -- so the run that actually depends on `janeiro` is the longer one.
    assert.ok(termKeys('o plenário da Assembleia Legislativa do Rio de Janeiro votou').has('phrase:assembleia legislativa do rio de janeiro'))
  })

  it('keeps "segundo" and "segunda": their collocations still form', () => {
    const lexicon = new Set(['segundo turno', 'segunda turma'])
    const withLexicon = (text: string) => new Set(terms(text, [], lexicon).map((t) => `${t.kind}:${t.term}`))
    assert.ok(withLexicon('a disputa foi decidida no segundo turno').has('phrase:segundo turno'))
    assert.ok(withLexicon('a segunda turma do supremo decidiu').has('phrase:segunda turma'))
  })

  // What this set does cost, written down rather than discovered later: holdsStopword refuses
  // any capitalized run holding a stopword, so these two names stop being phrases. Both were
  // measured against the corpus before the trade was taken -- "sete de setembro" at one
  // occurrence against 323 dateline uses of the bare "setembro", and "Feira de Santana" at
  // zero against 145 of "feira", which only ever arrives as half of "terça-feira".
  it('costs "Sete de Setembro" and "Feira de Santana" as phrases, the accepted price', () => {
    const setembro = termKeys('a manifestação do Sete de Setembro reuniu apoiadores')
    assert.ok(!setembro.has('phrase:sete de setembro'))
    assert.ok(setembro.has('word:sete'), 'the run breaks, but its other words are not lost')
    const feira = termKeys('o evento de Feira de Santana reuniu candidatos')
    assert.ok(!feira.has('phrase:feira de santana'))
    assert.ok(feira.has('word:santana'))
  })
})

describe('capitalizedRuns: AC1 of issue #32, runs that do not open a sentence', () => {
  it('finds runs of two or more capitalized words, particles allowed', () => {
    assert.deepEqual(capitalizedRuns('O ministro recebe Alexandre de Moraes e Hugo Motta hoje'), ['alexandre de moraes', 'hugo motta'])
  })

  it('drops a run that opens a sentence, in every sentence of the text', () => {
    assert.deepEqual(capitalizedRuns('Davi Alcolumbre fala com Rodrigo Pacheco. Rodrigo Pacheco responde'), ['rodrigo pacheco'])
    assert.deepEqual(capitalizedRuns('Senador Davi Alcolumbre: "Vamos votar" — disse Renan Calheiros'), ['renan calheiros'])
  })

  it('drops single capitalized words, hashtags, handles and urls', () => {
    assert.deepEqual(capitalizedRuns('Encontro com Lula e #HugoMotta @renan https://x.co/Renan Calheiros'), [])
  })

  it('a colon, quote or dash breaks a run but does not open a sentence', () => {
    assert.deepEqual(capitalizedRuns('STF: Alexandre de Moraes manda prender Jair Bolsonaro'), ['alexandre de moraes', 'jair bolsonaro'])
    assert.deepEqual(capitalizedRuns('Boa noite! Hoje no Jornal Nacional: Tarcísio de Freitas fala de São Paulo'), ['jornal nacional', 'tarcisio de freitas', 'sao paulo'])
  })

  it('breaks a run on commas and on "e"', () => {
    assert.deepEqual(capitalizedRuns('Reunião com Ciro Nogueira, Ciro Gomes e Renan Calheiros'), ['ciro nogueira', 'ciro gomes', 'renan calheiros'])
  })

  it('normalizes like aliases: lowercase, no accents, single spaces', () => {
    assert.deepEqual(capitalizedRuns('Encontro com   Cármen   Lúcia hoje'), ['carmen lucia'])
  })
})

describe('discoverNames: AC2 of issue #32, gkg uses the persons column, never the heuristic', () => {
  it('normalizes and dedupes the column names', () => {
    const names = discoverNames({ source: 'gkg', text: 'Fala com Renan Calheiros', extraNames: ['Hugo Motta', 'Hugo Motta', 'Cármen Lúcia'] }, [])
    assert.deepEqual(names, ['hugo motta', 'carmen lucia'])
  })

  it('yields nothing for a gkg doc without a persons column', () => {
    assert.deepEqual(discoverNames({ source: 'gkg', text: 'Fala com Renan Calheiros' }, []), [])
  })
})

describe('discoverNames: AC3 of issue #32, overlay with seed.json aliases and exclude entries', () => {
  const ciro = { id: 'ciro', name: 'Ciro Gomes', aliases: ['Ciro Gomes', 'Ciro'], exclude: ['Ciro Nogueira'] }

  it('drops a name equal to a tracked alias or exclude entry', () => {
    const names = discoverNames({ source: 'rss', text: 'Reunião com Ciro Nogueira, Ciro Gomes, Luiz Inácio e Renan Calheiros' }, [...persons, ciro])
    assert.deepEqual(names, ['renan calheiros'])
  })

  it('keeps a longer name that merely contains a tracked alias', () => {
    const names = discoverNames({ source: 'rss', text: 'Sessão com Michelle Bolsonaro hoje' }, persons)
    assert.deepEqual(names, ['michelle bolsonaro'])
  })

  it('applies the overlay to gkg column names too', () => {
    assert.deepEqual(discoverNames({ source: 'gkg', text: '', extraNames: ['Luiz Inacio', 'Hugo Motta'] }, persons), ['hugo motta'])
  })
})
