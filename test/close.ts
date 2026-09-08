import { after } from 'node:test'
import { db } from '../src/db.js'

// PGlite holds the event loop open after the last assertion, and node:test waits ten seconds
// per file before giving up on it — the whole cost of a suite that runs in under two. Every
// file that opens a database imports this once; the hook is registered at import time, so the
// process exits as soon as its tests finish. Import it after any process.env line the suite
// sets for src/db.ts, since this import loads that module.
after(() => db.close())
