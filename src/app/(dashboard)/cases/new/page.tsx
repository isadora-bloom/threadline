import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreateCaseForm } from '@/components/cases/CreateCaseForm'

export default function NewCasePage() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Create a new case</h1>
        <p className="text-sm text-slate-500 mt-1">
          Set up a new case file. You will be assigned as lead investigator.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Case details</CardTitle>
          <CardDescription>
            Basic information about this investigation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateCaseForm />
        </CardContent>
      </Card>
    </div>
  )
}
