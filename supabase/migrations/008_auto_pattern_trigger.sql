-- When a claim is approved (verification_status changes to 'corroborated' or 'confirmed'),
-- automatically compute link scores against other recent claims in the same case
-- and generate pattern flags for notable+ pairs.

CREATE OR REPLACE FUNCTION auto_score_claim_links()
RETURNS TRIGGER AS $$
DECLARE
  v_other_claim RECORD;
  v_score INTEGER;
  v_grade TEXT;
  v_signals JSONB;
  v_distance_miles NUMERIC;
  v_case_settings case_pattern_settings%ROWTYPE;
  v_radius_miles INTEGER;
BEGIN
  -- Only trigger on status change to corroborated or confirmed
  IF NEW.verification_status NOT IN ('corroborated', 'confirmed') THEN
    RETURN NEW;
  END IF;
  IF OLD.verification_status = NEW.verification_status THEN
    RETURN NEW;
  END IF;

  -- Get case pattern settings (default radius 15 miles)
  SELECT * INTO v_case_settings
  FROM case_pattern_settings
  WHERE case_id = NEW.case_id;

  v_radius_miles := COALESCE(v_case_settings.proximity_radius_miles, 15);

  -- Score against other approved claims in this case (last 90 days, excluding self)
  FOR v_other_claim IN
    SELECT id FROM claims
    WHERE case_id = NEW.case_id
    AND id != NEW.id
    AND verification_status IN ('corroborated', 'confirmed')
    AND (
      NEW.event_date IS NULL
      OR event_date IS NULL
      OR ABS(EXTRACT(EPOCH FROM (NEW.event_date - event_date)) / 86400) <= 90
    )
    AND NOT EXISTS (
      SELECT 1 FROM link_scores
      WHERE (claim_a_id = NEW.id AND claim_b_id = v_other_claim.id)
         OR (claim_a_id = v_other_claim.id AND claim_b_id = NEW.id)
    )
  LOOP
    -- Compute score
    SELECT ls.score, ls.grade, ls.signals, ls.distance_miles
    INTO v_score, v_grade, v_signals, v_distance_miles
    FROM compute_link_score(NEW.id, v_other_claim.id, v_radius_miles) ls;

    -- Only save if score > 0
    IF v_score > 0 THEN
      INSERT INTO link_scores (
        case_id, claim_a_id, claim_b_id,
        score, grade, signals, distance_miles
      ) VALUES (
        NEW.case_id,
        LEAST(NEW.id::text, v_other_claim.id::text)::uuid,
        GREATEST(NEW.id::text, v_other_claim.id::text)::uuid,
        v_score, v_grade, v_signals, v_distance_miles
      )
      ON CONFLICT (claim_a_id, claim_b_id) DO UPDATE
        SET score = EXCLUDED.score,
            grade = EXCLUDED.grade,
            signals = EXCLUDED.signals,
            generated_at = now();

      -- Generate pattern flag for notable+ pairs not already flagged
      IF v_grade IN ('notable', 'strong', 'very_strong') THEN
        INSERT INTO pattern_flags (
          case_id,
          flag_type,
          title,
          description,
          involved_claim_ids,
          score,
          grade,
          signals
        ) VALUES (
          NEW.case_id,
          'geographic_recurrence',
          'Possible connection between two claims — surfaced for review',
          'Two approved claims share signals that may be worth examining together. Review the full context before drawing any conclusions.',
          ARRAY[NEW.id, v_other_claim.id],
          v_score,
          v_grade,
          v_signals
        )
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to claims table
DROP TRIGGER IF EXISTS trg_auto_score_claim_links ON claims;
CREATE TRIGGER trg_auto_score_claim_links
  AFTER UPDATE OF verification_status ON claims
  FOR EACH ROW
  EXECUTE FUNCTION auto_score_claim_links();
