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
import { InformativeRateService, PostgresMarketRateStore } from './marketRates'
import { RpcNimiqChainReader } from './nimiqChain'
import { CashoutService } from './cashout'
import { PaycrestClient } from './paycrest'
import { LiveStatsService, PostgresLiveStatsSource } from './liveStats'
import { PostgresWalletAccountStore } from './walletAccounts'
import { syncEssentialForOrder } from './essentialRequests'
import type { PaymentOrder } from '../src/domain/orders'

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
const essentialSync = (order: PaymentOrder): Promise<void> =>
  syncEssentialForOrder({ support, payment }, order).then(() => undefined).catch((error: unknown) => {
    console.info('Munus essential sync retryable', { orderId: order.id, cause: error instanceof Error ? error.message : 'unknown sync error' })
  })
const fulfilment = config.clubKonnect
  ? new AirtimeFulfilmentService(
    payment,
    {
      airtime: new ClubKonnectAirtimeProvider({ credentials: config.clubKonnect }),
      data: new ClubKonnectDataProvider({ credentials: config.clubKonnect }),
    },
    { callbackBaseUrl: config.clubKonnect.callbackBaseUrl, onFulfilmentSettled: essentialSync },
  )
  : null
const nimRateProvider = new CoinGeckoNimRateProvider()
const informativeRates = new InformativeRateService({
  rates: nimRateProvider,
  store: new PostgresMarketRateStore(database),
  quoteTtlMs: config.nimPayments.quoteTtlMs,
})
informativeRates.start()
const nimPayments = config.nimPayments.receiverAddress
  ? new NimPaymentService(
    payment,
    nimRateProvider,
    config.nimPayments.rpcUrl ? new RpcNimiqChainReader(config.nimPayments.rpcUrl) : null,
    fulfilment,
    {
      receiverAddress: config.nimPayments.receiverAddress,
      network: config.defaultNetwork,
      quoteTtlMs: config.nimPayments.quoteTtlMs,
      onPaymentSettled: essentialSync,
    },
  )
  : null
const cashout = config.paycrest
  ? new CashoutService(
    payment,
    new PaycrestClient({
      credentials: { apiKey: config.paycrest.apiKey, apiSecret: config.paycrest.apiSecret },
      baseUrl: config.paycrest.baseUrl,
    }),
    {
      network: config.defaultNetwork,
      quoteTtlMs: config.nimPayments.quoteTtlMs,
      usdtContractAddress: config.paycrest.usdtContractAddress,
      refundAddress: config.paycrest.refundAddress,
    },
  )
  : null
const live = new LiveStatsService(new PostgresLiveStatsSource(database))
const walletAccounts = new PostgresWalletAccountStore(database)
const server = createMunusServer({
  repository,
  planning,
  support,
  payment,
  walletAccounts,
  fulfilment,
  nimPayments,
  dataCatalog,
  cashout,
  paycrestApiSecret: config.paycrest?.apiSecret,
  live,
  informativeRates,
  auth,
  staticDir: resolve(process.cwd(), 'dist'),
  config,
})

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Munus listening on port ${config.port}`)
})
