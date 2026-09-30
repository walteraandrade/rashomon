import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Proof from '../../src/ui/Proof.svelte'

describe('Proof on the server', () => {
  it('renders "Cliques: 0" on the server', () => {
    const { body } = render(Proof)
    expect(body).toContain('Cliques: 0')
    expect(body).toMatch(/<button[^>]*>Contar<\/button>/)
  })
})
