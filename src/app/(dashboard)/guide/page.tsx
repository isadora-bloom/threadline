import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import {
  Brain, Search, Star, Flame, Fingerprint, BookOpen, Briefcase, User,
  ChevronRight, Sparkles, ShieldAlert, GitMerge, Globe, MapPin,
  Navigation, Flag, Link2, Users, Microscope,
} from 'lucide-react'

export default function GuidePage() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">How to use Threadline</h1>
        <p className="text-slate-500">
          A guide to what everything does and where to find it.
        </p>
      </div>

      {/* Sidebar navigation explained */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Navigation</h2>

        <NavItem icon={Fingerprint} title="Case Lookup" href="/lookup"
          description="The quick way in. Enter a NamUs number (MP12345), a person's name, or a city. Get instant results with links to full profiles and AI analysis." />

        <NavItem icon={Brain} title="Intelligence" href="/intelligence"
          description="The main analysis workbench. This is where the matching engine lives. 9 tabs:"
          details={[
            { label: 'Remains Match', text: 'Missing persons scored against unidentified remains. 16 signals including physical description, tattoos, decomposition state, location, time gap. Filter by grade (very strong → moderate), review status, and AI verdict.' },
            { label: 'Tattoo Matches', text: 'Dedicated mark comparison — tattoos, scars, birthmarks matched by keyword and body location. Click any match to expand case details, run AI review, or mark as worth investigating.' },
            { label: 'Known Offenders', text: '462 convicted serial offenders with MO, geography, and victimology overlap scoring against cases. Statistical only — not an accusation.' },
            { label: 'Map', text: 'Geographic visualization of clusters. Shows where cases concentrate.' },
            { label: 'Corridors', text: 'Cases mentioning major highway corridors (I-10, I-35, I-95, etc.). Useful for hitchhiker and highway cases.' },
            { label: 'Clusters', text: 'Demographic + temporal + circumstance patterns. "67 Hispanic female teens in TN, May pattern" — these surface statistical anomalies.' },
            { label: 'Stall Flags', text: 'Cases classified as runaway/voluntary that have been cold for years. Often misclassified — worth a second look.' },
            { label: 'Threads', text: 'AI-generated investigative questions and hypotheses for human follow-up.' },
            { label: 'Research', text: 'Manual and AI-assisted research tasks.' },
          ]} />

        <NavItem icon={Search} title="Registry" href="/registry"
          description="Browse all 60,000 records. Search by name, city, state. Filter by type (missing/unidentified) and sex. Each record links to a full profile with demographics, circumstances, matches, and AI analysis." />

        <NavItem icon={Star} title="My Watchlist" href="/my-watchlist"
          description="Cases you're following (up to 10). Add notes, see who else is investigating, track updates. This is your personal dashboard — the cases you care about." />

        <NavItem icon={Flame} title="Needs You" href="/needing-attention"
          description="Cases with high solvability scores but nobody watching. AI says 'this case has leads' but no one is looking. Your fresh eyes could make the difference." />

        <NavItem icon={BookOpen} title="Research" href="/research"
          description="Deep research tasks. Click 'Threadline AI' on any registry profile to run a comprehensive analysis — connections, offender overlaps, timeline, next steps, red flags." />

        <NavItem icon={Briefcase} title="Investigations" href="/cases"
          description="For active investigations with private submissions. If you're working a specific case with a team, create an investigation here. Most users will use the registry and intelligence pages instead." />

        <NavItem icon={User} title="Your Skills" href="/profile"
          description="Tell Threadline what you're good at — OSINT, genealogy, forensic art, journalism, local knowledge. Cases that need your specific skills will be surfaced to you." />
      </div>

      {/* Key concepts */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Key concepts</h2>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <h3 className="font-semibold text-sm text-slate-900">Match scores are not identifications</h3>
              <p className="text-xs text-slate-600 mt-1">
                A score of 100 means the available data aligns strongly across multiple signals. It does NOT mean
                the missing person is the unidentified remains. Confirmation requires forensic verification — dental
                records, DNA, fingerprints. Threadline surfaces candidates. Humans and science confirm.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-sm text-slate-900">Decomposition weighting</h3>
              <p className="text-xs text-slate-600 mt-1">
                When remains are skeletal, hair color and eye color signals are zeroed out — they can&apos;t be determined.
                The score adjusts automatically based on the stated condition of the remains. A high score on skeletal
                remains means height, sex, age, race, location, and timeline all align — even without soft tissue signals.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-sm text-slate-900">AI-extracted vs verified</h3>
              <p className="text-xs text-slate-600 mt-1">
                Some data was extracted by AI from case narratives. It&apos;s labeled &quot;AI-extracted, not verified.&quot;
                The original source data is always preserved. If something looks wrong, check the original record
                on NamUs or Doe Network via the source link.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-sm text-slate-900">What &quot;dismiss&quot; means</h3>
              <p className="text-xs text-slate-600 mt-1">
                When you dismiss a match, you&apos;re saying &quot;I&apos;ve looked at this and it&apos;s not worth pursuing.&quot;
                It doesn&apos;t delete anything — dismissed items can be found again. It helps other investigators know
                what&apos;s already been reviewed.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick start */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Quick start</h2>

        <Card className="border-indigo-200 bg-indigo-50">
          <CardContent className="p-4 space-y-2">
            <p className="text-sm text-indigo-900 font-medium">First time? Start here:</p>
            <ol className="list-decimal list-inside text-sm text-indigo-800 space-y-1.5">
              <li>Go to <Link href="/lookup" className="underline font-medium">Case Lookup</Link> and search for a name or city you know</li>
              <li>Open a profile — read the person&apos;s story, check their matches</li>
              <li>If something interests you, click <strong>Watch</strong> to add it to your watchlist</li>
              <li>Go to <Link href="/intelligence" className="underline font-medium">Intelligence</Link> to see the full analysis — matches, offenders, clusters</li>
              <li>Click <strong>Threadline AI</strong> on any case for a deep investigative analysis</li>
              <li>Add your <Link href="/profile" className="underline font-medium">skills</Link> so we can match you with cases that need your expertise</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function NavItem({
  icon: Icon,
  title,
  href,
  description,
  details,
}: {
  icon: typeof Brain
  title: string
  href: string
  description: string
  details?: Array<{ label: string; text: string }>
}) {
  return (
    <Link href={href}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 flex-shrink-0">
            <Icon className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-slate-900">{title}</h3>
              <ChevronRight className="h-3 w-3 text-slate-400" />
            </div>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{description}</p>
            {details && (
              <div className="mt-2 space-y-1">
                {details.map((d, i) => (
                  <div key={i} className="text-[10px] text-slate-500">
                    <span className="font-semibold text-slate-700">{d.label}:</span> {d.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
