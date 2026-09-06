import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// public/design-5.html has no import surface (it is a single-file front-end,
// not a module under src/), so this extracts the pure `bskyUrl` function
// straight out of the served markup and evaluates it in isolation. If the
// function is renamed, removed, or made to reference outer scope, this test
// fails loudly instead of silently skipping the acceptance criteria.
const htmlPath = fileURLToPath(new URL('../public/design-5.html', import.meta.url))
const html = readFileSync(htmlPath, 'utf8')

const extractBskyUrl = (): (d: Record<string, unknown>) => string | null => {
  const marker = 'const bskyUrl = (d) => '
  const start = html.indexOf(marker)
  assert.ok(start !== -1, 'bskyUrl definition not found in public/design-5.html')
  const braceStart = html.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === '{') depth++
    else if (html[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  assert.ok(end !== -1, 'could not find matching closing brace for bskyUrl')
  const source = html.slice(start + 'const bskyUrl = '.length, end + 1)
  // eslint-disable-next-line no-eval
  return (0, eval)(source)
}

const bskyUrl = extractBskyUrl()

describe('bskyUrl (public/design-5.html)', () => {
  it('AC1: maps a well-formed bluesky doc to its bsky.app post URL', () => {
    const d = { source: 'bluesky', domain: 'ana.bsky.social', uri: 'at://did:plc:x/app.bsky.feed.post/abc123' }
    assert.equal(bskyUrl(d), 'https://bsky.app/profile/ana.bsky.social/post/abc123')
  })

  it('AC1: uses the last uri segment as rkey regardless of collection (repost/quote)', () => {
    const d = { source: 'bluesky', domain: 'ana.bsky.social', uri: 'at://did:plc:x/app.bsky.feed.repost/xyz789' }
    assert.equal(bskyUrl(d), 'https://bsky.app/profile/ana.bsky.social/post/xyz789')
  })

  it('AC2: returns null when uri does not start with at://', () => {
    const d = { source: 'bluesky', domain: 'ana.bsky.social', uri: 'https://bsky.app/profile/ana.bsky.social/post/abc123' }
    assert.equal(bskyUrl(d), null)
  })

  it('AC2: returns null when domain is null', () => {
    const d = { source: 'bluesky', domain: null, uri: 'at://did:plc:x/app.bsky.feed.post/abc123' }
    assert.equal(bskyUrl(d), null)
  })

  it('AC2: returns null when domain is an empty string', () => {
    const d = { source: 'bluesky', domain: '', uri: 'at://did:plc:x/app.bsky.feed.post/abc123' }
    assert.equal(bskyUrl(d), null)
  })

  it('AC2: returns null when domain is undefined', () => {
    const d = { source: 'bluesky', uri: 'at://did:plc:x/app.bsky.feed.post/abc123' }
    assert.equal(bskyUrl(d), null)
  })

  it('AC2: returns null when the uri ends in a trailing slash (empty rkey)', () => {
    const d = { source: 'bluesky', domain: 'ana.bsky.social', uri: 'at://did:plc:y/' }
    assert.equal(bskyUrl(d), null)
  })

  it('AC4: returns null for a non-bluesky source, even with an at:// uri and a domain', () => {
    const d = { source: 'gnews', domain: 'ana.bsky.social', uri: 'at://did:plc:x/app.bsky.feed.post/abc123' }
    assert.equal(bskyUrl(d), null)
  })

  it('never throws on malformed input', () => {
    // @ts-expect-error deliberately exercising the catch-all guard with garbage input
    assert.doesNotThrow(() => bskyUrl(null))
    // @ts-expect-error deliberately exercising the catch-all guard with garbage input
    assert.equal(bskyUrl(null), null)
    assert.equal(bskyUrl({ source: 'bluesky', domain: 'x', uri: 42 }), null)
  })
})
