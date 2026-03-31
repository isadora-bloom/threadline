import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/brand/icon.png" alt="Threadline" className="h-8 w-8 rounded-lg" />
            <span className="text-lg font-bold text-slate-900 tracking-tight">Threadline</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm text-slate-600 hover:text-slate-900">Sign in</Link>
            <Link href="/login" className="text-sm font-medium bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700">
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="max-w-3xl">
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 leading-tight">
            See what volume hides.
          </h1>
          <p className="mt-6 text-xl text-slate-600 leading-relaxed">
            There are 26,000 missing people and 14,000 unidentified remains in America.
            The databases that track them don&apos;t talk to each other.
            Threadline cross-references all of them.
          </p>
          <div className="mt-8 flex items-center gap-4">
            <Link href="/login" className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700">
              Start investigating
            </Link>
            <Link href="#how" className="text-indigo-600 font-medium hover:text-indigo-800">
              How it works &darr;
            </Link>
          </div>
          <p className="mt-4 text-sm text-slate-400">
            Free forever. No ads. No tracking. Built for investigators, families, and anyone who refuses to give up.
          </p>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <div className="text-3xl font-bold text-slate-900">59,734</div>
            <div className="text-sm text-slate-500 mt-1">Records from NamUs, Doe Network, and The Charley Project</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-slate-900">16</div>
            <div className="text-sm text-slate-500 mt-1">Signal dimensions in the matching engine including decomp weighting</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-slate-900">462</div>
            <div className="text-sm text-slate-500 mt-1">Known serial offenders with MO/geography overlap scoring</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-slate-900">6,421</div>
            <div className="text-sm text-slate-500 mt-1">Victimology clusters — demographic, temporal, and geographic patterns</div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="max-w-5xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-slate-900 mb-12">How Threadline works</h2>

        <div className="grid md:grid-cols-3 gap-10">
          <div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 mb-4">
              <span className="text-lg font-bold text-indigo-600">1</span>
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">We aggregate every public database</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              NamUs, The Doe Network, The Charley Project. Every missing person and unidentified remains record
              in the US. Scraped, structured, searchable.
            </p>
          </div>
          <div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 mb-4">
              <span className="text-lg font-bold text-indigo-600">2</span>
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">AI scores every possible connection</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              A 16-signal matching engine compares physical descriptions, tattoos, geographic proximity,
              temporal windows, and decomposition state. Weak matches are eliminated. Strong ones surface.
            </p>
          </div>
          <div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 mb-4">
              <span className="text-lg font-bold text-indigo-600">3</span>
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Humans investigate what the machine finds</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Every match, every pattern, every flag requires human review. AI surfaces possibilities.
              Investigators make judgments. The law takes action.
            </p>
          </div>
        </div>
      </section>

      {/* What you can do */}
      <section className="bg-slate-50 border-y border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <h2 className="text-3xl font-bold text-slate-900 mb-12">What you can do on Threadline</h2>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-white rounded-xl p-6 border border-slate-200">
              <h3 className="font-semibold text-slate-900 mb-2">Browse the Registry</h3>
              <p className="text-sm text-slate-600">
                Search 60,000 records by name, city, state, or NamUs number. Every missing person and
                unidentified remains in the US, with demographics, circumstances, and source links.
              </p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-slate-200">
              <h3 className="font-semibold text-slate-900 mb-2">Review Matches</h3>
              <p className="text-sm text-slate-600">
                The intelligence engine scores missing persons against unidentified remains on 16 signal
                dimensions. Review the strongest matches, check physical descriptions side by side, and
                mark what&apos;s worth investigating.
              </p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-slate-200">
              <h3 className="font-semibold text-slate-900 mb-2">Watch Cases</h3>
              <p className="text-sm text-slate-600">
                Follow up to 10 cases you care about. Get matched with others investigating the same person.
                Share observations, questions, and leads. Do something, not just listen.
              </p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-slate-200">
              <h3 className="font-semibold text-slate-900 mb-2">Run Deep Research</h3>
              <p className="text-sm text-slate-600">
                One click on any case triggers Threadline AI — an investigative analysis that searches for
                connections, checks offender overlaps, builds a timeline, and suggests specific next steps.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Not another true crime thing */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold text-slate-900 mb-6">This is not entertainment.</h2>
          <p className="text-lg text-slate-600 leading-relaxed mb-4">
            True crime podcasts have millions of listeners. WebSleuths has 243,000 members.
            Most of that energy goes into consuming tragedy as content.
          </p>
          <p className="text-lg text-slate-600 leading-relaxed mb-4">
            Threadline is for people who want to <strong>do something</strong>. The tool shows patterns.
            Humans make judgments. Every match requires review. Every flag is a suggestion, not a conclusion.
          </p>
          <p className="text-lg text-slate-600 leading-relaxed">
            If this tool helps identify one person — one set of remains given a name, one missing person
            found — it was worth building.
          </p>
        </div>
      </section>

      {/* Epistemic notice */}
      <section className="bg-amber-50 border-y border-amber-200">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <p className="text-sm text-amber-800 leading-relaxed">
            <strong>Important:</strong> Threadline is a tool for organizing and reviewing information.
            It does not draw conclusions, make accusations, or verify the accuracy of any data.
            All information is unverified unless explicitly marked otherwise.
            Users agree not to use information accessed through this platform to contact, confront,
            publicly identify, or take any action against any individual.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-600">
              <span className="text-[10px] font-bold text-white">TL</span>
            </div>
            <span className="text-sm font-semibold text-slate-700">Threadline</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-slate-400">
            <Link href="/terms" className="hover:text-slate-600">Terms</Link>
            <Link href="/privacy" className="hover:text-slate-600">Privacy</Link>
            <span>Data from NamUs, Doe Network, The Charley Project. Used with credit.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
