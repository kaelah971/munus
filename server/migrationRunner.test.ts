// @vitest-environment node
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DatabasePool, DatabaseResult, DatabaseRow, DatabaseTransaction } from './database'
import { applyMigrations, listMigrationFiles } from './migrationRunner'

class FakeMigrationPool implements DatabasePool {
  readonly applied = new Set<string>()
  readonly executedSql: string[] = []
  readonly calls: Array<{ text: string; values: unknown[] }> = []
  private readonly transaction: DatabaseTransaction = {
    query: async <Row extends DatabaseRow = DatabaseRow>(text: string, values: unknown[] = []) => {
      this.calls.push({ text, values })
      if (text.startsWith('SELECT version')) {
        return { rows: [...this.applied].map((version) => ({ version })), rowCount: this.applied.size } as unknown as DatabaseResult<Row>
      }
      if (text.startsWith('INSERT INTO public.schema_migrations')) {
        this.applied.add(String(values[0]))
        return { rows: [], rowCount: 1 } as unknown as DatabaseResult<Row>
      }
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || text.includes('pg_advisory')) {
        return { rows: [], rowCount: 0 } as unknown as DatabaseResult<Row>
      }
      if (text.startsWith('CREATE TABLE IF NOT EXISTS public.schema_migrations')) {
        return { rows: [], rowCount: 0 } as unknown as DatabaseResult<Row>
      }
      this.executedSql.push(text)
      return { rows: [], rowCount: 0 } as unknown as DatabaseResult<Row>
    },
    release: () => undefined,
  }

  async query<Row extends DatabaseRow = DatabaseRow>(text: string, values: unknown[] = []): Promise<DatabaseResult<Row>> {
    return this.transaction.query<Row>(text, values)
  }

  async connect(): Promise<DatabaseTransaction> {
    return this.transaction
  }

  async end(): Promise<void> {}
}

describe('Munus PostgreSQL migration runner', () => {
  it('orders the canonical migration files and tracks each successful file', async () => {
    const pool = new FakeMigrationPool()
    const directory = fileURLToPath(new URL('../migrations/', import.meta.url))
    const files = await listMigrationFiles(directory)

    expect(files).toEqual([
      '0001_munus_account_foundation.sql',
      '0002_production_auth_hardening.sql',
      '0003_planning_layer.sql',
      '0004_support_layer.sql',
    ])
    expect(await applyMigrations(pool, directory)).toEqual(files)
    expect(await applyMigrations(pool, directory)).toEqual([])
    expect([...pool.applied]).toEqual(files)
    expect(pool.executedSql).toHaveLength(4)
    expect(pool.executedSql.join('\n')).not.toMatch(/supabase|auth\.uid|row level security/i)
    expect(pool.calls.filter((call) => call.text === 'BEGIN')).toHaveLength(4)
  })
})
