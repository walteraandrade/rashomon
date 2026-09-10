import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bskyUrl } from '../src/ui/format.js'

describe('bskyUrl (public/js/format.js)', () => {
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
    // bskyUrl has no type annotations (plain JS module): these calls exercise the catch-all
    // guard with garbage input a real caller could pass at runtime, deliberately outside what
    // a typed signature would allow.
    assert.doesNotThrow(() => bskyUrl(null))
    assert.equal(bskyUrl(null), null)
    assert.equal(bskyUrl({ source: 'bluesky', domain: 'x', uri: 42 }), null)
  })
})
