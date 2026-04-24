'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Star, StarOff } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

export function WatchButton({
  recordId,
  isWatching: initialWatching,
  userId,
}: {
  recordId: string
  isWatching: boolean
  userId: string
}) {
  const [watching, setWatching] = useState(initialWatching)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()
  const queryClient = useQueryClient()

  const toggle = async () => {
    setLoading(true)
    try {
      if (watching) {
        await supabase
          .from('user_watchlist')
          .delete()
          .eq('import_record_id', recordId)
          .eq('user_id', userId)
        setWatching(false)
      } else {
        await supabase
          .from('user_watchlist')
          .insert({ user_id: userId, import_record_id: recordId })
        // Record the action in user_activity_log so the registry profile can
        // show this user as currently investigating the case. Non-fatal on
        // failure — presence is a nice-to-have, not load-bearing.
        await supabase
          .from('user_activity_log')
          .insert({ user_id: userId, activity_type: 'watched_case', ref_id: recordId } as never)
          .then(({ error }) => { if (error) console.warn('activity log:', error.message) })
        setWatching(true)
      }
      queryClient.invalidateQueries({ queryKey: ['registry'] })
      queryClient.invalidateQueries({ queryKey: ['presence', recordId] })
    } catch (err) {
      console.error('Watch toggle error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant={watching ? 'default' : 'outline'}
      size="sm"
      onClick={toggle}
      disabled={loading}
    >
      {watching ? (
        <>
          <Star className="h-4 w-4 fill-current" />
          Watching
        </>
      ) : (
        <>
          <StarOff className="h-4 w-4" />
          Watch
        </>
      )}
    </Button>
  )
}
