'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ChevronLeft, ChevronRight, Plus, Trash2, AlertTriangle, Shield, ChevronDown, ChevronUp } from 'lucide-react'
import type { IntakeFormData, Step6Entity, ObservationMode, SubmitterConsent, EntityType, IdentifierSource, ConfidenceLevel } from '@/lib/types'
import { UPLOAD_LIMITS, ACCEPTED_MIME_TYPES, ACCEPTED_EXTENSIONS } from '@/lib/upload-config'

const TOTAL_STEPS = 9

interface Step6EntityRow extends Step6Entity {
  id: string
}

interface IntakeFormProps {
  token: string
  caseId: string
  onSuccess: (submissionId: string) => void
}

function newEntity(): Step6EntityRow {
  return {
    id: Math.random().toString(36).slice(2),
    entity_type: 'person',
    value: '',
    identifier_source: 'unknown',
    confidence: 'medium',
  }
}

export function IntakeForm({ token, caseId, onSuccess }: IntakeFormProps) {
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [observationMode, setObservationMode] = useState<ObservationMode>('observed_directly')
  const [eventDateKnown, setEventDateKnown] = useState<'exact' | 'approximate' | 'unknown'>('unknown')
  const [eventDate, setEventDate] = useState('')
  const [eventTime, setEventTime] = useState('')
  const [eventTimeOfDay, setEventTimeOfDay] = useState('')
  const [occurredMultipleTimes, setOccurredMultipleTimes] = useState(false)
  const [locationType, setLocationType] = useState<string>('unknown')
  const [eventLocation, setEventLocation] = useState('')
  const [locationImprecise, setLocationImprecise] = useState(false)
  const [rawText, setRawText] = useState('')
  const [firsthand, setFirsthand] = useState<'yes' | 'partly' | 'no'>('yes')
  const [secondhandSource, setSecondhandSource] = useState('')
  const [step6Entities, setStep6Entities] = useState<Step6EntityRow[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [fileErrors, setFileErrors] = useState<string[]>([])
  const [showFormats, setShowFormats] = useState(false)
  const [pasteLinks, setPasteLinks] = useState<string[]>([''])
  const [interpretationText, setInterpretationText] = useState('')
  const [submitterConsent, setSubmitterConsent] = useState<SubmitterConsent>('anonymous')
  const [submitterName, setSubmitterName] = useState('')
  const [submitterContact, setSubmitterContact] = useState('')

  const progress = (step / TOTAL_STEPS) * 100

  const canContinue = () => {
    if (step === 4 && !rawText.trim()) return false
    if (step === 9) {
      if (submitterConsent !== 'anonymous' && (!submitterName || !submitterContact)) return false
    }
    return true
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)

    try {
      const formData = {
        token,
        case_id: caseId,
        observation_mode: observationMode,
        event_date_known: eventDateKnown,
        event_date: eventDate || null,
        event_time: eventTime || null,
        event_time_of_day: eventTimeOfDay || null,
        occurred_multiple_times: occurredMultipleTimes,
        location_type: locationType,
        event_location: eventLocation || null,
        location_imprecise: locationImprecise,
        raw_text: rawText,
        firsthand: firsthand === 'yes' ? true : firsthand === 'partly',
        secondhand_source: secondhandSource || null,
        step6_entities: step6Entities.filter(e => e.value.trim()),
        paste_links: pasteLinks.filter(l => l.trim()),
        interpretation_text: interpretationText || null,
        submitter_consent: submitterConsent,
        submitter_name: submitterConsent !== 'anonymous' ? submitterName : null,
        submitter_contact: submitterConsent !== 'anonymous' ? submitterContact : null,
      }

      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const result = await res.json()

      if (!res.ok) {
        setError(result.error ?? 'Submission failed. Please try again.')
        setSubmitting(false)
        return
      }

      onSuccess(result.submission_id)
    } catch {
      setError('An unexpected error occurred. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress */}
      <div className="mb-8">
        <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
          <span>Step {step} of {TOTAL_STEPS}</span>
          <span>{Math.round(progress)}% complete</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Step 1: What are you reporting? */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">What are you reporting?</h2>
            <p className="text-sm text-slate-500 mt-1">
              Select the option that best describes your situation.
            </p>
          </div>

          <div className="space-y-2">
            {[
              { label: 'I saw something directly', mode: 'observed_directly' as ObservationMode },
              { label: 'I heard something directly', mode: 'heard_directly' as ObservationMode },
              { label: 'Someone told me something', mode: 'reported_by_another' as ObservationMode },
              { label: 'I have a document, record, or file', mode: 'inferred_from_document' as ObservationMode },
              { label: 'I know someone involved', mode: 'reported_by_another' as ObservationMode },
              { label: 'Something happened to me personally', mode: 'observed_directly' as ObservationMode },
              { label: 'Other information', mode: 'observed_directly' as ObservationMode },
            ].map((opt) => (
              <button
                key={opt.label}
                onClick={() => setObservationMode(opt.mode)}
                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                  observationMode === opt.mode && opt.label !== 'Other information' && opt.label !== 'I know someone involved'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                    : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: When? */}
      {step === 2 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">When did this happen?</h2>
          </div>

          <div className="space-y-3">
            <Label>How precisely do you know the date?</Label>
            {[
              { value: 'exact', label: 'I know the exact date and time' },
              { value: 'approximate', label: 'I know approximately when it was' },
              { value: 'unknown', label: "I don't know the exact date" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setEventDateKnown(opt.value as typeof eventDateKnown)}
                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                  eventDateKnown === opt.value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                    : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {eventDateKnown === 'exact' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Time (optional)</Label>
                <Input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
              </div>
            </div>
          )}

          {eventDateKnown === 'approximate' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Approximate date</Label>
                <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Time of day</Label>
                <Select value={eventTimeOfDay} onValueChange={setEventTimeOfDay}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="morning">Morning</SelectItem>
                    <SelectItem value="afternoon">Afternoon</SelectItem>
                    <SelectItem value="evening">Evening</SelectItem>
                    <SelectItem value="night">Night (late)</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>How often did this happen?</Label>
            {[
              { label: 'Once', value: false },
              { label: 'Multiple times or ongoing', value: true },
            ].map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => setOccurredMultipleTimes(opt.value)}
                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                  occurredMultipleTimes === opt.value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                    : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Where? */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Where did this happen?</h2>
          </div>

          <div className="space-y-2">
            <Label>Location type</Label>
            {[
              { value: 'specific_address', label: 'Specific address' },
              { value: 'named_place', label: 'Named place (e.g. park, business)' },
              { value: 'intersection', label: 'Intersection' },
              { value: 'general_area', label: 'General area or neighborhood' },
              { value: 'unknown', label: "I don't know the location" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setLocationType(opt.value)}
                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                  locationType === opt.value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                    : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {locationType !== 'unknown' && (
            <div className="space-y-1.5">
              <Label>Location description</Label>
              <Input
                placeholder={
                  locationType === 'specific_address'
                    ? '123 Main St, City, State'
                    : locationType === 'intersection'
                    ? 'Main St & 5th Ave'
                    : 'Describe the location...'
                }
                value={eventLocation}
                onChange={(e) => setEventLocation(e.target.value)}
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              id="imprecise"
              checked={locationImprecise}
              onCheckedChange={(c) => setLocationImprecise(!!c)}
            />
            <Label htmlFor="imprecise" className="cursor-pointer text-sm">
              I&apos;m not comfortable being more precise about the location
            </Label>
          </div>
        </div>
      )}

      {/* Step 4: What happened? */}
      {step === 4 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">What exactly did you observe?</h2>
            <p className="text-sm text-slate-500 mt-1">
              Describe only what you directly saw, heard, or experienced. Do not include what you think it means — there is a separate field for that.
            </p>
          </div>

          <Textarea
            placeholder="Describe what happened, in your own words..."
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            className="min-h-[200px] text-base"
          />

          <div className="p-3 bg-slate-50 rounded-md border border-slate-200 text-xs text-slate-500 space-y-1">
            <p className="font-medium text-slate-600">Optional prompts (you don&apos;t have to answer all of these):</p>
            <p>Who was involved? What exactly happened? What did you see, hear, or experience? In what order did events occur?</p>
          </div>
        </div>
      )}

      {/* Step 5: Firsthand? */}
      {step === 5 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Is this firsthand information?</h2>
          </div>

          <div className="space-y-2">
            {[
              { value: 'yes', label: 'Yes — I was present and directly observed or experienced this' },
              { value: 'partly', label: 'Partly — some of this is firsthand, some from someone else' },
              { value: 'no', label: 'No — someone told me this, or I read it somewhere' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFirsthand(opt.value as typeof firsthand)}
                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                  firsthand === opt.value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                    : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {(firsthand === 'partly' || firsthand === 'no') && (
            <div className="space-y-1.5">
              <Label>Who did this come from?</Label>
              <Textarea
                placeholder="You do not need to name them. Describe the relationship or context if comfortable (e.g. 'a neighbor', 'a post I saw online')..."
                value={secondhandSource}
                onChange={(e) => setSecondhandSource(e.target.value)}
                className="min-h-[80px]"
              />
            </div>
          )}
        </div>
      )}

      {/* Step 6: People, vehicles, identifiers */}
      {step === 6 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">People, vehicles, and identifiers</h2>
            <p className="text-sm text-slate-500 mt-1">
              If you have specific identifiers — names, phone numbers, vehicle descriptions, usernames — add them here. This is optional.
            </p>
          </div>

          {step6Entities.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">
              No identifiers added yet. Click below to add one.
            </p>
          )}

          <div className="space-y-4">
            {step6Entities.map((entity, idx) => (
              <div key={entity.id} className="p-4 border border-slate-200 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Identifier {idx + 1}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-slate-300 hover:text-red-400"
                    onClick={() => setStep6Entities(prev => prev.filter(e => e.id !== entity.id))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Type</Label>
                    <Select
                      value={entity.entity_type}
                      onValueChange={(v) => setStep6Entities(prev =>
                        prev.map(e => e.id === entity.id ? { ...e, entity_type: v as EntityType } : e)
                      )}
                    >
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="person">Person</SelectItem>
                        <SelectItem value="vehicle">Vehicle</SelectItem>
                        <SelectItem value="phone">Phone number</SelectItem>
                        <SelectItem value="username">Username / handle</SelectItem>
                        <SelectItem value="location">Address / location</SelectItem>
                        <SelectItem value="organization">Organization</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Value</Label>
                    <Input
                      placeholder="Enter value..."
                      value={entity.value}
                      onChange={(e) => setStep6Entities(prev =>
                        prev.map(en => en.id === entity.id ? { ...en, value: e.target.value } : en)
                      )}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">How do you know this?</Label>
                    <Select
                      value={entity.identifier_source}
                      onValueChange={(v) => setStep6Entities(prev =>
                        prev.map(e => e.id === entity.id ? { ...e, identifier_source: v as IdentifierSource } : e)
                      )}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="seen_directly">Saw directly</SelectItem>
                        <SelectItem value="heard_stated">Heard it stated</SelectItem>
                        <SelectItem value="found_in_document">Found in a document</SelectItem>
                        <SelectItem value="recalled_from_memory">Remembered it later</SelectItem>
                        <SelectItem value="inferred">Estimating or guessing</SelectItem>
                        <SelectItem value="unknown">Not sure</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">How sure are you?</Label>
                    <Select
                      value={entity.confidence}
                      onValueChange={(v) => setStep6Entities(prev =>
                        prev.map(e => e.id === entity.id ? { ...e, confidence: v as ConfidenceLevel } : e)
                      )}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">Very sure</SelectItem>
                        <SelectItem value="medium">Fairly sure</SelectItem>
                        <SelectItem value="low">Uncertain</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ))}

            <Button
              variant="outline"
              onClick={() => setStep6Entities(prev => [...prev, newEntity()])}
              className="w-full"
            >
              <Plus className="h-4 w-4" />
              Add identifier
            </Button>
          </div>
        </div>
      )}

      {/* Step 7: Files */}
      {step === 7 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Supporting files</h2>
            <p className="text-sm text-slate-500 mt-1">
              Upload documents, photos, audio, or video. This is optional. Max {UPLOAD_LIMITS.maxFiles} files, {UPLOAD_LIMITS.maxSizeLabel} each.
            </p>
          </div>

          {fileErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <ul className="list-disc list-inside space-y-0.5">
                  {fileErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
            <input
              type="file"
              multiple
              className="hidden"
              id="file-upload"
              accept={ACCEPTED_EXTENSIONS.join(',')}
              onChange={(e) => {
                if (!e.target.files) return
                const incoming = Array.from(e.target.files)
                const errors: string[] = []
                const valid: File[] = []

                for (const file of incoming) {
                  if (file.size > UPLOAD_LIMITS.maxSizeBytes) {
                    errors.push(`"${file.name}" is too large (max ${UPLOAD_LIMITS.maxSizeLabel})`)
                    continue
                  }
                  if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
                    errors.push(`"${file.name}" — file type not supported`)
                    continue
                  }
                  valid.push(file)
                }

                const next = [...files, ...valid]
                if (next.length > UPLOAD_LIMITS.maxFiles) {
                  errors.push(`Maximum ${UPLOAD_LIMITS.maxFiles} files allowed`)
                  valid.splice(UPLOAD_LIMITS.maxFiles - files.length)
                }

                setFileErrors(errors)
                setFiles(prev => {
                  const combined = [...prev, ...valid]
                  return combined.slice(0, UPLOAD_LIMITS.maxFiles)
                })
                // Reset input so the same file can be re-added after removal
                e.target.value = ''
              }}
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <p className="text-sm text-slate-600">
                Click to upload, or drag files here
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {files.length}/{UPLOAD_LIMITS.maxFiles} files selected
              </p>
            </label>
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              {files.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 border border-slate-200 rounded text-sm">
                  <div className="truncate min-w-0">
                    <span className="truncate text-slate-700">{file.name}</span>
                    <span className="text-xs text-slate-400 ml-2">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0"
                    onClick={() => setFiles(prev => prev.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Supported formats disclosure */}
          <div>
            <button
              type="button"
              onClick={() => setShowFormats(v => !v)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors"
            >
              {showFormats ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              What formats are supported?
            </button>
            {showFormats && (
              <div className="mt-2 p-3 bg-slate-50 rounded-md border border-slate-200 text-xs text-slate-600 space-y-1">
                <p><strong>Documents:</strong> PDF, DOC, DOCX, XLS, XLSX, TXT, CSV</p>
                <p><strong>Images:</strong> JPG, PNG, GIF, WEBP, HEIC</p>
                <p><strong>Audio:</strong> MP3, M4A, WAV, OGG, WEBA</p>
                <p><strong>Video:</strong> MP4, MOV, WEBM</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Or paste a link</Label>
            {pasteLinks.map((link, idx) => (
              <div key={idx} className="flex gap-2">
                <Input
                  placeholder="https://..."
                  value={link}
                  onChange={(e) => setPasteLinks(prev => prev.map((l, i) => i === idx ? e.target.value : l))}
                />
                {idx === pasteLinks.length - 1 && (
                  <Button variant="outline" size="icon" onClick={() => setPasteLinks(prev => [...prev, ''])}>
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 8: Interpretation */}
      {step === 8 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Your interpretation</h2>
            <div className="flex items-start gap-2 mt-2 p-3 bg-amber-50 rounded-md border border-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                This field is for beliefs, theories, or suspicions — beyond what you directly observed.
                What you write here will be <strong>clearly labeled as your interpretation</strong>, not as factual evidence.
                This is optional.
              </p>
            </div>
          </div>

          <Textarea
            placeholder="If you have a theory or belief about what this means, share it here. For example: 'I think this person might be...' or 'My suspicion is that...'"
            value={interpretationText}
            onChange={(e) => setInterpretationText(e.target.value)}
            className="min-h-[140px]"
          />
        </div>
      )}

      {/* Step 9: Your information */}
      {step === 9 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Your information</h2>
            <p className="text-sm text-slate-500 mt-1">
              Choose how you&apos;d like to submit.
            </p>
          </div>

          <div className="space-y-3">
            {[
              {
                value: 'anonymous',
                label: 'Submit anonymously',
                desc: 'Nothing about you is stored. We cannot follow up.',
              },
              {
                value: 'confidential',
                label: 'Submit confidentially',
                desc: 'Your name and contact are stored securely and never shared without your consent.',
              },
              {
                value: 'on_record',
                label: 'Submit on record',
                desc: 'Your name may be shared with investigators if relevant to the case.',
              },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSubmitterConsent(opt.value as SubmitterConsent)}
                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                  submitterConsent === opt.value
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <p className="font-medium text-sm text-slate-800">{opt.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>

          {submitterConsent !== 'anonymous' && (
            <div className="space-y-3 p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <Shield className="h-4 w-4 text-indigo-500" />
                Your information is encrypted and stored securely.
              </div>
              <div className="space-y-1.5">
                <Label>Your name *</Label>
                <Input
                  placeholder="Your name"
                  value={submitterName}
                  onChange={(e) => setSubmitterName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>How to contact you *</Label>
                <Input
                  placeholder="Phone, email, Signal, or other — your choice"
                  value={submitterContact}
                  onChange={(e) => setSubmitterContact(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setStep(Math.max(1, step - 1))}
          disabled={step === 1}
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>

        {step < TOTAL_STEPS ? (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={!canContinue()}
          >
            {step === 4 && !rawText.trim() ? 'Please describe what happened' : 'Continue'}
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={submitting || !canContinue()}
            className="min-w-[120px]"
          >
            {submitting ? 'Submitting...' : 'Submit report'}
          </Button>
        )}
      </div>
    </div>
  )
}
