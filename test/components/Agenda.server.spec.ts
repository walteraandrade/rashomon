import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import Agenda from '../../src/ui/Agenda.svelte'

describe('Agenda on the server (issue #288)', () => {
  it('agenda AC16: server-renders without document, window or location, #agendaGrid hidden', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined()
    expect((globalThis as { location?: unknown }).location).toBeUndefined()
    const { body } = render(Agenda)
    expect(body).toMatch(/<section[^>]*id="agenda"/)
    expect(body).toMatch(/<[^>]*id="agendaGrid"[^>]*\bhidden\b[^>]*>|<[^>]*\bhidden\b[^>]*id="agendaGrid"[^>]*>/)
  })
})
