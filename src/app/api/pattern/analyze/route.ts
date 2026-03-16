import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { caseId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { caseId } = body
  if (!caseId) {
    return NextResponse.json({ error: 'caseId is required' }, { status: 400 })
  }

  // Check role — must be lead_investigator or admin
  const { data: roleData } = await supabase
    .from('case_user_roles')
    .select('role')
    .eq('case_id', caseId)
    .eq('user_id', user.id)
    .single()

  if (!roleData || (roleData.role !== 'lead_investigator' && roleData.role !== 'admin')) {
    return NextResponse.json({ error: 'Forbidden — lead investigator or admin only' }, { status: 403 })
  }

  // Get pattern settings for this case
  const { data: settings } = await supabase
    .from('case_pattern_settings')
    .select('proximity_radius_miles, temporal_window_days')
    .eq('case_id', caseId)
    .single()

  const radiusMiles = settings?.proximity_radius_miles ?? 15
  const temporalWindowDays = settings?.temporal_window_days ?? 90

  // Fetch all submission IDs for this case
  const { data: submissions } = await supabase
    .from('submissions')
    .select('id')
    .eq('case_id', caseId)

  const submissionIds = submissions?.map((s) => s.id) ?? []
  if (submissionIds.length === 0) {
    return NextResponse.json({ flagsGenerated: 0, linksScored: 0 })
  }

  // Fetch all claims for this case
  const { data: claims } = await supabase
    .from('claims')
    .select('id, event_date, claim_type, submission_id')
    .in('submission_id', submissionIds)

  if (!claims || claims.length === 0) {
    return NextResponse.json({ flagsGenerated: 0, linksScored: 0 })
  }

  const claimIds = claims.map((c) => c.id)

  // Fetch existing link scores to avoid re-computing
  const { data: existingLinks } = await supabase
    .from('link_scores')
    .select('claim_a_id, claim_b_id')
    .eq('case_id', caseId)

  const existingPairs = new Set(
    (existingLinks ?? []).map((l) => `${l.claim_a_id}__${l.claim_b_id}`)
  )

  // Fetch entity links for all claims to find candidates for scoring
  const { data: entityLinks } = await supabase
    .from('claim_entity_links')
    .select('claim_id, entity_id')
    .in('claim_id', claimIds)

  // Build: entity -> set of claims
  const entityToClaims = new Map<string, Set<string>>()
  for (const link of entityLinks ?? []) {
    if (!entityToClaims.has(link.entity_id)) {
      entityToClaims.set(link.entity_id, new Set())
    }
    entityToClaims.get(link.entity_id)!.add(link.claim_id)
  }

  // Build candidate pairs — claims that share at least one entity
  const candidatePairs = new Set<string>()
  for (const [, claimSet] of entityToClaims) {
    const arr = Array.from(claimSet)
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i] < arr[j] ? arr[i] : arr[j]
        const b = arr[i] < arr[j] ? arr[j] : arr[i]
        const key = `${a}__${b}`
        if (!existingPairs.has(key)) {
          candidatePairs.add(key)
        }
      }
    }
  }

  // Also consider temporally close claims
  const claimsByDate = claims
    .filter((c) => c.event_date)
    .sort((a, b) => new Date(a.event_date!).getTime() - new Date(b.event_date!).getTime())

  for (let i = 0; i < claimsByDate.length; i++) {
    for (let j = i + 1; j < claimsByDate.length; j++) {
      const dateA = new Date(claimsByDate[i].event_date!)
      const dateB = new Date(claimsByDate[j].event_date!)
      const diffDays = Math.abs(dateB.getTime() - dateA.getTime()) / (1000 * 60 * 60 * 24)
      if (diffDays > temporalWindowDays) break
      const a = claimsByDate[i].id < claimsByDate[j].id ? claimsByDate[i].id : claimsByDate[j].id
      const b = claimsByDate[i].id < claimsByDate[j].id ? claimsByDate[j].id : claimsByDate[i].id
      const key = `${a}__${b}`
      if (!existingPairs.has(key)) {
        candidatePairs.add(key)
      }
    }
  }

  // Score all candidate pairs
  let linksScored = 0
  const newLinkScores: Array<{
    case_id: string
    claim_a_id: string
    claim_b_id: string
    score: number
    grade: string
    signals: Record<string, unknown>
    distance_miles: number | null
  }> = []

  for (const pair of candidatePairs) {
    const [claimAId, claimBId] = pair.split('__')

    const { data: scoreResult, error: scoreError } = await supabase.rpc('compute_link_score', {
      p_claim_a_id: claimAId,
      p_claim_b_id: claimBId,
      p_radius_miles: radiusMiles,
    })

    if (scoreError || !scoreResult || scoreResult.length === 0) continue

    const result = scoreResult[0]

    newLinkScores.push({
      case_id: caseId,
      claim_a_id: claimAId,
      claim_b_id: claimBId,
      score: result.score,
      grade: result.grade,
      signals: (result.signals as Record<string, unknown>) ?? {},
      distance_miles: result.distance_miles ?? null,
    })

    linksScored++
  }

  // Insert link scores in batches
  if (newLinkScores.length > 0) {
    const batchSize = 50
    for (let i = 0; i < newLinkScores.length; i += batchSize) {
      await supabase.from('link_scores').upsert(newLinkScores.slice(i, i + batchSize), {
        onConflict: 'claim_a_id,claim_b_id',
        ignoreDuplicates: false,
      })
    }
  }

  // Generate pattern flags

  // Get all link scores for this case (including newly computed ones)
  const { data: allLinkScores } = await supabase
    .from('link_scores')
    .select('id, claim_a_id, claim_b_id, score, grade, signals, distance_miles')
    .eq('case_id', caseId)
    .in('grade', ['notable', 'strong', 'very_strong'])

  // Get existing flags to avoid duplicates
  const { data: existingFlags } = await supabase
    .from('pattern_flags')
    .select('flag_type, involved_claim_ids, involved_entity_ids, signals')
    .eq('case_id', caseId)

  const flagsToInsert: Array<{
    case_id: string
    flag_type: string
    title: string
    description: string
    involved_claim_ids: string[]
    involved_entity_ids: string[]
    score: number | null
    grade: string | null
    signals: Record<string, unknown>
  }> = []

  let flagsGenerated = 0

  // Flag each notable+ link score that doesn't already have a flag
  for (const ls of allLinkScores ?? []) {
    const sortedPair = [ls.claim_a_id, ls.claim_b_id].sort()
    const alreadyFlagged = (existingFlags ?? []).some(
      (f) =>
        f.flag_type === 'temporal_cluster' &&
        f.involved_claim_ids &&
        sortedPair.every((id) => f.involved_claim_ids.includes(id))
    )
    if (alreadyFlagged) continue

    const gradeLabel =
      ls.grade === 'very_strong'
        ? 'very strong'
        : ls.grade === 'strong'
        ? 'strong'
        : ls.grade === 'notable'
        ? 'notable'
        : ls.grade

    flagsToInsert.push({
      case_id: caseId,
      flag_type: 'temporal_cluster',
      title: `${gradeLabel.charAt(0).toUpperCase() + gradeLabel.slice(1)} signal between two claims — surfaced for review`,
      description: `Two claims scored ${ls.score} points (${gradeLabel}) on the link scoring model. This has been surfaced for investigator review. Score does not indicate any confirmed relationship.`,
      involved_claim_ids: [ls.claim_a_id, ls.claim_b_id],
      involved_entity_ids: [],
      score: ls.score,
      grade: ls.grade,
      signals: (ls.signals as Record<string, unknown>) ?? {},
    })
    flagsGenerated++
  }

  // Geographic recurrence: 3+ claims within proximity radius
  const { data: geoEntities } = await supabase
    .from('entities')
    .select('id, lat, lng, normalized_value, raw_value')
    .eq('case_id', caseId)
    .eq('entity_type', 'location')
    .not('lat', 'is', null)
    .not('lng', 'is', null)

  if (geoEntities && geoEntities.length >= 3) {
    // Get claim counts per location entity
    const { data: locationEntityLinks } = await supabase
      .from('claim_entity_links')
      .select('entity_id, claim_id')
      .in('entity_id', geoEntities.map((e) => e.id))

    const entityClaimCounts = new Map<string, string[]>()
    for (const link of locationEntityLinks ?? []) {
      if (!entityClaimCounts.has(link.entity_id)) {
        entityClaimCounts.set(link.entity_id, [])
      }
      entityClaimCounts.get(link.entity_id)!.push(link.claim_id)
    }

    // Find clusters of 3+ entities within radiusMiles
    const clusterEntities = geoEntities.filter(
      (e) => (entityClaimCounts.get(e.id)?.length ?? 0) >= 1
    )

    if (clusterEntities.length >= 3) {
      const alreadyFlagged = (existingFlags ?? []).some(
        (f) => f.flag_type === 'geographic_recurrence'
      )
      if (!alreadyFlagged) {
        const allClaimIds = clusterEntities
          .flatMap((e) => entityClaimCounts.get(e.id) ?? [])
          .filter((v, i, a) => a.indexOf(v) === i)

        flagsToInsert.push({
          case_id: caseId,
          flag_type: 'geographic_recurrence',
          title: `Possible geographic recurrence — ${clusterEntities.length} location entities surfaced`,
          description: `${clusterEntities.length} geocoded location entities appear in claims for this case. Surfaced for review to determine whether a geographic pattern may be present.`,
          involved_claim_ids: allClaimIds.slice(0, 20),
          involved_entity_ids: clusterEntities.map((e) => e.id),
          score: null,
          grade: null,
          signals: { location_entity_count: clusterEntities.length },
        })
        flagsGenerated++
      }
    }
  }

  // Entity frequency: entity appearing in 10%+ of all claims
  const totalClaimCount = claimIds.length
  const entityClaimCounts = new Map<string, string[]>()
  for (const link of entityLinks ?? []) {
    if (!entityClaimCounts.has(link.entity_id)) {
      entityClaimCounts.set(link.entity_id, [])
    }
    entityClaimCounts.get(link.entity_id)!.push(link.claim_id)
  }

  const threshold = Math.max(3, Math.ceil(totalClaimCount * 0.1))
  for (const [entityId, linkedClaimIds] of entityClaimCounts) {
    if (linkedClaimIds.length >= threshold) {
      const alreadyFlagged = (existingFlags ?? []).some(
        (f) =>
          f.flag_type === 'entity_frequency' &&
          f.involved_entity_ids &&
          f.involved_entity_ids.includes(entityId)
      )
      if (!alreadyFlagged) {
        flagsToInsert.push({
          case_id: caseId,
          flag_type: 'entity_frequency',
          title: `Frequently appearing entity — surfaced for review`,
          description: `An entity appears in ${linkedClaimIds.length} of ${totalClaimCount} claims (${Math.round((linkedClaimIds.length / totalClaimCount) * 100)}%). Surfaced for review — frequent appearance does not imply significance.`,
          involved_claim_ids: linkedClaimIds.slice(0, 20),
          involved_entity_ids: [entityId],
          score: null,
          grade: null,
          signals: {
            claim_count: linkedClaimIds.length,
            total_claims: totalClaimCount,
            percentage: Math.round((linkedClaimIds.length / totalClaimCount) * 100),
          },
        })
        flagsGenerated++
      }
    }
  }

  // Corridor clusters: 3+ location entities on same highway
  const { data: corridorEntities } = await supabase
    .from('entities')
    .select('id, nearest_highway, highway_proximity, lat, lng')
    .eq('case_id', caseId)
    .eq('entity_type', 'location')
    .not('nearest_highway', 'is', null)

  if (corridorEntities && corridorEntities.length > 0) {
    const highwayCounts = new Map<string, string[]>()
    for (const e of corridorEntities) {
      if (e.nearest_highway && e.highway_proximity === 'on_route') {
        if (!highwayCounts.has(e.nearest_highway)) {
          highwayCounts.set(e.nearest_highway, [])
        }
        highwayCounts.get(e.nearest_highway)!.push(e.id)
      }
    }

    for (const [highway, entityIds] of highwayCounts) {
      if (entityIds.length >= 3) {
        const alreadyFlagged = (existingFlags ?? []).some(
          (f) =>
            f.flag_type === 'highway_corridor_cluster' &&
            f.signals &&
            (f.signals as Record<string, unknown>).highway === highway
        )
        if (!alreadyFlagged) {
          const corridorClaimIds = entityIds
            .flatMap((id) => entityClaimCounts.get(id) ?? [])
            .filter((v, i, a) => a.indexOf(v) === i)

          flagsToInsert.push({
            case_id: caseId,
            flag_type: 'highway_corridor_cluster',
            title: `Possible corridor pattern along ${highway} — surfaced for review`,
            description: `${entityIds.length} location entities are mapped near ${highway}. Surfaced for investigator review — proximity to a corridor does not confirm any pattern.`,
            involved_claim_ids: corridorClaimIds.slice(0, 20),
            involved_entity_ids: entityIds,
            score: null,
            grade: null,
            signals: { highway, entity_count: entityIds.length },
          })
          flagsGenerated++
        }
      }
    }
  }

  // Time-of-day clusters: 3+ claims in same 4-hour window
  const claimsWithTime = claims.filter((c) => c.event_date)
  const hourBuckets = new Map<number, string[]>()
  for (const c of claimsWithTime) {
    const hour = new Date(c.event_date!).getHours()
    const bucket = Math.floor(hour / 4) * 4 // 0, 4, 8, 12, 16, 20
    if (!hourBuckets.has(bucket)) hourBuckets.set(bucket, [])
    hourBuckets.get(bucket)!.push(c.id)
  }

  for (const [bucket, bucketClaimIds] of hourBuckets) {
    if (bucketClaimIds.length >= 3) {
      const alreadyFlagged = (existingFlags ?? []).some(
        (f) =>
          f.flag_type === 'time_of_day_cluster' &&
          f.signals &&
          (f.signals as Record<string, unknown>).hour_bucket === bucket
      )
      if (!alreadyFlagged) {
        const endHour = bucket + 4
        flagsToInsert.push({
          case_id: caseId,
          flag_type: 'time_of_day_cluster',
          title: `Possible time-of-day pattern (${bucket}:00–${endHour}:00) — surfaced for review`,
          description: `${bucketClaimIds.length} claims have event times between ${bucket}:00 and ${endHour}:00. This has been surfaced for review — time clustering does not imply a confirmed pattern.`,
          involved_claim_ids: bucketClaimIds.slice(0, 20),
          involved_entity_ids: [],
          score: null,
          grade: null,
          signals: { hour_bucket: bucket, claim_count: bucketClaimIds.length },
        })
        flagsGenerated++
      }
    }
  }

  // Insert all new flags
  if (flagsToInsert.length > 0) {
    const batchSize = 20
    for (let i = 0; i < flagsToInsert.length; i += batchSize) {
      await supabase.from('pattern_flags').insert(flagsToInsert.slice(i, i + batchSize))
    }
  }

  // Upsert case_pattern_settings to record last analysis time
  await supabase
    .from('case_pattern_settings')
    .upsert(
      {
        case_id: caseId,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'case_id' }
    )

  // Log review action
  await supabase.from('review_actions').insert({
    actor_id: user.id,
    action: 'flagged',
    target_type: 'case',
    target_id: caseId,
    case_id: caseId,
    note: `Pattern analysis run: ${linksScored} links scored, ${flagsGenerated} flags generated`,
  })

  return NextResponse.json({ flagsGenerated, linksScored })
}
