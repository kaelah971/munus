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
import { ClubKonnectAirtimeProvider, ClubKonnectDataProvider } from './clubKonnect'
import { ClubKonnectDataCatalog } from './dataCatalog'
import { NimPaymentService } from './nimPayments'
import { CoinGeckoNimRateProvider } from './nimRates'
import { RpcNimiqChainReader } from './nimiqChain'

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
const dataCatalog = config.clubKonnect
  ? new ClubKonnectDataCatalog({ credentials: config.clubKonnect })
  : null
const fulfilment = config.clubKonnect
  ? new AirtimeFulfilmentService(
    payment,
    {
      airtime: new ClubKonnectAirtimeProvider({ credentials: config.clubKonnect }),
      data: new ClubKonnectDataProvider({ credentials: config.clubKonnect }),
    },
    { callbackBaseUrl: config.clubKonnect.callbackBaseUrl },
  )
  : null
const nimPayments = config.nimPayments.receiverAddress
  ? new NimPaymentService(
    payment,
    new CoinGeckoNimRateProvider(),
    config.nimPayments.rpcUrl ? new RpcNimiqChainReader(config.nimPayments.rpcUrl) : null,
    fulfilment,
    {
      receiverAddress: config.nimPayments.receiverAddress,
      network: config.defaultNetwork,
      quoteTtlMs: config.nimPayments.quoteTtlMs,
    },
  )
  : null
const server = createMunusServer({
  repository,
  planning,
  support,
  payment,
  fulfilment,
  nimPayments,
  dataCatalog,
  auth,
  staticDir: resolve(process.cwd(), 'dist'),
  config,
})

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Munus listening on port ${config.port}`)
})
