import { getRequestListener } from '@hono/node-server'
import { app } from '../src/server.js'

export const config = { runtime: 'nodejs' }

// Vercel's Node runtime calls the export with Node's (req, res); hono/vercel's handle expects
// a web Request, so every response would hang. getRequestListener bridges the two shapes.
// Static files and the schema live outside this path: vercel.json serves public/ from the
// CDN, and `pnpm migrate` runs once against DATABASE_URL.
export default getRequestListener(app.fetch)
