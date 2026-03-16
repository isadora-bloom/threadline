import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateString: string | null | undefined, includeTime = false): string {
  if (!dateString) return 'Unknown date'
  const date = new Date(dateString)
  if (includeTime) {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDate(dateString)
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return str.slice(0, length) + '...'
}

export function labelForCaseType(type: string): string {
  const labels: Record<string, string> = {
    missing_person: 'Missing Person',
    unidentified_remains: 'Unidentified Remains',
    homicide: 'Homicide',
    assault: 'Assault',
    trafficking: 'Trafficking',
    other: 'Other',
  }
  return labels[type] ?? type
}

export function labelForCaseStatus(status: string): string {
  const labels: Record<string, string> = {
    active: 'Active',
    inactive: 'Inactive',
    closed: 'Closed',
    archived: 'Archived',
  }
  return labels[status] ?? status
}

export function labelForReviewStatus(status: string): string {
  const labels: Record<string, string> = {
    unverified: 'Unverified',
    under_review: 'Under Review',
    corroborated: 'Corroborated',
    confirmed: 'Confirmed',
    disputed: 'Disputed',
    retracted: 'Retracted',
  }
  return labels[status] ?? status
}

export function labelForClaimType(type: string): string {
  const labels: Record<string, string> = {
    sighting: 'Sighting',
    identifier: 'Identifier',
    association: 'Association',
    statement: 'Statement',
    interpretation: 'Interpretation',
    official: 'Official',
    behavioral: 'Behavioral',
    physical_description: 'Physical Description',
  }
  return labels[type] ?? type
}

export function labelForEntityType(type: string): string {
  const labels: Record<string, string> = {
    person: 'Person',
    location: 'Location',
    vehicle: 'Vehicle',
    phone: 'Phone',
    username: 'Username',
    organization: 'Organization',
    document: 'Document',
    other: 'Other',
  }
  return labels[type] ?? type
}

export function labelForEntityRole(role: string): string {
  const labels: Record<string, string> = {
    subject: 'Subject',
    vehicle_seen: 'Vehicle Seen',
    associate_mentioned: 'Associate Mentioned',
    location_reference: 'Location Reference',
    identifier_fragment: 'Identifier Fragment',
    witness: 'Witness',
    victim: 'Victim',
    unknown: 'Unknown',
  }
  return labels[role] ?? role
}

export function labelForIdentifierSource(source: string): string {
  const labels: Record<string, string> = {
    seen_directly: 'Seen directly',
    heard_stated: 'Heard stated',
    found_in_document: 'Found in document',
    recalled_from_memory: 'Recalled from memory',
    inferred: 'Inferred',
    unknown: 'Unknown',
  }
  return labels[source] ?? source
}

export function labelForObservationMode(mode: string): string {
  const labels: Record<string, string> = {
    observed_directly: 'Observed directly',
    heard_directly: 'Heard directly',
    reported_by_another: 'Reported by another',
    inferred_from_document: 'Inferred from document',
    system_generated: 'System generated',
  }
  return labels[mode] ?? mode
}

export function labelForUserRole(role: string): string {
  const labels: Record<string, string> = {
    contributor: 'Contributor',
    reviewer: 'Reviewer',
    lead_investigator: 'Lead Investigator',
    legal: 'Legal',
    export_only: 'Export Only',
    admin: 'Admin',
  }
  return labels[role] ?? role
}

export function labelForAuditAction(action: string): string {
  const labels: Record<string, string> = {
    created: 'Created',
    edited: 'Edited',
    approved: 'Approved',
    disputed: 'Marked Disputed',
    retracted: 'Retracted',
    merged: 'Merged',
    split: 'Split',
    flagged: 'Flagged',
    escalated: 'Escalated',
    exported: 'Exported',
    viewed: 'Viewed',
  }
  return labels[action] ?? action
}

export function getPublicSubmitUrl(token: string): string {
  const baseUrl = typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${baseUrl}/submit/${token}`
}
