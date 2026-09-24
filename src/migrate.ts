import { db, migrateP } from './db.js'

// Standalone so the schema can be created once against a managed Postgres, instead of
// on every serverless request.
await migrateP()
console.log('schema ready')
await db.close()
