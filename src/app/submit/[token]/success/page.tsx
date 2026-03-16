export default function SubmitSuccessPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mb-6">
          <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 mb-3">
          Thank you for sharing
        </h1>

        <p className="text-slate-600 mb-6">
          Your report has been received and is secure. A trained volunteer reviewer will read it carefully.
        </p>

        <div className="text-left space-y-3 bg-white rounded-lg border border-slate-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-800">What happens next</h2>
          <div className="space-y-2 text-sm text-slate-600">
            <div className="flex gap-3">
              <span className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">1</span>
              <span>A case volunteer will review your submission, typically within a few days.</span>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">2</span>
              <span>Specific claims will be extracted and catalogued alongside other information.</span>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">3</span>
              <span>If you submitted contact information and there are follow-up questions, someone may reach out.</span>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">4</span>
              <span>When enough corroborated information is gathered, it may be shared with relevant authorities or investigators.</span>
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-100 rounded-lg text-sm text-slate-600">
          <p className="font-medium text-slate-700 mb-1">Your privacy is protected</p>
          <p>
            If you submitted anonymously, no information about you was stored. If you submitted confidentially, your contact information is encrypted and will not be shared without your consent.
          </p>
        </div>
      </div>
    </div>
  )
}
