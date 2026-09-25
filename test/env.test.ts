import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { withEnv } from './env.js'

describe('withEnv', () => {
  it('runs concurrent calls one at a time and leaves process.env as it found it', async () => {
    delete process.env.WITH_ENV_PROBE
    const values = ['a', 'b', 'c', 'd']
    await Promise.all(
      values.map((v) =>
        withEnv({ WITH_ENV_PROBE: v }, async () => {
          await new Promise((r) => setTimeout(r, 1))
          assert.equal(process.env.WITH_ENV_PROBE, v)
        }),
      ),
    )
    assert.equal(process.env.WITH_ENV_PROBE, undefined)
  })

  it('keeps the queue moving after a call fails', async () => {
    await assert.rejects(withEnv({ WITH_ENV_PROBE: 'x' }, () => { throw new Error('boom') }), /boom/)
    assert.equal(await withEnv({ WITH_ENV_PROBE: 'y' }, () => process.env.WITH_ENV_PROBE), 'y')
    assert.equal(process.env.WITH_ENV_PROBE, undefined)
  })
})
