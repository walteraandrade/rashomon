import { db, migrate } from './db.js'

// Standalone so the schema can be created once against a managed Postgres, instead of
// on every serverless request.
await migrate()
console.log('schema ready')
await db.close()
