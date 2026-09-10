import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { OUTLETS, labelFor, resolveScope } from '../src/outlets.js'
import outletsJson from '../outlets.json' with { type: 'json' }

// src/outlets.ts and outlets.json (issue #26): the editorial-lean list and the pure scope
// resolution. The routes that read it are in test/graph.test.ts.

describe('outlets.json content matches the issue specification exactly', () => {
  it('deep-equals a literal copy of the five entries', () => {
    assert.deepEqual(outletsJson, [
      {
        domain: 'oantagonista.com.br',
        lean: 'right',
        basis: 'third_party_consensus',
        note: "Anti-PT editorial line since founding; owners came from Veja's Sabino-era anti-Petista shift; acted as a Lava Jato press partner.",
        sources: ['https://diplomatique.org.br/midia-antipetista-por-tras-do-portal-o-antagonista-2/'],
      },
      {
        domain: 'crusoe.com.br',
        lean: 'right',
        basis: 'third_party_consensus',
        note: 'Founded 2018 by the same two owners as oantagonista.com.br (Mainardi, Sabino); explicitly the same editorial line.',
        sources: ['https://pt.wikipedia.org/wiki/Revista_Crusoé'],
      },
      {
        domain: 'cartacapital.com.br',
        lean: 'left',
        basis: 'third_party_consensus',
        note: 'Founded 1994 by Mino Carta; widely described as progressive, with explicit editorial support for Lula.',
        sources: ['https://red.org.br/noticias/mino-carta-morre-aos-91-anos-icone-do-jornalismo-independente-no-brasil/'],
      },
      {
        domain: 'poder360.com.br',
        lean: 'center',
        basis: 'self_declared',
        note: "Outlet's own editorial principles claim non-partisanship and impartiality. No independent third-party audit found; treat as a claim, not a verified consensus.",
        sources: ['https://www.poder360.com.br/politica-editorial/'],
      },
      {
        domain: 'congressoemfoco.com.br',
        lean: 'center',
        basis: 'self_declared',
        note: 'Described as independent/non-partisan since its 2004 founding. Ownership changed in Nov 2024 (sold to the Migalhas group) with no confirmed editorial shift since.',
        sources: ['https://pt.wikipedia.org/wiki/Congresso_em_Foco'],
      },
    ])
    assert.deepEqual(OUTLETS, outletsJson)
  })
})

describe('resolveScope / labelFor', () => {
  it('AC12: an empty domain+lean intersection resolves to \'\' (not \'all\'), matching zero real docs.domain by construction', () => {
    const { domain, outlets } = resolveScope('example.org', 'right')
    assert.equal(domain, '')
    assert.deepEqual(outlets, [])
    // labelFor must never invent a lean for a domain outside outlets.json
    assert.deepEqual(labelFor('example.org'), { lean: null, basis: null })
    assert.deepEqual(labelFor(null), { lean: null, basis: null })
  })
})
