import type { FundingPreview } from '../domain/funding'
import type { NimFundingView } from '../domain/funding'

export type FundingDeductionMode = 'preview' | 'pending'

export interface FundingDeduction {
  /** Exact server-quoted deduction preview. Canonical balance is untouched. */
  preview: FundingPreview
  /** e.g. "₦100 Airtime". */
  targetLabel: string
  mode: FundingDeductionMode
  /**
   * Aggregate funding context names the Nimiq Pay funding pool instead of
   * one connected wallet. Either way the figures stay informational:
   * Nimiq Pay chooses the paying account at approval.
   */
  context?: 'wallet' | 'aggregate'
}

/**
 * Shared NIM source-of-funds presentation for Home, Airtime/Data review,
 * and Essential payer review. Pure presentation over resolved truth:
 * balance + estimate + an optional deduction preview.
 *
 * Sender-independence is preserved by wording, never by blocking: the
 * wallet chooses the actual debit account at approval, so remaining and
 * shortfall figures are always conditional ("if paid from this connected
 * wallet") and payment is never disabled on their basis.
 */
export function NimFundingCard({ view, estimateHidden, deduction, balanceNote }: {
  view: NimFundingView
  /** Hide the estimate line entirely (review screens show rate separately). */
  estimateHidden?: boolean
  deduction?: FundingDeduction | null
  /** Non-balance notice, e.g. post-payment refresh failure. */
  balanceNote?: string | null
}) {
  return (
    <div className="funding-card">
      <p className="account-card-balance funding-balance">{view.amountText} NIM</p>
      {!estimateHidden && view.estimateText ? <p className="account-card-estimate">{view.estimateText}</p> : null}
      <div className="account-card-meta funding-meta">
        <span>{view.statusText}</span>
        <span>{view.networkText}</span>
      </div>
      {view.accountHint ? <p className="account-card-reference">{view.accountHint}</p> : null}
      {deduction ? <FundingDeductionBlock deduction={deduction} /> : null}
      {balanceNote ? <p className="section-copy">{balanceNote}</p> : null}
    </div>
  )
}

function FundingDeductionBlock({ deduction }: { deduction: FundingDeduction }) {
  const { preview, targetLabel, mode, context = 'wallet' } = deduction
  return (
    <div className="funding-preview" aria-live="polite">
      <p className="funding-deduction">
        <span>− {preview.quoteNim} NIM{mode === 'pending' ? ' pending' : ''}</span>
        <span className="funding-arrow" aria-hidden="true">↓</span>
        <span>{targetLabel}</span>
      </p>
      {mode === 'pending' ? (
        <p className="section-copy">Confirming payment… Shown balance is unchanged until on-chain verification.</p>
      ) : preview.sufficient && preview.remainingNim !== null ? (
        <p className="section-copy">{context === 'aggregate'
          ? <>Potential remaining ≈ {preview.remainingNim} NIM. Nimiq Pay chooses the paying account at approval.</>
          : <>If paid from this connected wallet, ≈ {preview.remainingNim} NIM left.</>}</p>
      ) : preview.shortfallNim !== null ? (
        <p className="section-copy">
          {context === 'aggregate'
            ? <>These accounts hold {preview.balanceNim} NIM — {preview.shortfallNim} short of the quote. Nimiq Pay may use a different account; payment stays available.</>
            : <>This wallet holds {preview.balanceNim} NIM — {preview.shortfallNim} short of the quote. Nimiq Pay may use a different account; payment stays available.</>}
        </p>
      ) : null}
    </div>
  )
}
