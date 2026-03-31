'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Star } from 'lucide-react'

/**
 * Tiny watch button for inline use on match cards, search results, etc.
 * Takes a submission_id, looks up the import_record, and adds to watchlist.
 */
export function QuickWatch({ submissionId, size = 'sm' }: { submissionId: string; size?: 'sm' | 'xs' }) {
  const supabase = createClient()
  const [watching, setWatching] = useState(false)
  const [done, setDone] = useState(false)

  const handleWatch = async (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (done) return

    setWatching(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Find the import_record for this submission
      const { data: record } = await supabase
        .from('import_records')
        .select('id')
        .eq('submission_id', submissionId)
        .single()

      if (record) {
        await supabase
          .from('user_watchlist')
          .upsert({ user_id: user.id, import_record_id: record.id }, { onConflict: 'user_id,import_record_id' })
        setDone(true)
      }
    } catch { /* silent */ }
    finally { setWatching(false) }
  }

  const sizeClass = size === 'xs' ? 'h-5 w-5' : 'h-6 w-6'
  const iconClass = size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5'

  return (
    <button
      onClick={handleWatch}
      disabled={watching}
      title={done ? 'Added to watchlist' : 'Add to watchlist'}
      className={`${sizeClass} inline-flex items-center justify-center rounded transition-colors ${
        done
          ? 'bg-amber-100 text-amber-600'
          : 'bg-slate-100 text-slate-400 hover:bg-amber-50 hover:text-amber-500'
      }`}
    >
      <Star className={`${iconClass} ${done ? 'fill-current' : ''}`} />
    </button>
  )
}
