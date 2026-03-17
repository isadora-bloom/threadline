'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import {
  Zap,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  FileImage,
  ChevronDown,
  ChevronUp,
  ChevronRight,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface CaseOption {
  id: string
  title: string
}

interface ExtractedEntity {
  entity_type: string
  raw_value: string
  confidence: string
  entity_role: string
  notes?: string | null
}

interface ExtractedClaim {
  extracted_text: string
  claim_type: string
  confidence: string
  notes?: string | null
}

interface Extraction {
  content_type: string
  platform: string | null
  extracted_text: string
  summary: string
  source_type: string
  observation_mode: string
  firsthand: boolean
  event_date: string | null
  event_location: string | null
  entities: ExtractedEntity[]
  claims: ExtractedClaim[]
  investigator_notes: string | null
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-slate-100 text-slate-600',
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  person: 'Person',
  location: 'Location',
  vehicle: 'Vehicle',
  phone: 'Phone',
  username: 'Username',
  organization: 'Organization',
  document: 'Document',
  other: 'Other',
}

const CLAIM_TYPE_LABELS: Record<string, string> = {
  sighting: 'Sighting',
  identifier: 'Identifier',
  association: 'Association',
  statement: 'Statement',
  interpretation: 'Interpretation',
  official: 'Official',
  behavioral: 'Behavioral',
  physical_description: 'Physical Description',
  forensic_countermeasure: 'Forensic Countermeasure',
  scene_staging: 'Scene Staging',
  disposal_method: 'Disposal Method',
}

interface Props {
  /** If provided, pre-selects this case and hides the case selector */
  caseId?: string
  /** Render as a custom trigger instead of the default sidebar button */
  trigger?: React.ReactNode
}

export function QuickCapture({ caseId: initialCaseId, trigger }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'image' | 'text'>('image')

  // Case selection
  const [cases, setCases] = useState<CaseOption[]>([])
  const [casesLoading, setCasesLoading] = useState(false)
  const [selectedCaseId, setSelectedCaseId] = useState(initialCaseId ?? '')

  // Image mode
  const [images, setImages] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Text mode
  const [textInput, setTextInput] = useState('')

  // Shared
  const [extracting, setExtracting] = useState(false)
  const [extraction, setExtraction] = useState<Extraction | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRawText, setShowRawText] = useState(false)
  const [removedClaimIndexes, setRemovedClaimIndexes] = useState<Set<number>>(new Set())
  const [removedEntityIndexes, setRemovedEntityIndexes] = useState<Set<number>>(new Set())

  const router = useRouter()
  const { toast } = useToast()
  const supabase = createClient()

  // Global keyboard shortcut: Ctrl/Cmd + Shift + Space
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'Space') {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Keep selectedCaseId in sync if initialCaseId changes
  useEffect(() => {
    if (initialCaseId) setSelectedCaseId(initialCaseId)
  }, [initialCaseId])

  // Fetch cases when dialog opens and no caseId is pre-selected
  useEffect(() => {
    if (!open || initialCaseId) return
    setCasesLoading(true)
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('case_user_roles')
        .select('case_id, cases(id, title)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      const list: CaseOption[] = (data ?? [])
        .map((r: { case_id: string; cases: { id: string; title: string } | null }) => r.cases)
        .filter((c): c is CaseOption => !!c)
      setCases(list)
      if (list.length === 1) setSelectedCaseId(list[0].id)
      setCasesLoading(false)
    }
    load()
  }, [open, initialCaseId, supabase])

  // Image handlers
  const handleFiles = useCallback((files: FileList | File[]) => {
    const valid = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, 5)
    if (!valid.length) return
    setImages(valid)
    setPreviews(valid.map(f => URL.createObjectURL(f)))
    setExtraction(null)
    setError(null)
    setRemovedClaimIndexes(new Set())
    setRemovedEntityIndexes(new Set())
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    const imageFiles = items
      .filter(i => i.type.startsWith('image/'))
      .map(i => i.getAsFile())
      .filter((f): f is File => f !== null)
    if (imageFiles.length) handleFiles(imageFiles)
  }, [handleFiles])

  const removeImage = (idx: number) => {
    const next = images.filter((_, i) => i !== idx)
    const nextP = previews.filter((_, i) => i !== idx)
    setImages(next)
    setPreviews(nextP)
    if (!next.length) {
      setExtraction(null)
      setError(null)
    }
  }

  const canAnalyze = selectedCaseId && (
    (tab === 'image' && images.length > 0) ||
    (tab === 'text' && textInput.trim().length > 20)
  )

  const analyze = async () => {
    if (!canAnalyze) return
    setExtracting(true)
    setError(null)
    setExtraction(null)
    setRemovedClaimIndexes(new Set())
    setRemovedEntityIndexes(new Set())

    try {
      let data: { extraction?: Extraction; error?: string }

      if (tab === 'image') {
        const fd = new FormData()
        fd.append('caseId', selectedCaseId)
        images.forEach(img => fd.append('images', img))
        const res = await fetch('/api/ai/extract-screenshot', { method: 'POST', body: fd })
        data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Extraction failed')
      } else {
        const res = await fetch('/api/ai/extract-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseId: selectedCaseId, text: textInput }),
        })
        data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Extraction failed')
      }

      setExtraction(data.extraction!)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      setExtracting(false)
    }
  }

  const save = async () => {
    if (!extraction) return
    setSaving(true)

    const activeClaims = extraction.claims.filter((_, i) => !removedClaimIndexes.has(i))
    const activeEntities = extraction.entities.filter((_, i) => !removedEntityIndexes.has(i))

    try {
      const res = await fetch('/api/ai/create-from-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: selectedCaseId,
          raw_text: extraction.extracted_text,
          summary: extraction.summary,
          source_type: extraction.source_type,
          observation_mode: extraction.observation_mode,
          firsthand: extraction.firsthand,
          event_date: extraction.event_date,
          event_location: extraction.event_location,
          notes: extraction.investigator_notes,
          claims: activeClaims,
          entities: activeEntities,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')

      toast({
        description: `Filed to case — ${activeClaims.length} claim${activeClaims.length !== 1 ? 's' : ''}, ${activeEntities.length} entit${activeEntities.length !== 1 ? 'ies' : 'y'}.`,
      })
      handleClose()
      router.refresh()
    } catch (err) {
      toast({ variant: 'destructive', description: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    setOpen(false)
    setImages([])
    setPreviews([])
    setTextInput('')
    setExtraction(null)
    setError(null)
    setExtracting(false)
    setSaving(false)
    setShowRawText(false)
    setRemovedClaimIndexes(new Set())
    setRemovedEntityIndexes(new Set())
    if (!initialCaseId) setSelectedCaseId('')
  }

  const resetExtraction = () => {
    setExtraction(null)
    setError(null)
    setRemovedClaimIndexes(new Set())
    setRemovedEntityIndexes(new Set())
  }

  const caseName = initialCaseId
    ? null
    : cases.find(c => c.id === selectedCaseId)?.title

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)} className="cursor-pointer">{trigger}</span>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
          title="Quick Capture (Ctrl+Shift+Space)"
        >
          <Zap className="h-4 w-4 flex-shrink-0" />
          Quick Capture
          <span className="ml-auto text-[10px] text-indigo-400 font-mono hidden xl:block">⌃⇧Space</span>
        </button>
      )}

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent
          className="max-w-2xl max-h-[90vh] overflow-y-auto"
          onPaste={handlePaste}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-indigo-500" />
              Quick Capture
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Case selector — only shown when not pre-selected */}
            {!initialCaseId && (
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1.5">File into case</label>
                {casesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400 h-9">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading cases…
                  </div>
                ) : cases.length === 0 ? (
                  <p className="text-xs text-slate-400">No cases found.</p>
                ) : (
                  <div className="relative">
                    <select
                      value={selectedCaseId}
                      onChange={e => setSelectedCaseId(e.target.value)}
                      className="w-full appearance-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    >
                      <option value="">— Select a case —</option>
                      {cases.map(c => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                    <ChevronRight className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 rotate-90 pointer-events-none" />
                  </div>
                )}
              </div>
            )}

            {/* Filing target label when pre-selected */}
            {initialCaseId && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span>Filing into current case</span>
              </div>
            )}

            {/* Input tabs */}
            {!extraction && !extracting && (
              <Tabs value={tab} onValueChange={v => { setTab(v as 'image' | 'text'); setError(null) }}>
                <TabsList className="w-full">
                  <TabsTrigger value="image" className="flex-1">Screenshot / Image</TabsTrigger>
                  <TabsTrigger value="text" className="flex-1">Paste Text</TabsTrigger>
                </TabsList>

                <TabsContent value="image" className="mt-3">
                  {!images.length ? (
                    <div
                      onDrop={handleDrop}
                      onDragOver={e => e.preventDefault()}
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-200 rounded-lg p-10 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
                    >
                      <Upload className="h-8 w-8 text-slate-400 mx-auto mb-3" />
                      <p className="text-sm font-medium text-slate-700">Drop screenshots here</p>
                      <p className="text-xs text-slate-400 mt-1">or click to browse · paste with Ctrl+V · up to 5 images</p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={e => e.target.files && handleFiles(e.target.files)}
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {previews.map((src, i) => (
                          <div key={i} className="relative group">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt="" className="h-20 w-auto rounded border border-slate-200 object-cover" />
                            <button
                              onClick={() => removeImage(i)}
                              className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-slate-700 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="h-20 w-16 border-2 border-dashed border-slate-200 rounded flex items-center justify-center text-slate-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
                        >
                          <FileImage className="h-5 w-5" />
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={e => e.target.files && handleFiles(e.target.files)}
                        />
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="text" className="mt-3">
                  <Textarea
                    placeholder="Paste an article, tip, social media post, message transcript, or any text with information relevant to this case…"
                    value={textInput}
                    onChange={e => setTextInput(e.target.value)}
                    className="min-h-[180px] text-sm resize-y font-mono leading-relaxed"
                  />
                  {textInput.length > 0 && textInput.length < 20 && (
                    <p className="text-xs text-slate-400 mt-1">Enter at least 20 characters to analyze.</p>
                  )}
                </TabsContent>
              </Tabs>
            )}

            {/* Analyze button */}
            {!extraction && !extracting && canAnalyze && (
              <Button onClick={analyze} className="w-full">
                Analyze with AI
              </Button>
            )}

            {/* Loading */}
            {extracting && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                <p className="text-sm text-slate-600">
                  {tab === 'image'
                    ? `Analyzing screenshot${images.length > 1 ? 's' : ''}…`
                    : 'Extracting information from text…'}
                </p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-red-50 border border-red-100">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Extraction results */}
            {extraction && (
              <div className="space-y-4">
                {/* Case filing target */}
                {!initialCaseId && caseName && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 pb-1 border-b border-slate-100">
                    <span>Filing into</span>
                    <span className="font-medium text-slate-700">{caseName}</span>
                  </div>
                )}

                {/* Summary card */}
                <div className="rounded-lg border border-slate-200 p-4 bg-slate-50 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-800">{extraction.summary}</p>
                    <div className="flex gap-1 shrink-0">
                      {extraction.content_type && (
                        <Badge variant="secondary" className="text-xs capitalize">
                          {extraction.content_type.replace(/_/g, ' ')}
                        </Badge>
                      )}
                      {extraction.platform && (
                        <Badge variant="outline" className="text-xs">{extraction.platform}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>
                      Source:{' '}
                      <span className="font-medium text-slate-700 capitalize">
                        {extraction.source_type.replace(/_/g, ' ')}
                      </span>
                    </span>
                    {extraction.event_date && (
                      <span>Date: <span className="font-medium text-slate-700">{extraction.event_date}</span></span>
                    )}
                    {extraction.event_location && (
                      <span>Location: <span className="font-medium text-slate-700">{extraction.event_location}</span></span>
                    )}
                  </div>
                  {extraction.investigator_notes && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 border border-amber-100">
                      ⚑ {extraction.investigator_notes}
                    </p>
                  )}
                </div>

                {/* Extracted text toggle */}
                <div>
                  <button
                    onClick={() => setShowRawText(v => !v)}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                  >
                    {showRawText ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {showRawText ? 'Hide' : 'Show'} source text ({extraction.extracted_text.split(/\s+/).length} words)
                  </button>
                  {showRawText && (
                    <div className="mt-2 rounded border border-slate-200 bg-white p-3">
                      <p className="text-xs text-slate-700 whitespace-pre-wrap font-mono">{extraction.extracted_text}</p>
                    </div>
                  )}
                </div>

                {/* Claims */}
                {extraction.claims.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                      Claims ({extraction.claims.length - removedClaimIndexes.size} of {extraction.claims.length})
                    </p>
                    <div className="space-y-2">
                      {extraction.claims.map((claim, i) => (
                        <div
                          key={i}
                          className={`flex items-start gap-2 p-2.5 rounded border text-sm transition-opacity ${
                            removedClaimIndexes.has(i)
                              ? 'opacity-30 bg-slate-50 border-slate-100'
                              : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-slate-800 text-sm leading-snug">{claim.extracted_text}</p>
                            <div className="flex gap-1.5 mt-1 flex-wrap">
                              <Badge variant="secondary" className="text-[10px] h-4">
                                {CLAIM_TYPE_LABELS[claim.claim_type] || claim.claim_type}
                              </Badge>
                              <span className={`inline-flex items-center rounded px-1.5 text-[10px] font-medium ${CONFIDENCE_COLORS[claim.confidence] || CONFIDENCE_COLORS.low}`}>
                                {claim.confidence} confidence
                              </span>
                            </div>
                            {claim.notes && <p className="text-[11px] text-slate-400 mt-1">{claim.notes}</p>}
                          </div>
                          <button
                            onClick={() => {
                              const next = new Set(removedClaimIndexes)
                              if (next.has(i)) { next.delete(i) } else { next.add(i) }
                              setRemovedClaimIndexes(next)
                            }}
                            className="shrink-0 text-slate-300 hover:text-slate-600 mt-0.5"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Entities */}
                {extraction.entities.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                      Entities ({extraction.entities.length - removedEntityIndexes.size} of {extraction.entities.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {extraction.entities.map((entity, i) => (
                        <div
                          key={i}
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-opacity ${
                            removedEntityIndexes.has(i)
                              ? 'opacity-30 bg-slate-50 border-slate-100 text-slate-400'
                              : 'bg-white border-slate-200 text-slate-700'
                          }`}
                        >
                          <span className="text-slate-400 text-[10px] uppercase font-medium">
                            {ENTITY_TYPE_LABELS[entity.entity_type] || entity.entity_type}
                          </span>
                          <span className="font-medium">{entity.raw_value}</span>
                          <button
                            onClick={() => {
                              const next = new Set(removedEntityIndexes)
                              if (next.has(i)) { next.delete(i) } else { next.add(i) }
                              setRemovedEntityIndexes(next)
                            }}
                            className="text-slate-300 hover:text-slate-600 ml-0.5"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <Button onClick={save} disabled={saving} className="flex-1">
                    {saving ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Saving…</>
                    ) : (
                      <><CheckCircle2 className="h-4 w-4 mr-1.5" />Add to Case</>
                    )}
                  </Button>
                  <Button variant="outline" onClick={resetExtraction}>
                    Re-analyze
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
