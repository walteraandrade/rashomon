import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Testimony from '../../src/ui/Testimony.svelte'

describe('Testimony on the server (issue #296)', () => {
  it('AC12: the prerendered output carries every id of the figure', () => {
    const { body } = render(Testimony)
    for (const id of ['testimonyPerson', 'testimonyDays', 'testimonySource', 'testimonyLabel', 'strip', 'testimonyList', 'outlets', 'domainLabel', 'outletList'])
      expect(body, id).toContain(`id="${id}"`)
    expect(body).not.toContain('Aguardando dados.')
  })
})
