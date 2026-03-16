'use client'

import { useRouter } from 'next/navigation'
import { IntakeForm } from '@/components/intake/IntakeForm'

interface IntakeFormWrapperProps {
  token: string
  caseId: string
}

export function IntakeFormWrapper({ token, caseId }: IntakeFormWrapperProps) {
  const router = useRouter()

  const handleSuccess = (submissionId: string) => {
    void submissionId
    router.push(`/submit/${token}/success`)
  }

  return (
    <IntakeForm
      token={token}
      caseId={caseId}
      onSuccess={handleSuccess}
    />
  )
}
