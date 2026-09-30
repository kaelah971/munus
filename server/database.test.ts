// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createPostgresPool } from './database'

describe('Munus PostgreSQL client', () => {
  it('accepts Neon SSL connection strings without exposing them to the client', async () => {
    const pool = createPostgresPool('postgresql://user:password@ep-example.neon.tech/munus?sslmode=require')
    await pool.end()
  })

  it('rejects disabled SSL in production', () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect(() => createPostgresPool('postgresql://user:password@localhost:5432/munus?sslmode=disable')).toThrow(/SSL/)
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  })
})
