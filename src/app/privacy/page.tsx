import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy — Threadline',
}

const LAST_UPDATED = 'March 2026'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-16">

        {/* Header */}
        <div className="mb-10">
          <Link href="/login" className="text-sm text-indigo-600 hover:underline">
            ← Back to sign in
          </Link>
          <h1 className="mt-6 text-3xl font-bold text-slate-900">Privacy Policy</h1>
          <p className="mt-2 text-sm text-slate-500">
            Last updated {LAST_UPDATED}
          </p>
        </div>

        <div className="prose prose-slate max-w-none space-y-8 text-slate-700 leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">What we collect</h2>
            <p>
              We collect only what submitters and users voluntarily provide. For public intake form
              submissions, this includes the text of a submission and any optional fields the
              submitter chooses to complete (date, location, identifiers, contact information).
            </p>
            <p className="mt-3">
              IP addresses are logged at the infrastructure level for rate limiting only. We do not
              store IP addresses in our application database or associate them with submissions
              long-term.
            </p>
            <p className="mt-3">
              Threadline has no tracking pixels, no analytics platform, and no advertising. We do
              not track user behavior across the web.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">How information is stored</h2>
            <p>
              All data is stored in Supabase (PostgreSQL), hosted on AWS infrastructure in US
              regions. Supabase provides encryption at rest by default for all data.
            </p>
            <p className="mt-3">
              Confidential submitter identity fields — specifically, name and contact information
              provided when a submitter chooses the &ldquo;confidential&rdquo; option — are
              additionally encrypted at the application layer using AES-256-GCM before being written
              to the database. This means even a database breach does not expose confidential
              submitter identities in plaintext.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">Who can see what</h2>
            <ul className="list-disc list-inside space-y-2 text-slate-700">
              <li>
                <strong>Anonymous submissions:</strong> No identifying information is stored at all.
                We cannot identify the submitter even if compelled.
              </li>
              <li>
                <strong>Confidential submissions:</strong> Submitter name and contact are stored
                encrypted. They are accessible only to lead investigators on the relevant case. Every
                access is logged in the immutable audit trail.
              </li>
              <li>
                <strong>On-record submissions:</strong> Submitter name and contact are accessible to
                lead investigators and reviewers on the relevant case. Every access is logged in the
                immutable audit trail.
              </li>
            </ul>
            <p className="mt-3">
              No submitter identity information is included in exports or handoff packages without
              explicit per-export authorization and logged consent.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">Subpoena and legal demands</h2>

            <p className="mb-3">
              If Threadline receives a valid legal demand (subpoena, court order, or equivalent) for
              information related to a specific case or individual, we will:
            </p>

            <ol className="list-decimal list-inside space-y-3 text-slate-700">
              <li>
                Notify the relevant case lead as soon as legally permitted — we will not provide
                notice if prohibited by law, but we will seek to challenge gag orders where possible;
              </li>
              <li>
                Provide only the specific information required by the order, not bulk data;
              </li>
              <li>
                Log the legal demand and our response in the case audit trail;
              </li>
              <li>
                Never voluntarily provide information to law enforcement without a valid legal order.
              </li>
            </ol>

            <div className="mt-4 space-y-3 text-sm text-slate-600 bg-slate-50 rounded-lg border border-slate-200 p-4">
              <p>
                <strong className="text-slate-800">Anonymous submitters:</strong> we cannot identify
                you even if compelled. We store nothing identifying.
              </p>
              <p>
                <strong className="text-slate-800">Confidential submitters:</strong> we store your
                name and contact encrypted. If compelled by a valid court order, this information
                could be disclosed. We will resist where legally possible.
              </p>
              <p>
                <strong className="text-slate-800">On-record submitters:</strong> your information is
                stored with less protection and is more likely to be producible under a legal demand.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">Data retention</h2>
            <p>
              Submissions and cases are retained indefinitely unless the lead investigator explicitly
              closes or archives a case. When a case is deleted, associated submission data is purged
              after 90 days.
            </p>
            <p className="mt-3">
              The audit trail — the immutable record of every action taken within a case — is never
              deleted. This protects the integrity of investigative records and supports
              chain-of-custody documentation.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">Your rights</h2>
            <p>
              You may request a copy of your data, request deletion of your data (subject to any
              applicable legal hold requirements), or request correction of inaccurate information.
              To exercise these rights, contact your case lead or the organization administering
              the relevant case.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">Changes to this policy</h2>
            <p>
              We will notify users of any material changes to this policy before they take effect.
              Continued use of the platform after a policy change constitutes acceptance of the
              revised policy.
            </p>
          </section>

          <div className="border-t border-slate-200 pt-6 text-sm text-slate-500 space-y-2">
            <p>
              Questions about this policy can be directed to your case lead or organization
              administrator.
            </p>
            <p>
              Read our{' '}
              <Link href="/terms" className="text-indigo-600 hover:underline">
                Terms of Use
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
