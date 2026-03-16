'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

interface ReviewDashboardClientProps {
  untriaged: number
  inReview: number
  reviewedToday: number
  avgReviewMinutes: number | null
  totalSubmissions: number
  priorityBreakdown: { high: number; medium: number; low: number }
  volumeData: { date: string; count: number }[]
  reviewerRows: { userId: string; name: string; count: number; avgMinutes: number | null }[]
  caseId: string
}

function StatBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-500 w-8 text-right">{pct}%</span>
    </div>
  )
}

function DonutSegment({
  high, medium, low,
}: { high: number; medium: number; low: number }) {
  const total = high + medium + low
  if (total === 0) return (
    <div className="h-32 w-32 rounded-full border-8 border-slate-100 mx-auto flex items-center justify-center">
      <span className="text-xs text-slate-400">None</span>
    </div>
  )

  const highPct = (high / total) * 100
  const medPct = (medium / total) * 100
  const lowPct = (low / total) * 100

  // Simple CSS conic-gradient donut
  const gradient = `conic-gradient(
    #ef4444 0% ${highPct}%,
    #f59e0b ${highPct}% ${highPct + medPct}%,
    #e2e8f0 ${highPct + medPct}% ${highPct + medPct + lowPct}%
  )`

  return (
    <div className="flex items-center gap-6">
      <div
        className="h-28 w-28 rounded-full flex-shrink-0"
        style={{ background: gradient }}
      >
        <div className="h-28 w-28 rounded-full flex items-center justify-center">
          <div className="h-16 w-16 rounded-full bg-white flex items-center justify-center">
            <span className="text-sm font-bold text-slate-700">{total}</span>
          </div>
        </div>
      </div>
      <div className="space-y-1.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-red-400 flex-shrink-0" />
          <span className="text-slate-600">High: <strong>{high}</strong></span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-amber-400 flex-shrink-0" />
          <span className="text-slate-600">Medium: <strong>{medium}</strong></span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-slate-200 flex-shrink-0" />
          <span className="text-slate-600">Low: <strong>{low}</strong></span>
        </div>
      </div>
    </div>
  )
}

function VolumeChart({ data }: { data: { date: string; count: number }[] }) {
  const maxCount = Math.max(...data.map(d => d.count), 1)
  const last7 = data.slice(-7)
  const all30 = data

  return (
    <div>
      {/* Mini bar chart using divs */}
      <div className="flex items-end gap-0.5 h-20 w-full">
        {all30.map((d, i) => {
          const pct = (d.count / maxCount) * 100
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end group relative">
              <div
                className="w-full bg-indigo-300 hover:bg-indigo-500 transition-colors rounded-t-sm"
                style={{ height: `${pct}%`, minHeight: d.count > 0 ? '2px' : '0' }}
              />
              {/* Tooltip */}
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10">
                {d.date}: {d.count}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>{all30[0]?.date.slice(5) ?? ''}</span>
        <span className="text-slate-500">Last 30 days</span>
        <span>{all30[all30.length - 1]?.date.slice(5) ?? ''}</span>
      </div>
      {/* Last 7 days summary */}
      <div className="mt-2 text-xs text-slate-500">
        Last 7 days: <strong className="text-slate-700">{last7.reduce((s, d) => s + d.count, 0)}</strong> submissions
      </div>
    </div>
  )
}

export function ReviewDashboardClient({
  untriaged,
  inReview,
  reviewedToday,
  avgReviewMinutes,
  totalSubmissions,
  priorityBreakdown,
  volumeData,
  reviewerRows,
  caseId,
}: ReviewDashboardClientProps) {
  return (
    <div className="space-y-6">
      {/* Queue health panel */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-4">Queue health</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <div className="text-2xl font-bold text-slate-900">{untriaged}</div>
            <div className="text-xs text-slate-500 mt-0.5 mb-2">Untriaged</div>
            <StatBar value={untriaged} max={totalSubmissions} color="bg-amber-400" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900">{inReview}</div>
            <div className="text-xs text-slate-500 mt-0.5 mb-2">In review</div>
            <StatBar value={inReview} max={totalSubmissions} color="bg-indigo-400" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900">{reviewedToday}</div>
            <div className="text-xs text-slate-500 mt-0.5 mb-2">Reviewed today</div>
            <StatBar value={reviewedToday} max={totalSubmissions} color="bg-green-400" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900">
              {avgReviewMinutes !== null ? `${Math.round(avgReviewMinutes)}m` : '—'}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Avg review time</div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100">
          <Link
            href={`/cases/${caseId}/submissions/triage`}
            className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:underline font-medium"
          >
            Enter triage mode
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Priority breakdown */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-4">
            Priority breakdown
            <span className="ml-2 text-xs font-normal text-slate-400">(untriaged submissions)</span>
          </h2>
          <DonutSegment {...priorityBreakdown} />
        </div>

        {/* Submission volume */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-4">Submission volume</h2>
          <VolumeChart data={volumeData} />
        </div>
      </div>

      {/* Reviewer activity */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-4">Reviewer activity today</h2>
        {reviewerRows.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">No reviews completed today.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100">
                <th className="text-left py-2 font-medium">Reviewer</th>
                <th className="text-right py-2 font-medium">Reviewed today</th>
                <th className="text-right py-2 font-medium">Avg review time</th>
              </tr>
            </thead>
            <tbody>
              {reviewerRows.map(row => (
                <tr key={row.userId} className="border-b border-slate-50 last:border-0">
                  <td className="py-2.5 text-slate-700">{row.name}</td>
                  <td className="py-2.5 text-right font-semibold text-slate-900">{row.count}</td>
                  <td className="py-2.5 text-right text-slate-500">
                    {row.avgMinutes !== null ? `${Math.round(row.avgMinutes)}m` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
