import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { paintDocs, paintDocsHead, paintDocsLoading } from '../../src/ui/docs-paint.js'

let docs: HTMLElement

beforeEach(() => {
  document.body.innerHTML = '<span id="docsKicker"></span><h2 id="docsTitle"></h2><div id="docs"></div>'
  docs = document.getElementById('docs') as HTMLElement
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('paintDocsHead / paintDocs: the card that holds the documents', () => {
  it('paintDocsHead writes whatever the figure that asked calls its own reading', () => {
    paintDocsHead({ kicker: 'Documentos com palavra', title: 'reforma' })
    expect(document.getElementById('docsKicker')!.textContent).toBe('Documentos com palavra')
    expect(document.getElementById('docsTitle')!.textContent).toBe('reforma')
    paintDocsHead({ kicker: 'Documentos de', title: 'g1.globo.com' })
    expect(document.getElementById('docsKicker')!.textContent).toBe('Documentos de')
    expect(document.getElementById('docsTitle')!.textContent).toBe('g1.globo.com')
  })

  const side = (name: string | null) => ({ label: name, data: { docs: [{ source: 'rss', domain: 'example.org', text: 'um texto', url: 'https://example.org/a' }], total: 3 } })

  it('paintDocs writes one plain list for one side and two labelled columns for two', () => {
    paintDocs([side(null)])
    expect(docs.innerHTML).not.toMatch(/docs-columns/)
    expect(docs.innerHTML).toMatch(/Mostrando 1 de 3 documentos\./)
    paintDocs([side('Lula'), side('Bolsonaro')])
    expect(docs.querySelector('.docs-columns')).not.toBeNull()
    expect([...docs.querySelectorAll('.docs-side-name')].map((n) => n.textContent)).toEqual(['Lula', 'Bolsonaro'])
  })

  it('an empty side says so instead of leaving a blank column', () => {
    paintDocs([{ label: 'Lula', data: { docs: [], total: 0 } }, { label: 'Bolsonaro', data: { docs: [], total: 0 } }])
    expect(docs.innerHTML.match(/Nenhum documento encontrado\./g)).toHaveLength(2)
  })

  it('a document text with markup stays text', () => {
    paintDocs([{ label: null, data: { total: 1, docs: [{ source: 'rss', domain: 'x.com', text: '<img src=x onerror=alert(1)>', uri: 'https://x.com/a' }] } }])
    expect(docs.querySelector('img')).toBeNull()
    expect(docs.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('paintDocsLoading keeps geometry and stays mute', () => {
    paintDocsLoading()
    expect(docs.innerHTML).toMatch(/Lendo os documentos/)
    expect(docs.getAttribute('aria-busy')).toBe('true')
    expect(docs.innerHTML).not.toMatch(/Carregando/)
  })
})
