import { Pool } from 'pg'

export type DatabaseRow = Record<string, unknown>

export interface DatabaseResult<Row extends DatabaseRow = DatabaseRow> {
  rows: Row[]
  rowCount: number | null
}

export interface DatabaseClient {
  query<Row extends DatabaseRow = DatabaseRow>(text: string, values?: unknown[]): Promise<DatabaseResult<Row>>
}

export interface DatabaseTransaction extends DatabaseClient {
  release(): void
}

export interface DatabasePool extends DatabaseClient {
  connect(): Promise<DatabaseTransaction>
  end(): Promise<void>
}

export function createPostgresPool(databaseUrl: string): DatabasePool {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(databaseUrl)
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection string.')
  }

  if (parsedUrl.protocol !== 'postgres:' && parsedUrl.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol.')
  }

  const sslMode = parsedUrl.searchParams.get('sslmode')
  if (sslMode === 'disable' && process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL must use SSL in production.')
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    ...(sslMode ? {} : { ssl: { rejectUnauthorized: true } }),
  })
  return pool as unknown as DatabasePool
}

export async function withTransaction<T>(
  pool: DatabasePool,
  operation: (client: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  let started = false
  try {
    await client.query('BEGIN')
    started = true
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    if (started) await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
