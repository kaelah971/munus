import { useCallback, useState } from 'react'
import crossingJpeg from '../assets/everyday-crossing.jpg'
import crossingWebp from '../assets/everyday-crossing.webp'
import { BrandLockup, Icon, PrimaryButton } from '../components/Primitives'

export function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const [imageFailed, setImageFailed] = useState(false)
  const isBrowserPreview = typeof window !== 'undefined' && !window.nimiqPay && !window.nimiq
  const checkCachedImage = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth === 0) setImageFailed(true)
  }, [])

  return (
    <div className="app-shell">
      <main className="onboarding-screen">
        <header className="onboarding-topbar">
          <BrandLockup />
          <span className="onboarding-positioning">NIM first</span>
        </header>

        <section aria-labelledby="onboarding-title" className={`onboarding-hero${imageFailed ? ' onboarding-hero--without-image' : ''}`}>
          {!imageFailed && (
            <div aria-hidden="true" className="onboarding-artwork">
              <picture>
                <source srcSet={crossingWebp} type="image/webp" />
                <img
                  alt=""
                  fetchPriority="high"
                  height={1402}
                  loading="eager"
                  onError={() => setImageFailed(true)}
                  ref={checkCachedImage}
                  src={crossingJpeg}
                  width={1122}
                />
              </picture>
            </div>
          )}
          <div className="onboarding-hero-copy">
            <p className="onboarding-eyebrow">Everyday money, in one place</p>
            <h1 id="onboarding-title">Keep everyday<br />{' '}moving.</h1>
            <p className="onboarding-lede">
              Plan the essentials, pay with NIM, and keep your receipts in one place.
            </p>
            <PrimaryButton onClick={onComplete}>
              Open Munus <Icon name="arrow" size={18} />
            </PrimaryButton>
            <p className="onboarding-reassurance">
              Your wallet stays in Nimiq Pay.<br />
              You approve every payment there.
            </p>
            {isBrowserPreview && (
              <p className="onboarding-preview">Open inside Nimiq Pay to connect your wallet.</p>
            )}
          </div>
        </section>

        <section aria-labelledby="onboarding-system-title" className="onboarding-system onboarding-section">
          <h2 id="onboarding-system-title">For what life needs next.</h2>
          <p className="onboarding-section-lede">
            Put your NIM to work in everyday life—with a plan before you pay and a record after.
          </p>

          <ol className="onboarding-chapters">
            <li className="onboarding-chapter">
              <span aria-hidden="true" className="onboarding-chapter-number">01</span>
              <div>
                <h3>Plan it.</h3>
                <p>See your NIM clearly. Organize essentials in Life Pockets, set reminders, and keep spending intentions in view with Spend Guard.</p>
                <p className="onboarding-example">Transport · Groceries · Family</p>
              </div>
            </li>
            <li className="onboarding-chapter">
              <span aria-hidden="true" className="onboarding-chapter-number">02</span>
              <div>
                <h3>Pay it.</h3>
                <p>Compare available bundles and pay for essentials with NIM. Keep contacts close, support someone, or request help for a specific need.</p>
                <p className="onboarding-example">Choose → Review → Approve in Nimiq Pay</p>
              </div>
            </li>
            <li className="onboarding-chapter">
              <span aria-hidden="true" className="onboarding-chapter-number">03</span>
              <div>
                <h3>Prove it.</h3>
                <p>Find your activity, receipts, and payment proof together. If a payment or delivery needs attention, follow its progress in Recovery Center.</p>
                <p className="onboarding-example">Payment → Delivery → Record</p>
              </div>
            </li>
          </ol>
        </section>

        <section aria-labelledby="onboarding-trust-title" className="onboarding-trust onboarding-section">
          <h2 id="onboarding-trust-title">Your wallet stays yours.</h2>
          <p className="onboarding-section-lede">
            Munus helps you plan and keeps your money history organized. Nimiq Pay holds your wallet keys and asks you to approve payments.
          </p>
          <p className="onboarding-recovery">
            When something needs attention, follow the payment and delivery status in Recovery Center.
          </p>
          <div className="onboarding-close">
            <p>Keep everyday moving.</p>
            <PrimaryButton onClick={onComplete}>
              Open Munus <Icon name="arrow" size={18} />
            </PrimaryButton>
            <p className="onboarding-reassurance">Inside Nimiq Pay. Built around NIM.</p>
          </div>
        </section>
      </main>
    </div>
  )
}
