import { resolve } from 'node:path'
import { createPostgresPool } from './database'
import { loadServerConfig } from './config'
import { applyMigrations } from './migrationRunner'

async function main(): Promise<void> {
  const config = loadServerConfig()
  const database = createPostgresPool(config.databaseUrl)
  try {
    const applied = await applyMigrations(database, resolve(process.cwd(), 'migrations'))
    if (applied.length === 0) {
      console.log('Munus database is already up to date.')
    } else {
      console.log(`Applied Munus migrations: ${applied.join(', ')}`)
    }
  } finally {
    await database.end()
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
