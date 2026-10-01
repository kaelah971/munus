import { useCallback, useState } from 'react'
import crossingJpeg from '../assets/everyday-crossing.jpg'
import crossingWebp from '../assets/everyday-crossing.webp'
import { Icon, PrimaryButton } from '../components/Primitives'

export function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const [imageFailed, setImageFailed] = useState(false)
  const checkCachedImage = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth === 0) setImageFailed(true)
  }, [])

  return (
    <div className="app-shell">
      <main className="onboarding-screen">

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
              You approve everything there.
            </p>
            <p className="onboarding-preview">Open inside Nimiq Pay to connect your wallet.</p>
          </div>
        </section>

      </main>
    </div>
  )
}
