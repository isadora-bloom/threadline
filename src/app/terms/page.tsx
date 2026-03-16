import Link from 'next/link'

export const metadata = {
  title: 'Terms of Use — Threadline',
}

const CURRENT_VERSION = '2026-03'
const LAST_UPDATED = 'March 2026'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-16">

        {/* Header */}
        <div className="mb-10">
          <Link href="/login" className="text-sm text-indigo-600 hover:underline">
            ← Back to sign in
          </Link>
          <h1 className="mt-6 text-3xl font-bold text-slate-900">Terms of Use</h1>
          <p className="mt-2 text-sm text-slate-500">
            Version {CURRENT_VERSION} · Last updated {LAST_UPDATED}
          </p>
        </div>

        <div className="prose prose-slate max-w-none space-y-8 text-slate-700 leading-relaxed">

          {/* The one paragraph that must be here */}
          <div className="rounded-lg border-2 border-slate-900 bg-slate-50 p-6">
            <p className="text-slate-900 font-medium">
              Threadline is a tool for organizing and reviewing information submitted by others. It
              does not draw conclusions, make accusations, or verify the accuracy of any information
              submitted to it. All information on this platform is unverified unless explicitly
              marked otherwise. Users agree not to use information accessed through this platform to
              contact, confront, publicly identify, or take any action against any individual.
              Threadline is not responsible for the actions of users who violate these terms.
            </p>
          </div>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">What Threadline is</h2>
            <p>
              Threadline is a structured case intelligence workspace for investigators, nonprofits,
              journalists, and family advocates working on missing persons, unidentified remains, and
              related public-interest investigations. It is infrastructure for organizing
              information — not a crime-solving platform, not a suspect identification tool, and not
              a system that draws conclusions on behalf of its users.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">What Threadline is not</h2>
            <ul className="list-disc list-inside space-y-1 text-slate-700">
              <li>Not a public forum or crowd-solving platform</li>
              <li>Not a tool for identifying, naming, or accusing individuals</li>
              <li>Not a law enforcement system</li>
              <li>Not a system that verifies the accuracy of information submitted to it</li>
              <li>Not a substitute for professional investigative or legal judgment</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">User obligations</h2>
            <p className="mb-3">By accessing this platform, you agree that you will not:</p>
            <ul className="list-disc list-inside space-y-1 text-slate-700">
              <li>
                Use any information accessed through Threadline to contact, confront, publicly
                identify, or take any action against any individual
              </li>
              <li>
                Share information from this platform outside authorized channels without explicit
                approval from the lead investigator on the relevant case
              </li>
              <li>
                Present pattern flags, inferences, or system-generated suggestions as confirmed
                facts in any public or official context
              </li>
              <li>
                Use this platform for any purpose other than legitimate investigative,
                journalistic, legal, or advocacy work
              </li>
              <li>
                Attempt to identify anonymous or confidential submitters
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">
              How information is structured on this platform
            </h2>
            <p className="mb-3">
              Every piece of information in Threadline carries an explicit epistemic label. You will
              always know whether you are looking at:
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-700">
              <li>
                <strong>A verified fact</strong> — an official, confirmed record from a primary
                source
              </li>
              <li>
                <strong>A claim</strong> — something reported by a submitter, not yet verified
              </li>
              <li>
                <strong>An inference</strong> — a possible connection surfaced for review, never a
                conclusion
              </li>
            </ul>
            <p className="mt-3">
              Pattern flags and analytical suggestions generated by the system are surfaced for
              human review. They are not findings. They are not conclusions. A human investigator
              must evaluate every flagged pattern before it can be treated as meaningful.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">
              How this platform is built to protect against misuse
            </h2>
            <p className="mb-3">Three structural decisions protect against misuse:</p>
            <ol className="list-decimal list-inside space-y-3 text-slate-700">
              <li>
                <strong>Closed access.</strong> This is not a public-facing platform. You are here
                because a verified case lead granted you access. Information that stays inside a
                private, access-controlled workspace cannot be used to publicly identify or harm
                individuals.
              </li>
              <li>
                <strong>Immutable audit trail.</strong> Every action on this platform is logged and
                cannot be edited or deleted. Every view, edit, export, and flag review is recorded.
                This protects the integrity of the information and provides chain-of-custody
                documentation for any information that enters formal proceedings.
              </li>
              <li>
                <strong>Human review gate.</strong> Nothing enters the active case workspace
                without a human reviewer making an explicit decision. The system assists — it does
                not decide.
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">
              Source protection
            </h2>
            <p>
              Submitters who choose to submit anonymously or confidentially have their identities
              protected by the platform. Anonymous submissions store nothing identifying. Confidential
              submissions store name and contact details accessible only to the lead investigator,
              with a logged audit record on every access. Source identities are never included in
              exports or handoff packages without explicit per-export authorization and logged
              consent from the source.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">Cost and data portability</h2>
            <p>
              Threadline is free to use. There are no current plans to charge for access. If that
              ever changes — which is not anticipated — any organization using the platform will
              receive at least 90 days notice and assistance migrating their data to another format.
              Your data is yours. Exports are always available in full, in clean formats, at any
              time.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">Changes to these terms</h2>
            <p>
              If these terms change materially, users will be asked to review and accept the updated
              version before continuing to access the platform. The current version is{' '}
              {CURRENT_VERSION}.
            </p>
          </section>

          <div className="border-t border-slate-200 pt-6 text-sm text-slate-500 space-y-2">
            <p>
              Questions about these terms or the platform can be directed to your case lead or
              organization administrator.
            </p>
            <p>
              Read our{' '}
              <Link href="/privacy" className="text-indigo-600 hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
