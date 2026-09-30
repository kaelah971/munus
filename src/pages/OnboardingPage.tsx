import { BrandLockup, Icon, PrimaryButton, StatusPill } from '../components/Primitives'

export function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="app-shell">
      <main className="app-frame onboarding-screen">
        <div className="onboarding-topbar">
          <BrandLockup />
          <StatusPill label="NIM first" tone="ready" />
        </div>

        <div className="onboarding-content">
          <div aria-hidden="true" className="onboarding-mark"><span>M</span></div>
          <p className="eyebrow">Everyday essentials, made deliberate</p>
          <h1>Put NIM to work in everyday life.</h1>
          <p className="onboarding-lede">
            Munus gives your everyday money a clear home for planning, wallet context, and proof.
          </p>

          <div className="principles-card">
            <div className="principle-row"><span className="principle-number">01</span><div><strong>See it.</strong><span>Know where your NIM stands.</span></div></div>
            <div className="principle-row"><span className="principle-number">02</span><div><strong>Plan it.</strong><span>Keep the essentials in view.</span></div></div>
            <div className="principle-row"><span className="principle-number">03</span><div><strong>Prove it.</strong><span>Keep your money history clear.</span></div></div>
          </div>

          <PrimaryButton onClick={onComplete}>
            Open Munus
            <Icon name="arrow" size={19} />
          </PrimaryButton>
          <p className="onboarding-footnote">
            Wallet access and approvals stay with Nimiq Pay. Browser preview never invents wallet data.
          </p>
        </div>
      </main>
    </div>
  )
}
