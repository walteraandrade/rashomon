import { db, migrate } from './db.js'

const main = async () => {
  const source = process.argv[2]
  if (!source) throw new Error('usage: pnpm purge <source>')
  await migrate()
  const { rows } = await db.query<{ n: number }>(`with d as (delete from docs where source = $1 returning 1) select count(*)::int as n from d`, [source])
  if (source === 'gkg') await db.query(`delete from gkg_files`)
  console.log(`purged ${rows[0].n} docs from ${source}`)
  await db.close()
}

main()
