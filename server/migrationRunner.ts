import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabasePool } from './database'

const MIGRATION_LOCK_KEY = 731942615

export async function listMigrationFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && /^\d+_[a-z0-9_]+\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
}

export async function applyMigrations(
  pool: DatabasePool,
  directory: string,
): Promise<string[]> {
  const client = await pool.connect()
  const applied: string[] = []
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    await client.query(
      `CREATE TABLE IF NOT EXISTS public.schema_migrations (
         version text primary key,
         applied_at timestamptz not null default now()
       )`,
    )
    const existingResult = await client.query(
      'SELECT version FROM public.schema_migrations ORDER BY version',
    )
    const existing = new Set(existingResult.rows.map((row) => String(row.version)))

    for (const fileName of await listMigrationFiles(directory)) {
      if (existing.has(fileName)) continue
      const sql = await readFile(join(directory, fileName), 'utf8')
      let started = false
      try {
        await client.query('BEGIN')
        started = true
        await client.query(sql)
        await client.query(
          'INSERT INTO public.schema_migrations (version) VALUES ($1)',
          [fileName],
        )
        await client.query('COMMIT')
        applied.push(fileName)
        existing.add(fileName)
      } catch (error) {
        if (started) await client.query('ROLLBACK')
        throw new Error(`Migration ${fileName} failed: ${errorMessage(error)}`, { cause: error })
      }
    }

    return applied
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    } finally {
      client.release()
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
