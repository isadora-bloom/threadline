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
        setWatching(true)
      }
      queryClient.invalidateQueries({ queryKey: ['registry'] })
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
