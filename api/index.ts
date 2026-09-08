import { handle } from 'hono/vercel'
import { app } from '../src/server.js'

export const config = { runtime: 'nodejs' }

// Static files and the schema are handled outside the request path: vercel.json serves
// public/ from the CDN, and `pnpm migrate` runs once against DATABASE_URL.
export default handle(app)
