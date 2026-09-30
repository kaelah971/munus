import { resolve } from 'node:path'
import { createMunusServer } from './app'
import { MunusAuthService } from './authService'
import { createPostgresPool } from './database'
import { loadServerConfig } from './config'
import { PostgresMunusRepository } from './repository'
import { PostgresPlanningRepository } from './planningRepository'
import { PostgresSupportRepository } from './supportRepository'

const config = loadServerConfig()
const database = createPostgresPool(config.databaseUrl)
const repository = new PostgresMunusRepository(database)
const planning = new PostgresPlanningRepository(database)
const support = new PostgresSupportRepository(database)
const auth = new MunusAuthService(repository, {
  challengeTtlMs: config.challengeTtlMs,
  sessionTtlMs: config.sessionTtlMs,
})
const server = createMunusServer({
  repository,
  planning,
  support,
  auth,
  staticDir: resolve(process.cwd(), 'dist'),
  config,
})

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Munus listening on port ${config.port}`)
})
