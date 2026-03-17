'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import {
  Camera,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  FileImage,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

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
  caseId: string
}

export function ScreenshotCapture({ caseId }: Props) {
  const [open, setOpen] = useState(false)
  const [images, setImages] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [extracting, setExtracting] = useState(false)
  const [extraction, setExtraction] = useState<Extraction | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRawText, setShowRawText] = useState(false)
  const [removedClaimIndexes, setRemovedClaimIndexes] = useState<Set<number>>(new Set())
  const [removedEntityIndexes, setRemovedEntityIndexes] = useState<Set<number>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const { toast } = useToast()

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

  const analyze = async () => {
    if (!images.length) return
    setExtracting(true)
    setError(null)
    setExtraction(null)

    const fd = new FormData()
    fd.append('caseId', caseId)
    images.forEach(img => fd.append('images', img))

    try {
      const res = await fetch('/api/ai/extract-screenshot', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Extraction failed')
      setExtraction(data.extraction)
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
          caseId,
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

      toast({ description: `Submission created with ${activeClaims.length} claims and ${activeEntities.length} entities.` })
      setOpen(false)
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
    setExtraction(null)
    setError(null)
    setExtracting(false)
    setSaving(false)
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Camera className="h-4 w-4" />
        Quick Capture
      </Button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" onPaste={handlePaste}>
          <DialogHeader>
            <DialogTitle>Quick Screenshot Capture</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Drop zone */}
            {!images.length && (
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
            )}

            {/* Image previews */}
            {images.length > 0 && (
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

                {!extraction && !extracting && (
                  <Button onClick={analyze} className="w-full">
                    Analyze with AI
                  </Button>
                )}
              </div>
            )}

            {/* Loading */}
            {extracting && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                <p className="text-sm text-slate-600">Analyzing screenshot{images.length > 1 ? 's' : ''}…</p>
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
                    <span>Source: <span className="font-medium text-slate-700 capitalize">{extraction.source_type.replace(/_/g, ' ')}</span></span>
                    {extraction.event_date && <span>Date: <span className="font-medium text-slate-700">{extraction.event_date}</span></span>}
                    {extraction.event_location && <span>Location: <span className="font-medium text-slate-700">{extraction.event_location}</span></span>}
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
                    {showRawText ? 'Hide' : 'Show'} extracted text ({extraction.extracted_text.split(/\s+/).length} words)
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
                              if (next.has(i)) next.delete(i)
                              else next.add(i)
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
                              if (next.has(i)) next.delete(i)
                              else next.add(i)
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
                  <Button
                    variant="outline"
                    onClick={() => {
                      setExtraction(null)
                      setError(null)
                      setRemovedClaimIndexes(new Set())
                      setRemovedEntityIndexes(new Set())
                    }}
                  >
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
