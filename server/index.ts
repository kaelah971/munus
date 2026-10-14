import { resolve } from 'node:path'
import { createMunusServer } from './app'
import { MunusAuthService } from './authService'
import { createPostgresPool } from './database'
import { loadServerConfig } from './config'
import { PostgresMunusRepository } from './repository'
import { PostgresPlanningRepository } from './planningRepository'
import { PostgresSupportRepository } from './supportRepository'
import { PostgresPaymentRepository } from './paymentRepository'
import { AirtimeFulfilmentService } from './airtimeFulfilment'
import { ClubKonnectAirtimeProvider } from './clubKonnect'

const config = loadServerConfig()
const database = createPostgresPool(config.databaseUrl)
const repository = new PostgresMunusRepository(database)
const planning = new PostgresPlanningRepository(database)
const support = new PostgresSupportRepository(database)
const payment = new PostgresPaymentRepository(database)
const auth = new MunusAuthService(repository, {
  challengeTtlMs: config.challengeTtlMs,
  sessionTtlMs: config.sessionTtlMs,
})
const fulfilment = config.clubKonnect
  ? new AirtimeFulfilmentService(
    payment,
    new ClubKonnectAirtimeProvider({ credentials: config.clubKonnect }),
    { callbackBaseUrl: config.clubKonnect.callbackBaseUrl },
  )
  : null
const server = createMunusServer({
  repository,
  planning,
  support,
  payment,
  fulfilment,
  auth,
  staticDir: resolve(process.cwd(), 'dist'),
  config,
})

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Munus listening on port ${config.port}`)
})
