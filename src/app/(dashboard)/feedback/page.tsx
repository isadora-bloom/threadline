'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MessageSquare, CheckCircle, Wrench, Heart } from 'lucide-react'

export default function FeedbackPage() {
  const supabase = createClient()
  const [type, setType] = useState('feedback')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const submitMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('community_notes').insert({
        user_id: user?.id,
        import_record_id: null,
        note_type: type === 'bug' ? 'observation' : type === 'idea' ? 'lead' : 'observation',
        content: `[${type.toUpperCase()}] ${message}${contact ? '\n\nContact: ' + contact : ''}`,
        is_public: false,
      })
    },
    onSuccess: () => setSubmitted(true),
  })

  if (submitted) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="text-center py-16">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Thank you</h1>
          <p className="text-slate-500">Your feedback has been received. It genuinely helps shape what this becomes.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Feedback & Ideas</h1>
        <p className="text-slate-500">
          Threadline is actively being developed by one person. Your feedback directly shapes what gets built next.
        </p>
      </div>

      {/* Dev note */}
      <Card className="border-indigo-200 bg-indigo-50">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <Wrench className="h-5 w-5 text-indigo-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-indigo-900 text-sm mb-2">A note from the developer</h3>
              <p className="text-sm text-indigo-800 leading-relaxed mb-3">
                I built Threadline because I wanted to see if AI could help surface connections in missing persons
                data that humans might miss. This is not a company. There&apos;s no business model. It runs on about
                $500/month and my own time.
              </p>
              <p className="text-sm text-indigo-800 leading-relaxed mb-3">
                The matching engine, the data scrapers, the analysis tools — they work, but they&apos;re not perfect.
                Some matches are noise. Some features are confusing. Some things are broken in ways I haven&apos;t
                found yet.
              </p>
              <p className="text-sm text-indigo-800 leading-relaxed">
                If you find something that doesn&apos;t make sense, or you have an idea for how this could be better,
                or you just want to tell me what your experience was like — I want to hear it. Every piece of
                feedback makes this tool more useful for the people and cases it&apos;s meant to serve.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* What I'm working on */}
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold text-slate-900 text-sm mb-3">What I&apos;m currently working on</h3>
          <ul className="space-y-2 text-sm text-slate-600">
            <li className="flex items-start gap-2">
              <span className="text-indigo-500 mt-1">→</span>
              Improving match quality — reducing false positives, adding more signal dimensions
            </li>
            <li className="flex items-start gap-2">
              <span className="text-indigo-500 mt-1">→</span>
              Enriching records with full case details from NamUs (physical descriptions, dental, DNA status)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-indigo-500 mt-1">→</span>
              Making the analysis tools more accessible to non-investigators
            </li>
            <li className="flex items-start gap-2">
              <span className="text-indigo-500 mt-1">→</span>
              Adding temporal pattern detection (seasonal disappearances, anniversary patterns)
            </li>
            <li className="flex items-start gap-2">
              <span className="text-indigo-500 mt-1">→</span>
              Skill-based case matching — connecting people with specific expertise to cases that need them
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Feedback form */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <h3 className="font-semibold text-slate-900 text-sm">Send feedback</h3>

          <Select value={type} onValueChange={setType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="feedback">General feedback — what&apos;s your experience like?</SelectItem>
              <SelectItem value="bug">Bug report — something is broken or confusing</SelectItem>
              <SelectItem value="idea">Feature idea — something that should exist</SelectItem>
              <SelectItem value="match">Match quality — a match seems wrong or a good one was missed</SelectItem>
              <SelectItem value="data">Data issue — something is incorrect or outdated</SelectItem>
            </SelectContent>
          </Select>

          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell me what you think, what confused you, what you wish existed, or what broke..."
            rows={5}
          />

          <Input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Your email (optional — only if you want a response)"
          />

          <Button
            onClick={() => submitMutation.mutate()}
            disabled={!message.trim() || submitMutation.isPending}
            className="w-full"
          >
            <MessageSquare className="h-4 w-4" />
            {submitMutation.isPending ? 'Sending...' : 'Send feedback'}
          </Button>
        </CardContent>
      </Card>

      {/* How to help */}
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <Heart className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-green-900 text-sm mb-2">Other ways to help</h3>
              <ul className="space-y-1.5 text-sm text-green-800">
                <li>Share Threadline with someone who works cold cases or missing persons</li>
                <li>If you find a strong match, note it — even if you can&apos;t act on it yourself</li>
                <li>Watch a few cases. Your attention is what keeps them alive.</li>
                <li>If you&apos;re in law enforcement or work with a nonprofit, I&apos;d love to talk</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
