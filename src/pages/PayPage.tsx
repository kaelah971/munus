import { useEffect, useRef, useState } from 'react'
import { Icon, ListRow, PrimaryButton, QuietButton, SectionHeading, StatusPill } from '../components/Primitives'
import { ESSENTIAL_CATEGORIES } from '../domain/payment'
import type { IconName } from '../components/Primitives'
import {
  describeFulfilmentStage,
  describeOrderStage,
  isQuoteFresh,
  type PaymentOrder,
  type PaymentOrderDraft,
} from '../domain/orders'
import {
  describeActivityStatus,
  describeActivityStatusCopy,
  describePaymentFailureReason,
  describeProviderName,
  describeServiceLabel,
} from '../domain/receipts'
import type { DataPlan } from '../domain/orders'
import { maskPhone, SUPPORT_NETWORKS } from '../domain/support'
import { maskBankAccountNumber, type CashoutBank, type CashoutRatePreview } from '../domain/cashout'
import { buildRecoveryState } from '../domain/recovery'
import { requestNimPayment, shortenNimiqAccount, type NimiqConnectionState, type NimiqWalletState } from '../integration/nimiq'
import { requestUsdtTransfer } from '../integration/ethereum'
import type { PaymentApi, RailCapability, RailStatus, ReadinessReport } from '../persistence/paymentApi'
import { estimateNgn, mapNimBalance, type NgnQuoteResult } from '../domain/accountPresentation'
import { buildAggregateFundingView, buildFundingPreview, buildNimFundingView, estimateNimFromNgn } from '../domain/funding'
import { NimFundingCard, type FundingDeduction } from '../components/NimFundingCard'
import { RecoveryCenter } from '../components/RecoveryCenter'

const icons: Record<(typeof ESSENTIAL_CATEGORIES)[number]['id'], IconName> = {
  airtime: 'phone',
  data: 'data',
  electricity: 'bolt',
  'cable-internet': 'wifi',
}

type PayView =
  | { name: 'categories' }
  | { name: 'airtime-form' }
  | { name: 'data-form' }
  | { name: 'cashout-form' }
  | { name: 'review'; orderId: string }

type RailKey = 'airtime' | 'data' | 'cashout'

function railForService(serviceType: PaymentOrder['serviceType']): RailKey {
  if (serviceType === 'DATA') return 'data'
  if (serviceType === 'CASH_OUT') return 'cashout'
  return 'airtime'
}

function railLabel(rail: RailKey): string {
  if (rail === 'data') return 'Data'
  if (rail === 'cashout') return 'Cash out'
  return 'Airtime'
}

/** Server-decided availability notice. Renders nothing when verified or unknown. */
function RailNotice({ capability, label }: { capability: RailCapability | undefined; label: string }) {
  if (!capability || capability.status === 'verified') return null
  return (
    <div className="truth-note"><Icon name="info" size={18} /><p>
      {capability.status === 'unavailable'
        ? `${label} is not available right now: ${capability.reason} Actions below stay disabled — no money can move.`
        : `${label}: ${capability.reason}`}
    </p></div>
  )
}

function serviceNoun(order: Pick<PaymentOrder, 'serviceType'>): 'Airtime' | 'Data' | 'Cash out' {
  if (order.serviceType === 'DATA') return 'Data'
  if (order.serviceType === 'CASH_OUT') return 'Cash out'
  return 'Airtime'
}

function emptyAirtimeDraft(defaultPhone: string): PaymentOrderDraft {
  return {
    serviceType: 'AIRTIME',
    paymentAsset: 'NIM',
    recipientPhone: defaultPhone,
    recipientNetwork: '',
    requestedAmount: '',
  }
}

export function PayPage({ api, defaultPhone = '', connection, wallet: walletProp, onRefreshWallet: refreshWalletProp, fallbackNetwork, funding }: {
  api: PaymentApi
  defaultPhone?: string
  connection: NimiqConnectionState
  wallet?: NimiqWalletState
  onRefreshWallet?: () => Promise<NimiqWalletState>
  /** Session-verified network shown labeled when the host exposes none. */
  fallbackNetwork?: 'mainnet' | 'testnet'
  /** Confirmed aggregate funding context; review prefers it when ready. */
  funding?: { luna: string; nim: string; network: 'mainnet' | 'testnet' } | null
}) {
  // App always supplies both; the fallback keeps review renderable without
  // wallet context (unavailable funding state, never invented values).
  const wallet: NimiqWalletState = walletProp ?? { status: 'unavailable', network: 'unknown' }
  async function refreshWallet(): Promise<NimiqWalletState> {
    if (refreshWalletProp) return refreshWalletProp()
    return wallet
  }
  const [view, setView] = useState<PayView>({ name: 'categories' })
  const [orders, setOrders] = useState<PaymentOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<PaymentOrderDraft>(() => emptyAirtimeDraft(defaultPhone))
  const [saving, setSaving] = useState(false)
  const [quoting, setQuoting] = useState(false)
  const [payBusy, setPayBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reviewRate, setReviewRate] = useState<NgnQuoteResult | null>(null)
  const [balanceRefreshFailed, setBalanceRefreshFailed] = useState(false)
  const balanceRefreshed = useRef<Set<string>>(new Set())
  const [dataNetwork, setDataNetwork] = useState<PaymentOrderDraft['recipientNetwork']>('')
  const [dataPlans, setDataPlans] = useState<DataPlan[]>([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [plansError, setPlansError] = useState<string | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [dataPhone, setDataPhone] = useState('')
  const [cashoutBanks, setCashoutBanks] = useState<CashoutBank[]>([])
  const [banksLoading, setBanksLoading] = useState(false)
  const [banksError, setBanksError] = useState<string | null>(null)
  const [cashoutAmount, setCashoutAmount] = useState('')
  const [cashoutBank, setCashoutBank] = useState('')
  const [cashoutAccount, setCashoutAccount] = useState('')
  const [verifiedAccount, setVerifiedAccount] = useState<{
    bankCode: string
    bankName: string
    accountNumber: string
    accountName: string
  } | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [ratePreview, setRatePreview] = useState<CashoutRatePreview | null>(null)
  const [rateLoading, setRateLoading] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null)
  const autoReconciled = useRef<Set<string>>(new Set())

  // Server-decided rail capability. Unknown (offline/older server) fails
  // open to current behavior — the server still guards every money step.
  function railStatus(rail: RailKey): RailStatus {
    return readiness?.rails[rail].status ?? 'verified'
  }

  useEffect(() => {
    let active = true
    api.getReadiness()
      .then((report) => {
        if (active) setReadiness(report)
      })
      .catch(() => {
        if (active) setReadiness(null)
      })
    return () => {
      active = false
    }
  }, [api])

  useEffect(() => {
    let active = true
    api.list().then((paymentOrders) => {
      if (active) {
        setOrders(paymentOrders)
        setLoadError(null)
      }
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : 'Munus could not load your payment orders.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [api])

  const reviewed = view.name === 'review' ? orders.find((order) => order.id === view.orderId) : undefined
  const quoteLive = reviewed ? isQuoteFresh(reviewed, nowMs) : false
  const reviewedId = reviewed?.id
  const countdownActive = reviewed?.paymentStatus === 'READY_FOR_PAYMENT'
    || reviewed?.paymentStatus === 'AWAITING_WALLET_APPROVAL'

  useEffect(() => {
    if (!countdownActive) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [countdownActive, reviewedId])

  useEffect(() => {
    // One safe server poll when opening a confirming order. This never opens
    // the wallet: it only re-checks evidence already on file, on the
    // matching rail — Paycrest for cash out, the NIM rail otherwise.
    if (view.name === 'review' && reviewed?.paymentStatus === 'ONCHAIN_PENDING' && !autoReconciled.current.has(reviewed.id)) {
      autoReconciled.current.add(reviewed.id)
      if (reviewed.serviceType === 'CASH_OUT') {
        void refreshCashoutPayment(reviewed.id)
      } else {
        void refreshOrder(reviewed.id, 'reconcile')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, reviewed?.id, reviewed?.paymentStatus])

  const reviewedIsNim = reviewed?.serviceType !== 'CASH_OUT'
  const reviewedQuoteKey = reviewed && reviewedIsNim && reviewed.quotedCryptoAmount && reviewed.quoteLunaAmount
    ? `${reviewed.id}:${reviewed.quotedCryptoAmount}:${reviewed.quoteLunaAmount}`
    : null

  useEffect(() => {
    // Indicative estimate for the review funding card. Independent from
    // the authoritative server quote: failures only hide the estimate.
    if (!reviewedQuoteKey) {
      setReviewRate(null)
      return
    }
    let active = true
    api.getNimRate().then((rate) => {
      if (!active) return
      const asOf = Date.parse(rate.asOf)
      const expiresAt = Date.parse(rate.expiresAt)
      if (!rate.ngnPerNim || !rate.source.trim() || !Number.isFinite(asOf) || !Number.isFinite(expiresAt)) {
        setReviewRate({ status: 'unavailable' })
        return
      }
      setReviewRate({ status: 'available', asset: 'NIM', network: 'mainnet', ngnPerUnit: rate.ngnPerNim, source: rate.source, asOf, expiresAt })
    }).catch(() => {
      if (active) setReviewRate({ status: 'unavailable' })
    })
    return () => {
      active = false
    }
  }, [api, reviewedQuoteKey])

  useEffect(() => {
    // After server-verified payment, re-read the real balance. A refresh
    // failure never touches PAID — it only notes the balance is stale.
    if (view.name === 'review' && reviewed?.paymentStatus === 'PAID' && reviewedIsNim && !balanceRefreshed.current.has(reviewed.id)) {
      balanceRefreshed.current.add(reviewed.id)
      refreshWallet().then(
        () => setBalanceRefreshFailed(false),
        () => setBalanceRefreshFailed(true),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, reviewed?.id, reviewed?.paymentStatus])

  function updateOrder(next: PaymentOrder) {
    setOrders((current) => current.map((entry) => entry.id === next.id ? next : entry))
  }

  async function refreshOrder(orderId: string, mode: 'get' | 'reconcile') {
    setRefreshing(true)
    setActionError(null)
    try {
      updateOrder(mode === 'reconcile' ? await api.reconcilePayment(orderId) : await api.get(orderId))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Munus could not refresh this order.')
    } finally {
      setRefreshing(false)
    }
  }

  function findOrder(orderId: string): PaymentOrder | undefined {
    return orders.find((entry) => entry.id === orderId)
  }

  async function refreshRecoveryOrder(orderId: string): Promise<PaymentOrder> {
    const updated = findOrder(orderId)?.serviceType === 'CASH_OUT'
      ? await api.reconcileCashoutOrder(orderId)
      : await api.reconcileOrder(orderId)
    updateOrder(updated)
    return updated
  }

  async function retryRecoveryOrder(orderId: string): Promise<PaymentOrder> {
    if (findOrder(orderId)?.serviceType === 'CASH_OUT') {
      throw new Error('Cash out never retries a purchase. Refresh status instead.')
    }
    const updated = await api.retryDelivery(orderId)
    updateOrder(updated)
    return updated
  }

  const [formRate, setFormRate] = useState<NgnQuoteResult | null>(null)
  const [formRateLoading, setFormRateLoading] = useState(false)

  async function loadFormRate() {
    // Indicative form estimate only. Server fetch, no wallet contact;
    // failures degrade to an honest unavailable state with retry.
    setFormRateLoading(true)
    try {
      const rate = await api.getNimRate()
      const asOf = Date.parse(rate.asOf)
      const expiresAt = Date.parse(rate.expiresAt)
      if (!rate.ngnPerNim || !rate.source.trim() || !Number.isFinite(asOf) || !Number.isFinite(expiresAt)) {
        setFormRate({ status: 'unavailable' })
        return
      }
      setFormRate({ status: 'available', asset: 'NIM', network: 'mainnet', ngnPerUnit: rate.ngnPerNim, source: rate.source, asOf, expiresAt })
    } catch {
      setFormRate({ status: 'unavailable' })
    } finally {
      setFormRateLoading(false)
    }
  }

  function openAirtimeForm() {
    setDraft(emptyAirtimeDraft(defaultPhone))
    setActionError(null)
    setPendingTxHash(null)
    setFormRate(null)
    setView({ name: 'airtime-form' })
    void loadFormRate()
  }

  function openDataForm() {
    setDataNetwork('')
    setDataPlans([])
    setPlansError(null)
    setSelectedPlanId('')
    setDataPhone(defaultPhone)
    setActionError(null)
    setPendingTxHash(null)
    setView({ name: 'data-form' })
  }

  async function loadDataPlans(network: PaymentOrderDraft['recipientNetwork']) {
    if (!network) return
    setPlansLoading(true)
    setPlansError(null)
    setSelectedPlanId('')
    try {
      setDataPlans(await api.listDataPlans(network))
    } catch (error) {
      setDataPlans([])
      setPlansError(error instanceof Error ? error.message : 'Munus could not load data bundles.')
    } finally {
      setPlansLoading(false)
    }
  }

  function chooseDataNetwork(network: PaymentOrderDraft['recipientNetwork']) {
    setDataNetwork(network)
    setDataPlans([])
    setPlansError(null)
    setSelectedPlanId('')
    if (network) void loadDataPlans(network)
  }

  async function saveDataOrder() {
    const plan = dataPlans.find((entry) => entry.providerPlanId === selectedPlanId)
    if (!plan || !dataNetwork) return
    setSaving(true)
    setActionError(null)
    try {
      const order = await api.createDataOrder({
        providerPlanId: plan.providerPlanId,
        recipientPhone: dataPhone,
        recipientNetwork: dataNetwork,
      })
      setOrders((current) => [order, ...current.filter((entry) => entry.id !== order.id)])
      setView({ name: 'review', orderId: order.id })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Munus could not save this data order.')
    } finally {
      setSaving(false)
    }
  }

  async function saveAirtimeOrder() {
    setSaving(true)
    setActionError(null)
    try {
      const order = await api.createOrder(draft)
      setOrders((current) => [order, ...current.filter((entry) => entry.id !== order.id)])
      setView({ name: 'review', orderId: order.id })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Munus could not save this airtime order.')
    } finally {
      setSaving(false)
    }
  }

  async function createQuote(orderId: string) {
    setQuoting(true)
    setActionError(null)
    try {
      updateOrder(await api.createQuote(orderId))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Munus could not create a NIM quote.')
    } finally {
      setQuoting(false)
    }
  }

  async function submitWithRetry(orderId: string, txHash: string): Promise<PaymentOrder> {
    try {
      return await api.submitPayment(orderId, txHash)
    } catch (error) {
      // Same-hash submission is idempotent: one automatic retry covers a
      // dropped response without ever risking a second payment.
      return await api.submitPayment(orderId, txHash).catch(() => {
        throw error
      })
    }
  }

  async function payWithNim() {
    if (!reviewed || payBusy) return
    setPayBusy(true)
    setActionError(null)
    try {
      // Explicit user intent only: the wallet is contacted solely from this tap.
      const { order: intentOrder, intent } = await api.createPaymentIntent(reviewed.id)
      updateOrder(intentOrder)
      const txHash = await requestNimPayment(connection, {
        receiver: intent.receiver,
        lunaAmount: intent.lunaAmount,
        memo: intent.memo,
      })
      setPendingTxHash(txHash)
      const submitted = await submitWithRetry(reviewed.id, txHash)
      setPendingTxHash(null)
      updateOrder(submitted)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'NIM payment did not complete. No payment was confirmed.')
      try {
        updateOrder(await api.get(reviewed.id))
      } catch {
        // Keep the current view when even a refresh is unavailable.
      }
    } finally {
      setPayBusy(false)
    }
  }

  async function retryPendingSubmission() {
    if (!reviewed || !pendingTxHash || payBusy) return
    setPayBusy(true)
    setActionError(null)
    try {
      const submitted = await submitWithRetry(reviewed.id, pendingTxHash)
      setPendingTxHash(null)
      updateOrder(submitted)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Submission did not complete. Your transaction reference is kept above.')
    } finally {
      setPayBusy(false)
    }
  }

  function openCashoutForm() {
    setCashoutAmount('')
    setCashoutBank('')
    setCashoutAccount('')
    setVerifiedAccount(null)
    setRatePreview(null)
    setBanksError(null)
    setActionError(null)
    setPendingTxHash(null)
    setView({ name: 'cashout-form' })
    void loadCashoutBanks()
  }

  async function loadCashoutBanks() {
    setBanksLoading(true)
    setBanksError(null)
    try {
      setCashoutBanks(await api.listCashoutBanks())
    } catch (error) {
      setCashoutBanks([])
      setBanksError(error instanceof Error ? error.message : 'Munus could not load the bank list.')
    } finally {
      setBanksLoading(false)
    }
  }

  async function previewCashoutRate() {
    if (!cashoutAmount.trim()) return
    setRateLoading(true)
    setActionError(null)
    try {
      setRatePreview(await api.previewCashoutRate(cashoutAmount))
    } catch (error) {
      setRatePreview(null)
      setActionError(error instanceof Error ? error.message : 'Munus could not preview the payout rate.')
    } finally {
      setRateLoading(false)
    }
  }

  async function verifyCashoutAccount() {
    if (!cashoutBank || !cashoutAccount.trim()) return
    setVerifying(true)
    setActionError(null)
    try {
      // The server pins the canonical account name: the client can never
      // override it, and an unverifiable account stops the flow here.
      setVerifiedAccount(await api.verifyCashoutAccount({ institution: cashoutBank, accountNumber: cashoutAccount }))
    } catch (error) {
      setVerifiedAccount(null)
      setActionError(error instanceof Error ? error.message : 'Munus could not verify this account.')
    } finally {
      setVerifying(false)
    }
  }

  async function saveCashoutOrder() {
    if (!verifiedAccount || !cashoutAmount.trim()) return
    setSaving(true)
    setActionError(null)
    try {
      const order = await api.createCashoutOrder({
        usdtAmount: cashoutAmount,
        bankCode: verifiedAccount.bankCode,
        accountNumber: verifiedAccount.accountNumber,
      })
      setOrders((current) => [order, ...current.filter((entry) => entry.id !== order.id)])
      try {
        updateOrder(await api.createCashoutQuote(order.id))
      } catch {
        // A quote failure leaves the saved draft in review, where the user
        // can request payout details explicitly.
      }
      setView({ name: 'review', orderId: order.id })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Munus could not save this cash-out order.')
    } finally {
      setSaving(false)
    }
  }

  async function createCashoutQuote(orderId: string) {
    setQuoting(true)
    setActionError(null)
    try {
      updateOrder(await api.createCashoutQuote(orderId))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Munus could not create payout details.')
    } finally {
      setQuoting(false)
    }
  }

  async function refreshCashoutQuote(orderId: string) {
    setQuoting(true)
    setActionError(null)
    try {
      updateOrder(await api.refreshCashoutQuote(orderId))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Munus could not refresh the payout details.')
    } finally {
      setQuoting(false)
    }
  }

  async function refreshCashoutPayment(orderId: string) {
    setRefreshing(true)
    setActionError(null)
    try {
      updateOrder(await api.reconcileCashoutOrder(orderId))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Munus could not refresh this payout.')
    } finally {
      setRefreshing(false)
    }
  }

  async function submitCashoutWithRetry(orderId: string, txHash: string): Promise<PaymentOrder> {
    try {
      return await api.submitCashoutPayment(orderId, txHash)
    } catch (error) {
      // Same-hash submission is idempotent: one automatic retry covers a
      // dropped response without ever risking a second transfer.
      return await api.submitCashoutPayment(orderId, txHash).catch(() => {
        throw error
      })
    }
  }

  async function payWithUsdt() {
    if (!reviewed || payBusy) return
    setPayBusy(true)
    setActionError(null)
    try {
      // Explicit user intent only: the wallet is contacted solely from this
      // tap, with the exact server-signed total on Polygon.
      const { order: intentOrder, intent } = await api.createCashoutIntent(reviewed.id)
      updateOrder(intentOrder)
      const txHash = await requestUsdtTransfer(intent)
      setPendingTxHash(txHash)
      const submitted = await submitCashoutWithRetry(reviewed.id, txHash)
      setPendingTxHash(null)
      updateOrder(submitted)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'USDT transfer did not complete. No payment was confirmed.')
      try {
        updateOrder(await api.get(reviewed.id))
      } catch {
        // Keep the current view when even a refresh is unavailable.
      }
    } finally {
      setPayBusy(false)
    }
  }

  async function retryPendingCashoutSubmission() {
    if (!reviewed || !pendingTxHash || payBusy) return
    setPayBusy(true)
    setActionError(null)
    try {
      const submitted = await submitCashoutWithRetry(reviewed.id, pendingTxHash)
      setPendingTxHash(null)
      updateOrder(submitted)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Submission did not complete. Your transaction reference is kept above.')
    } finally {
      setPayBusy(false)
    }
  }

  return (
    <section className="screen-content" aria-labelledby="pay-title">
      {view.name === 'airtime-form' ? (
        <section className="support-section planning-form" aria-labelledby="pay-title">
          <button className="back-link" type="button" onClick={() => setView({ name: 'categories' })}>
            <Icon name="back" size={18} /> Pay Essentials
          </button>
          <p className="eyebrow">Airtime order</p>
          <h1 id="pay-title">Top up airtime</h1>
          <p className="screen-lede">Save the top-up as a Munus order first, then get a live NIM quote for it.</p>
          <RailNotice capability={readiness?.rails.airtime} label="Airtime" />
          <div className="form-grid">
            <label>
              <span>Recipient phone</span>
              <input
                autoComplete="tel"
                inputMode="tel"
                value={draft.recipientPhone}
                onChange={(event) => setDraft({ ...draft, recipientPhone: event.target.value })}
                placeholder="08012345678"
              />
            </label>
            <label>
              <span>Network</span>
              <select
                value={draft.recipientNetwork}
                onChange={(event) => setDraft({ ...draft, recipientNetwork: event.target.value as PaymentOrderDraft['recipientNetwork'] })}
              >
                <option value="">Not known</option>
                {SUPPORT_NETWORKS.map((network) => <option key={network} value={network}>{network}</option>)}
              </select>
            </label>
            <label>
              <span>Amount (₦)</span>
              <input
                inputMode="decimal"
                value={draft.requestedAmount}
                onChange={(event) => setDraft({ ...draft, requestedAmount: event.target.value })}
                placeholder="1000"
              />
            </label>
            <label>
              <span>Pay with</span>
              <select value={draft.paymentAsset} disabled aria-label="Pay with">
                <option value="NIM">NIM</option>
              </select>
            </label>
          </div>
          {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          <AirtimeEstimatePanel
            amount={draft.requestedAmount}
            rate={formRate}
            rateLoading={formRateLoading}
            funding={funding ?? null}
            onRetryRate={() => void loadFormRate()}
          />
          <div className="truth-note"><Icon name="info" size={18} /><p>This saves the order only — no money moves until you review a live quote and approve it in Nimiq Pay.</p></div>
          <PrimaryButton disabled={saving || railStatus('airtime') === 'unavailable'} onClick={() => void saveAirtimeOrder()}>
            {saving ? 'Saving order…' : 'Review airtime order'}
          </PrimaryButton>
        </section>
      ) : view.name === 'data-form' ? (
        <section className="support-section planning-form" aria-labelledby="pay-title">
          <button className="back-link" type="button" onClick={() => setView({ name: 'categories' })}>
            <Icon name="back" size={18} /> Pay Essentials
          </button>
          <p className="eyebrow">Data order</p>
          <h1 id="pay-title">Buy data</h1>
          <p className="screen-lede">Pick a current network bundle. The price comes from the live catalog — never typed in.</p>
          <RailNotice capability={readiness?.rails.data} label="Data" />
          <div className="form-grid">
            <label>
              <span>Network</span>
              <select
                value={dataNetwork}
                onChange={(event) => chooseDataNetwork(event.target.value as PaymentOrderDraft['recipientNetwork'])}
              >
                <option value="">Choose network</option>
                {SUPPORT_NETWORKS.map((network) => <option key={network} value={network}>{network}</option>)}
              </select>
            </label>
            <label>
              <span>Recipient phone</span>
              <input
                autoComplete="tel"
                inputMode="tel"
                value={dataPhone}
                onChange={(event) => setDataPhone(event.target.value)}
                placeholder="08012345678"
              />
            </label>
          </div>
          {dataNetwork ? (
            <section aria-label="Data bundles">
              <SectionHeading>Current bundles</SectionHeading>
              {plansLoading ? <p role="status">Loading bundles…</p> : null}
              {plansError ? <p className="inline-error" role="alert">{plansError}</p> : null}
              {!plansLoading && !plansError && dataPlans.length === 0 ? (
                <p className="section-copy">No bundles right now. Try another network.</p>
              ) : null}
              <div className="category-list">
                {dataPlans.map((plan) => {
                  const selected = plan.providerPlanId === selectedPlanId
                  const details = [
                    plan.dataAllowance,
                    plan.validity,
                    `₦${plan.localPriceNgn}`,
                  ].filter(Boolean).join(' · ')
                  return (
                    <ListRow
                      description={details}
                      icon="data"
                      key={plan.providerPlanId}
                      meta={<StatusPill label={selected ? 'Selected' : `₦${plan.localPriceNgn}`} tone={selected ? 'ready' : 'quiet'} />}
                      onClick={() => setSelectedPlanId(plan.providerPlanId)}
                      title={plan.displayName}
                    />
                  )
                })}
              </div>
            </section>
          ) : null}
          {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          <div className="truth-note"><Icon name="info" size={18} /><p>This saves the order at the catalog price only — no money moves until you review a live quote and approve it in Nimiq Pay.</p></div>
          <PrimaryButton disabled={saving || !selectedPlanId || !dataPhone.trim() || railStatus('data') === 'unavailable'} onClick={() => void saveDataOrder()}>
            {saving ? 'Saving order…' : 'Review data order'}
          </PrimaryButton>
        </section>
      ) : view.name === 'cashout-form' ? (
        <section className="support-section planning-form" aria-labelledby="pay-title">
          <button className="back-link" type="button" onClick={() => setView({ name: 'categories' })}>
            <Icon name="back" size={18} /> Pay Essentials
          </button>
          <p className="eyebrow">Cash out</p>
          <h1 id="pay-title">Cash out USDT</h1>
          <p className="screen-lede">Send USDT on Polygon and receive naira in a verified Nigerian bank account. Nothing moves until you approve the exact total in your wallet.</p>
          <RailNotice capability={readiness?.rails.cashout} label="Cash out" />
          <div className="form-grid">
            <label>
              <span>Amount (USDT)</span>
              <input
                inputMode="decimal"
                value={cashoutAmount}
                onChange={(event) => { setCashoutAmount(event.target.value); setRatePreview(null); setVerifiedAccount(null) }}
                placeholder="100"
              />
            </label>
            <label>
              <span>Bank</span>
              <select
                value={cashoutBank}
                onChange={(event) => { setCashoutBank(event.target.value); setVerifiedAccount(null) }}
                disabled={banksLoading || cashoutBanks.length === 0}
              >
                <option value="">{banksLoading ? 'Loading banks…' : 'Choose bank'}</option>
                {cashoutBanks.map((bank) => <option key={bank.code} value={bank.code}>{bank.name}</option>)}
              </select>
            </label>
            <label>
              <span>Account number</span>
              <input
                autoComplete="off"
                inputMode="numeric"
                value={cashoutAccount}
                onChange={(event) => { setCashoutAccount(event.target.value); setVerifiedAccount(null) }}
                placeholder="0123456789"
              />
            </label>
          </div>
          {banksError ? <p className="inline-error" role="alert">{banksError}</p> : null}
          {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          <div className="form-actions">
            <QuietButton disabled={rateLoading || !cashoutAmount.trim()} onClick={() => void previewCashoutRate()}>
              {rateLoading ? 'Checking rate…' : 'Check rate'}
            </QuietButton>
            <QuietButton disabled={verifying || !cashoutBank || !cashoutAccount.trim()} onClick={() => void verifyCashoutAccount()}>
              {verifying ? 'Verifying…' : 'Verify account'}
            </QuietButton>
          </div>
          {ratePreview ? (
            <dl className="contact-details">
              <div><dt>Rate</dt><dd>1 USDT ≈ ₦{ratePreview.rateNgnPerUsdt}</dd></div>
              <div><dt>Indicative payout</dt><dd>₦{ratePreview.ngnAmount}</dd></div>
            </dl>
          ) : null}
          {verifiedAccount ? (
            <div className="truth-note"><Icon name="info" size={18} /><p>Verified account: {verifiedAccount.accountName} · {verifiedAccount.bankName} {maskBankAccountNumber(verifiedAccount.accountNumber)}. The exact USDT total and payout are set by live payout details on the next step.</p></div>
          ) : null}
          <div className="truth-note"><Icon name="info" size={18} /><p>This saves the order only — no money moves until you review live payout details and approve the exact USDT total in your wallet.</p></div>
          <PrimaryButton disabled={saving || !verifiedAccount || !cashoutAmount.trim() || railStatus('cashout') === 'unavailable'} onClick={() => void saveCashoutOrder()}>
            {saving ? 'Saving order…' : 'Review payout'}
          </PrimaryButton>
        </section>
      ) : view.name === 'review' && reviewed ? (
        <section aria-labelledby="pay-title">
          <button className="back-link" type="button" onClick={() => setView({ name: 'categories' })}>
            <Icon name="back" size={18} /> Pay Essentials
          </button>
          <p className="eyebrow">Order review</p>
          <h1 id="pay-title">{reviewed.serviceType === 'CASH_OUT'
            ? `${reviewed.usdtTotalAmount ?? reviewed.requestedAmount} USDT cash out`
            : `₦${reviewed.requestedAmount} ${describeServiceLabel(reviewed.serviceType).toLowerCase()}`}</h1>
          <p className="screen-lede">{describeOrderStage(reviewed)}</p>
          <RailNotice capability={readiness?.rails[railForService(reviewed.serviceType)]} label={railLabel(railForService(reviewed.serviceType))} />
          {(() => {
            // Shared source-of-funds card for NIM rails. Amounts deducted
            // come only from the authoritative server quote; projections
            // stay conditional because Nimiq Pay chooses the debit account.
            // The confirmed aggregate across exposed accounts takes
            // precedence when ready; otherwise the single-wallet view.
            if (!reviewedIsNim) return null
            const aggregateBasis = funding?.nim ? { luna: funding.luna, nim: funding.nim, network: funding.network } : null
            const balanceResult = mapNimBalance(wallet)
            const estimate = reviewRate?.status === 'available' ? estimateNgn(balanceResult, reviewRate, nowMs) : null
            const fundingView = aggregateBasis
              ? buildAggregateFundingView({
                nim: aggregateBasis.nim,
                estimateNgn: reviewRate?.status === 'available'
                  ? estimateNgn({
                    status: 'available',
                    asset: 'NIM',
                    amount: aggregateBasis.nim,
                    network: aggregateBasis.network,
                    environment: aggregateBasis.network,
                    observedAt: Date.now(),
                    source: 'rpc',
                  }, reviewRate, nowMs)
                  : null,
                network: aggregateBasis.network,
              })
              : buildNimFundingView({
                balance: balanceResult,
                estimateNgn: estimate,
                connectionReady: connection.status === 'ready',
                walletNetwork: wallet.network,
                hideAmounts: false,
                fallbackNetwork,
              })
            let deduction: FundingDeduction | null = null
            const pending = reviewed.paymentStatus === 'ONCHAIN_PENDING' || pendingTxHash !== null
            const payable = reviewed.paymentStatus === 'READY_FOR_PAYMENT' || reviewed.paymentStatus === 'AWAITING_WALLET_APPROVAL'
            const basisLuna = aggregateBasis?.luna ?? (wallet.lunaBalance !== undefined ? String(wallet.lunaBalance) : undefined)
            const basisNim = aggregateBasis?.nim ?? wallet.nimBalance
            if ((pending || (payable && quoteLive)) && reviewed.quotedCryptoAmount && reviewed.quoteLunaAmount && basisLuna !== undefined && basisNim !== undefined) {
              const preview = buildFundingPreview(basisLuna, basisNim, reviewed.quoteLunaAmount, reviewed.quotedCryptoAmount)
              if (preview) {
                deduction = {
                  preview,
                  targetLabel: `₦${reviewed.requestedAmount} ${describeServiceLabel(reviewed.serviceType)}`,
                  mode: pending ? 'pending' : 'preview',
                  context: aggregateBasis ? 'aggregate' : 'wallet',
                }
              }
            }
            return (
              <NimFundingCard
                view={fundingView}
                deduction={deduction}
                balanceNote={reviewed.paymentStatus === 'PAID' && balanceRefreshFailed ? 'Balance refresh unavailable — payment remains confirmed.' : null}
              />
            )
          })()}
          <dl className="contact-details">
            {reviewed.serviceType === 'CASH_OUT' ? (
              <>
                <div><dt>Bank</dt><dd>{reviewed.bankName ?? reviewed.bankCode ?? '—'}</dd></div>
                <div><dt>Account</dt><dd>{maskBankAccountNumber(reviewed.bankAccountNumber ?? '')}</dd></div>
                {reviewed.bankAccountName ? <div><dt>Account name</dt><dd>{reviewed.bankAccountName}</dd></div> : null}
                <div><dt>Amount</dt><dd>{reviewed.requestedAmount} USDT</dd></div>
              </>
            ) : (
              <>
                <div><dt>Recipient</dt><dd>{maskPhone(reviewed.recipientPhone ?? '')}</dd></div>
                <div><dt>Network</dt><dd>{reviewed.recipientNetwork ?? 'Not known'}</dd></div>
                <div><dt>Amount</dt><dd>₦{reviewed.requestedAmount}</dd></div>
              </>
            )}
            {reviewed.planDisplayLabel ? <div><dt>Bundle</dt><dd>{reviewed.planDisplayLabel}</dd></div> : null}
            {reviewed.planDataAllowance ? <div><dt>Data allowance</dt><dd>{reviewed.planDataAllowance}</dd></div> : null}
            {reviewed.planValidity ? <div><dt>Validity</dt><dd>{reviewed.planValidity}</dd></div> : null}
            <div><dt>Pay with</dt><dd>{reviewed.paymentAsset}</dd></div>
            <div><dt>Payment</dt><dd><PaymentStageLabel order={reviewed} /></dd></div>
            <div><dt>Fulfilment</dt><dd>{describeFulfilmentStage(reviewed.fulfilmentStatus)}</dd></div>
            {reviewed.serviceType === 'CASH_OUT' ? (
              <>
                {reviewed.usdtTotalAmount ? <div><dt>You pay</dt><dd>{reviewed.usdtTotalAmount} USDT</dd></div> : null}
                {reviewed.cashoutFeeUsdt ? <div><dt>Provider fees</dt><dd>{reviewed.cashoutFeeUsdt} USDT</dd></div> : null}
                {reviewed.payoutNgnAmount ? <div><dt>You receive</dt><dd>₦{reviewed.payoutNgnAmount}</dd></div> : null}
                {reviewed.cashoutRate ? <div><dt>Rate</dt><dd>1 USDT ≈ ₦{reviewed.cashoutRate}</dd></div> : null}
              </>
            ) : (
              <>
                {reviewed.quotedCryptoAmount ? <div><dt>You pay</dt><dd>{reviewed.quotedCryptoAmount} NIM</dd></div> : null}
                {reviewed.quoteRateNgnPerNim ? <div><dt>Rate</dt><dd>1 NIM ≈ ₦{reviewed.quoteRateNgnPerNim}</dd></div> : null}
              </>
            )}
            {reviewed.paymentReceiver ? <div><dt>Paid to</dt><dd>{shortenNimiqAccount(reviewed.paymentReceiver)}</dd></div> : null}
            {reviewed.paymentSender ? <div><dt>Paid by</dt><dd>{shortenNimiqAccount(reviewed.paymentSender)}</dd></div> : null}
            {reviewed.paymentBlockNumber ? <div><dt>Confirmed in block</dt><dd>{reviewed.paymentBlockNumber}</dd></div> : null}
            {reviewed.provider ? <div><dt>Provider</dt><dd>{describeProviderName(reviewed.provider)}</dd></div> : null}
            {reviewed.providerRef ? <div><dt>Provider reference</dt><dd>{reviewed.providerRef}</dd></div> : null}
            {reviewed.providerStatus ? <div><dt>Provider status</dt><dd>{reviewed.providerStatus} ({reviewed.providerStatusCode ?? 'no code'})</dd></div> : null}
            {reviewed.providerAmountCharged ? <div><dt>Amount charged</dt><dd>₦{reviewed.providerAmountCharged}</dd></div> : null}
            <div><dt>Saved</dt><dd>{new Date(reviewed.createdAt).toLocaleString()}</dd></div>
          </dl>
          {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          {(() => {
            const recovery = buildRecoveryState(reviewed)
            if (recovery && (recovery.kind === 'attention' || recovery.kind === 'failed')) {
              return (
                <RecoveryCenter
                  order={reviewed}
                  onRefresh={refreshRecoveryOrder}
                  onRetry={retryRecoveryOrder}
                  onBack={() => setView({ name: 'categories' })}
                  onResolved={updateOrder}
                />
              )
            }
            if (reviewed.serviceType === 'CASH_OUT') {
              return (
                <CashoutReviewActions
                  order={reviewed}
                  quoteLive={quoteLive}
                  nowMs={nowMs}
                  quoting={quoting}
                  payBusy={payBusy}
                  refreshing={refreshing}
                  pendingTxHash={pendingTxHash}
                  railBlocked={railStatus('cashout') === 'unavailable'}
                  onCreateQuote={() => void createCashoutQuote(reviewed.id)}
                  onRefreshQuote={() => void refreshCashoutQuote(reviewed.id)}
                  onPay={() => void payWithUsdt()}
                  onRetrySubmission={() => void retryPendingCashoutSubmission()}
                  onRefresh={() => void refreshOrder(reviewed.id, 'get')}
                  onRefreshPayment={() => void refreshCashoutPayment(reviewed.id)}
                />
              )
            }
            return (
              <ReviewActions
                order={reviewed}
                quoteLive={quoteLive}
                nowMs={nowMs}
                quoting={quoting}
                payBusy={payBusy}
                refreshing={refreshing}
                pendingTxHash={pendingTxHash}
                railBlocked={railStatus(railForService(reviewed.serviceType)) === 'unavailable'}
                onCreateQuote={() => void createQuote(reviewed.id)}
                onPay={() => void payWithNim()}
                onRetrySubmission={() => void retryPendingSubmission()}
                onRefresh={() => void refreshOrder(reviewed.id, 'get')}
                onRefreshPayment={() => void refreshOrder(reviewed.id, 'reconcile')}
              />
            )
          })()}
          <div className="form-actions">
            <QuietButton onClick={() => setView({ name: 'categories' })}>Back to Pay</QuietButton>
            <QuietButton onClick={openAirtimeForm}>New airtime order</QuietButton>
          </div>
        </section>
      ) : (
        <>
          <section className="screen-intro">
            <p className="eyebrow">Everyday essentials</p>
            <h1 id="pay-title">Pay Essentials</h1>
            <p>Start with airtime or data. Munus saves a real order, quotes live NIM, and delivers after on-chain confirmation.</p>
          </section>
          {loadError ? <p className="inline-error" role="alert">{loadError}</p> : null}
          {readiness && (['airtime', 'data', 'cashout'] as const).some((rail) => readiness.rails[rail].status !== 'verified') ? (
            <div className="truth-note"><Icon name="info" size={18} /><p>
              Availability —
              {(['airtime', 'data', 'cashout'] as const).map((rail) => ` ${railLabel(rail)}: ${readiness.rails[rail].status === 'verified' ? 'live' : readiness.rails[rail].reason}`).join(' · ')}
            </p></div>
          ) : null}
          <section aria-label="Essential categories" className="category-list">
            {ESSENTIAL_CATEGORIES.map((category) => {
              if (category.id === 'airtime') {
                if (railStatus('airtime') === 'unavailable') {
                  return (
                    <ListRow
                      description={readiness?.rails.airtime.reason ?? 'Not available.'}
                      disabled
                      icon={icons[category.id]}
                      key={category.id}
                      meta={<StatusPill label="Not available" />}
                      title={category.name}
                    />
                  )
                }
                return (
                  <ListRow
                    description="Save a top-up order with a phone number and amount."
                    icon={icons[category.id]}
                    key={category.id}
                    meta={<StatusPill label="Start order" tone="ready" />}
                    onClick={openAirtimeForm}
                    title={category.name}
                  />
                )
              }
              if (category.id === 'data') {
                if (railStatus('data') === 'unavailable') {
                  return (
                    <ListRow
                      description={readiness?.rails.data.reason ?? 'Not available.'}
                      disabled
                      icon={icons[category.id]}
                      key={category.id}
                      meta={<StatusPill label="Not available" />}
                      title={category.name}
                    />
                  )
                }
                return (
                  <ListRow
                    description="Buy a current network bundle at the live catalog price."
                    icon={icons[category.id]}
                    key={category.id}
                    meta={<StatusPill label="Start order" tone="ready" />}
                    onClick={openDataForm}
                    title={category.name}
                  />
                )
              }
              return (
                <ListRow
                  description={category.description}
                  disabled
                  icon={icons[category.id]}
                  key={category.id}
                  meta={<StatusPill label={category.availability === 'next' ? 'Coming next' : 'Not live'} />}
                  title={category.name}
                />
              )
            })}
            {railStatus('cashout') === 'unavailable' ? (
              <ListRow
                description={readiness?.rails.cashout.reason ?? 'Not available.'}
                disabled
                icon="wallet"
                key="cashout"
                meta={<StatusPill label="Not available" />}
                title="Cash out"
              />
            ) : (
              <ListRow
                description="Send USDT on Polygon and receive naira in a verified Nigerian bank account."
                icon="wallet"
                key="cashout"
                meta={<StatusPill label="Start cash out" tone="ready" />}
                onClick={openCashoutForm}
                title="Cash out"
              />
            )}
          </section>
          <section aria-label="Your recent orders" className="support-section">
            <SectionHeading>Your recent orders</SectionHeading>
            {loading ? <p role="status">Loading your orders…</p> : null}
            {!loading && orders.length === 0 ? (
              <p className="section-copy">No orders yet. Start one above — it saves as a draft with no payment attached.</p>
            ) : null}
            <div className="category-list">
              {orders.slice(0, 5).map((order) => {
                const isCashout = order.serviceType === 'CASH_OUT'
                return (
                  <ListRow
                    description={isCashout
                      ? [order.bankName, maskBankAccountNumber(order.bankAccountNumber ?? ''), new Date(order.createdAt).toLocaleDateString()].filter(Boolean).join(' · ')
                      : `${maskPhone(order.recipientPhone ?? '')} · ${new Date(order.createdAt).toLocaleDateString()}`}
                    icon={order.serviceType === 'DATA' ? 'data' : isCashout ? 'wallet' : 'phone'}
                    key={order.id}
                    meta={<OrderStatusPill order={order} />}
                    onClick={() => setView({ name: 'review', orderId: order.id })}
                    title={isCashout
                      ? `${order.usdtTotalAmount ?? order.requestedAmount} USDT cash out`
                      : `₦${order.requestedAmount} ${describeServiceLabel(order.serviceType).toLowerCase()}`}
                  />
                )
              })}
            </div>
          </section>
          <div className="truth-note"><p>Airtime and data are bought from Munus with NIM and delivered through the provider rail. NIM never goes to the provider.</p></div>
        </>
      )}
    </section>
  )
}

function OrderStatusPill({ order }: { order: PaymentOrder }) {
  const copy = describeActivityStatusCopy(describeActivityStatus(order), order.serviceType)
  return <StatusPill label={copy.label} tone={copy.tone} />
}

/**
 * Informational pre-quote conversion on the Airtime form. Pure estimate
 * from the indicative rate — never payment authority and never a reason
 * to disable anything: the server quote alone decides the payment.
 */
function AirtimeEstimatePanel({ amount, rate, rateLoading, funding, onRetryRate }: {
  amount: string
  rate: NgnQuoteResult | null
  rateLoading: boolean
  funding?: { luna: string; nim: string; network: 'mainnet' | 'testnet' } | null
  onRetryRate: () => void
}) {
  const trimmed = amount.trim()
  const positive = /^\d+(?:\.\d+)?$/.test(trimmed) && Number(trimmed) > 0
  if (!positive) return null
  if (rateLoading && !rate) {
    return <p className="section-copy" role="status">Checking current rate…</p>
  }
  if (!rate || rate.status !== 'available') {
    return (
      <>
        <p className="section-copy">NIM rate unavailable — the estimate cannot load right now.</p>
        <QuietButton disabled={rateLoading} onClick={onRetryRate}>
          {rateLoading ? 'Checking…' : 'Check again'}
        </QuietButton>
      </>
    )
  }
  const estimate = estimateNimFromNgn(trimmed, rate.ngnPerUnit)
  if (!estimate) return null
  let shortfall: string | null = null
  try {
    if (funding && BigInt(estimate.luna) > BigInt(funding.luna)) {
      const gap = BigInt(estimate.luna) - BigInt(funding.luna)
      shortfall = gap.toString()
    }
  } catch {
    shortfall = null
  }
  return (
    <section aria-label="Estimated payment" className="receipt-section">
      <SectionHeading>Estimated payment</SectionHeading>
      <dl className="contact-details">
        <div><dt>Airtime</dt><dd>₦{trimmed}</dd></div>
        <div><dt>Rate</dt><dd>1 NIM ≈ ₦{rate.ngnPerUnit}</dd></div>
        <div><dt>You pay about</dt><dd>≈ {estimate.nim} NIM</dd></div>
        {funding ? <div><dt>Available in Nimiq Pay</dt><dd>{funding.nim} NIM</dd></div> : null}
      </dl>
      {shortfall !== null ? (
        <div className="truth-note"><Icon name="info" size={18} /><p>Estimated amount is higher than your current Nimiq Pay balance. Nimiq Pay still chooses the paying account — this never blocks continuing.</p></div>
      ) : null}
      <p className="section-copy">Estimate only. The final NIM amount is locked when you continue.</p>
    </section>
  )
}

function PaymentStageLabel({ order }: { order: PaymentOrder }) {
  const isCashout = order.serviceType === 'CASH_OUT'
  switch (order.paymentStatus) {
    case 'DRAFT': return isCashout ? <>Draft · payout details not created</> : <>Draft · quote not created</>
    case 'READY_FOR_PAYMENT': return <>Quoted · waiting for your approval</>
    case 'AWAITING_WALLET_APPROVAL': return isCashout ? <>Waiting for wallet approval</> : <>Waiting for Nimiq Pay approval</>
    case 'ONCHAIN_PENDING': return <>Submitted · confirming on-chain</>
    case 'PAID': return <>Confirmed on-chain</>
    case 'PAYMENT_FAILED': return isCashout ? <>Failed · payout not started</> : <>Failed · no {serviceNoun(order).toLowerCase()} sent</>
    default: return <>{order.paymentStatus}</>
  }
}

function CashoutReviewActions({ order, quoteLive, nowMs, quoting, payBusy, refreshing, pendingTxHash, railBlocked, onCreateQuote, onRefreshQuote, onPay, onRetrySubmission, onRefresh, onRefreshPayment }: {
  order: PaymentOrder
  quoteLive: boolean
  nowMs: number
  quoting: boolean
  payBusy: boolean
  refreshing: boolean
  pendingTxHash: string | null
  railBlocked: boolean
  onCreateQuote: () => void
  onRefreshQuote: () => void
  onPay: () => void
  onRetrySubmission: () => void
  onRefresh: () => void
  onRefreshPayment: () => void
}) {
  if (order.paymentStatus === 'DRAFT') {
    return (
      <>
        <div className="truth-note"><Icon name="info" size={18} /><p>Get live payout details to see the exact USDT total and the naira you will receive.</p></div>
        <PrimaryButton disabled={quoting || railBlocked} onClick={onCreateQuote}>
          {quoting ? 'Getting payout details…' : 'Get payout details'}
        </PrimaryButton>
      </>
    )
  }

  if (order.paymentStatus === 'READY_FOR_PAYMENT' || order.paymentStatus === 'AWAITING_WALLET_APPROVAL') {
    if (!quoteLive) {
      // Expired payout details are never payable: a refresh abandons the
      // old Paycrest order and issues new ones.
      return (
        <>
          <div className="truth-note"><Icon name="info" size={18} /><p>These payout details have expired. The amounts you saw are no longer valid — refresh them before sending anything.</p></div>
          <PrimaryButton disabled={quoting} onClick={onRefreshQuote}>
            {quoting ? 'Refreshing…' : 'Refresh payout details'}
          </PrimaryButton>
        </>
      )
    }
    return (
      <>
        <div className="truth-note"><Icon name="info" size={18} /><p>Payout details expire in {order.quoteExpiresAt ? quoteCountdown(order.quoteExpiresAt, nowMs) : '—'}. Only this tap opens your wallet — nothing happens automatically, and only the exact total below is ever sent.</p></div>
        {order.paymentStatus === 'AWAITING_WALLET_APPROVAL' ? (
          <div className="truth-note"><Icon name="info" size={18} /><p>Waiting for wallet approval. If you dismissed it, tap again to continue.</p></div>
        ) : null}
        <PrimaryButton disabled={payBusy} onClick={onPay}>
          {payBusy ? 'Opening wallet…' : `Approve ${order.usdtTotalAmount ?? order.quotedCryptoAmount} USDT`}
        </PrimaryButton>
      </>
    )
  }

  if (order.paymentStatus === 'ONCHAIN_PENDING') {
    return (
      <>
        <div className="truth-note"><Icon name="info" size={18} /><p>
          {pendingTxHash ? 'Your transfer was sent. Recording it with Munus was interrupted — retry below.' : 'Your USDT transfer was submitted. Munus tracks the Paycrest payout from here.'}
        </p></div>
        {pendingTxHash ? (
          <>
            <p className="section-copy">Reference: {shortenNimiqAccount(pendingTxHash)}</p>
            <PrimaryButton disabled={payBusy} onClick={onRetrySubmission}>
              {payBusy ? 'Recording…' : 'Retry recording transfer'}
            </PrimaryButton>
          </>
        ) : null}
        <QuietButton disabled={refreshing} onClick={onRefreshPayment}>
          {refreshing ? 'Checking…' : 'Refresh payout status'}
        </QuietButton>
      </>
    )
  }

  if (order.paymentStatus === 'PAID') {
    const needsAttention = order.fulfilmentStatus === 'FULFILLMENT_FAILED' || order.fulfilmentStatus === 'RECOVERY_REQUIRED'
    return (
      <>
        <ol className="payment-progress">
          <li data-done="true">Payout details ready</li>
          <li data-done="true">Wallet approval</li>
          <li data-done="true">USDT transfer confirmed</li>
          <li data-done={order.fulfilmentStatus === 'DELIVERED' ? 'true' : 'false'}>
            {order.fulfilmentStatus === 'DELIVERED' ? 'Payout settled' : 'Settling payout'}
          </li>
        </ol>
        {needsAttention ? (
          <div className="truth-note"><Icon name="info" size={18} /><p>Transfer confirmed · payout needs attention. Your USDT transfer is safe and recorded.</p></div>
        ) : null}
        {order.fulfilmentStatus === 'FULFILLING' || order.fulfilmentStatus === 'NOT_STARTED' ? (
          <QuietButton disabled={refreshing} onClick={onRefresh}>
            {refreshing ? 'Checking…' : 'Refresh payout status'}
          </QuietButton>
        ) : null}
      </>
    )
  }

  return (
    <>
      <div className="truth-note"><Icon name="info" size={18} /><p>{describePaymentFailureReason(order.paymentFailureReason)}</p></div>
      <QuietButton disabled={refreshing} onClick={onRefresh}>
        {refreshing ? 'Checking…' : 'Refresh payout status'}
      </QuietButton>
    </>
  )
}

function quoteCountdown(expiresAt: string, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.parse(expiresAt) - nowMs) / 1000))
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
}

function ReviewActions({ order, quoteLive, nowMs, quoting, payBusy, refreshing, pendingTxHash, railBlocked, onCreateQuote, onPay, onRetrySubmission, onRefresh, onRefreshPayment }: {
  order: PaymentOrder
  quoteLive: boolean
  nowMs: number
  quoting: boolean
  payBusy: boolean
  refreshing: boolean
  pendingTxHash: string | null
  railBlocked: boolean
  onCreateQuote: () => void
  onPay: () => void
  onRetrySubmission: () => void
  onRefresh: () => void
  onRefreshPayment: () => void
}) {
  if (order.paymentStatus === 'DRAFT') {
    return (
      <>
        <div className="truth-note"><Icon name="info" size={18} /><p>Get a live NIM quote to see exactly what this {serviceNoun(order).toLowerCase()} costs right now.</p></div>
        <PrimaryButton disabled={quoting || railBlocked} onClick={onCreateQuote}>
          {quoting ? 'Getting quote…' : 'Get NIM quote'}
        </PrimaryButton>
      </>
    )
  }

  if (order.paymentStatus === 'READY_FOR_PAYMENT' || order.paymentStatus === 'AWAITING_WALLET_APPROVAL') {
    if (!quoteLive) {
      return (
        <>
          <div className="truth-note"><Icon name="info" size={18} /><p>This quote has expired. The amount you saw is no longer valid — get a fresh one before paying.</p></div>
          <PrimaryButton disabled={quoting} onClick={onCreateQuote}>
            {quoting ? 'Getting quote…' : 'Get fresh quote'}
          </PrimaryButton>
        </>
      )
    }
    return (
      <>
        <div className="truth-note"><Icon name="info" size={18} /><p>Quote expires in {order.quoteExpiresAt ? quoteCountdown(order.quoteExpiresAt, nowMs) : '—'}. Only this tap opens Nimiq Pay — nothing happens automatically.</p></div>
        {order.paymentStatus === 'AWAITING_WALLET_APPROVAL' ? (
          <div className="truth-note"><Icon name="info" size={18} /><p>Waiting for Nimiq Pay approval. If you dismissed it, tap again to continue.</p></div>
        ) : null}
        <PrimaryButton disabled={payBusy} onClick={onPay}>
          {payBusy ? 'Opening Nimiq Pay…' : `Pay ${order.quotedCryptoAmount} NIM`}
        </PrimaryButton>
      </>
    )
  }

  if (order.paymentStatus === 'ONCHAIN_PENDING') {
    return (
      <>
        <div className="truth-note"><Icon name="info" size={18} /><p>
          {pendingTxHash ? 'Your transaction was sent. Recording it with Munus was interrupted — retry below.' : 'Your transaction was submitted. Munus is confirming it on-chain independently.'}
        </p></div>
        {pendingTxHash ? (
          <>
            <p className="section-copy">Reference: {shortenNimiqAccount(pendingTxHash)}</p>
            <PrimaryButton disabled={payBusy} onClick={onRetrySubmission}>
              {payBusy ? 'Recording…' : 'Retry recording payment'}
            </PrimaryButton>
          </>
        ) : null}
        <QuietButton disabled={refreshing} onClick={onRefreshPayment}>
          {refreshing ? 'Checking…' : 'Refresh payment status'}
        </QuietButton>
      </>
    )
  }

  if (order.paymentStatus === 'PAID') {
    const needsAttention = order.fulfilmentStatus === 'FULFILLMENT_FAILED' || order.fulfilmentStatus === 'RECOVERY_REQUIRED'
    return (
      <>
        <ol className="payment-progress">
          <li data-done="true">Quote ready</li>
          <li data-done="true">Wallet approval</li>
          <li data-done="true">NIM payment confirmed</li>
          <li data-done={order.fulfilmentStatus === 'DELIVERED' ? 'true' : 'false'}>
            {order.fulfilmentStatus === 'DELIVERED' ? `${serviceNoun(order)} delivered` : `Delivering ${serviceNoun(order).toLowerCase()}`}
          </li>
        </ol>
        {needsAttention ? (
          <div className="truth-note"><Icon name="info" size={18} /><p>Payment confirmed · {serviceNoun(order).toLowerCase()} delivery needs attention. Your NIM payment is safe and recorded.</p></div>
        ) : null}
        {order.fulfilmentStatus === 'FULFILLING' || order.fulfilmentStatus === 'NOT_STARTED' ? (
          <QuietButton disabled={refreshing} onClick={onRefresh}>
            {refreshing ? 'Checking…' : 'Refresh order status'}
          </QuietButton>
        ) : null}
      </>
    )
  }

  return (
    <>
      <div className="truth-note"><Icon name="info" size={18} /><p>{describePaymentFailureReason(order.paymentFailureReason)}</p></div>
      <QuietButton disabled={refreshing} onClick={onRefresh}>
        {refreshing ? 'Checking…' : 'Refresh order status'}
      </QuietButton>
    </>
  )
}
