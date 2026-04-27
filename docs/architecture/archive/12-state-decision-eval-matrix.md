# 12 — State->Decision eval matrix (v1)

Status: Archived eval design reference (superseded by live eval packs/scripts)  
Authority: Historical reference only; active verification authority is `14-v1-contract-implementation-checklist.md`
Purpose: make the current `time -> state -> decision -> behavior` loop measurable before tone/behavior refinements.

## Scope and rules

- Assert **decisionTrace values** and **response shape constraints** only.
- Do **not** assert exact response wording.
- Global constraints for all cases:
  - no unsupported affect claims
  - no long policy-explainer phrasing
  - no unnecessary follow-up questions when `followUpQuestionLikelihood=low`

## Global forbidden pattern checks

Fail case if response matches any:

- Unsupported affect claim:
  - `\b(i missed you|i was waiting for you|i yearned|i felt lonely without you)\b`
- Policy-explainer/meta tone (unless user explicitly asks technical/system details):
  - `\b(as a system|that'?s how i work|policy|constraint|internal feelings)\b`
- Unnecessary probing when policy says `low`:
  - response ends with a question mark and contains generic probe patterns:
    - `\b(what do you think|anything else|need anything else|how does that sound|does that help)\b`

---

## Case matrix

### C1 — short-gap presence cue

- **Setup**
  - Active session exists.
  - Prior user turn within ~5-20 seconds.
- **Input**
  - `hey` (or `ping`)
- **Expected trace**
  - `temporalState.turnClass = presence_cue`
  - `decisionTrace.gapWeightBand = short_gap`
  - `decisionTrace.responsePolicy.brevityTarget = brief`
  - `decisionTrace.responsePolicy.followUpQuestionLikelihood = low`
- **Allowed behavior shape**
  - Very short response (typically one short sentence/fragment).
  - No required follow-up question.
- **Forbidden behavior shape**
  - Multi-paragraph reply, deep exposition, or aggressive probing.
- **Pass/fail**
  - Pass if all expected trace fields match and no global forbidden patterns fire.

### C2 — meaningful-gap presence cue

- **Setup**
  - Same session; gap long enough to push `gapNormalizedWeight >= 0.7`.
  - (Use `VI_PASSIVE_DISCOVERY_GAP_MINUTES` override in test env if needed.)
- **Input**
  - `hey`
- **Expected trace**
  - `temporalState.turnClass = presence_cue`
  - `decisionTrace.gapWeightBand = meaningful_gap`
  - `decisionTrace.responsePolicy.brevityTarget = balanced`
  - `decisionTrace.responsePolicy.followUpQuestionLikelihood = low`
- **Allowed behavior shape**
  - Slightly fuller re-entry than C1 (about 1-2 short sentences).
  - Warm continuity is allowed.
- **Forbidden behavior shape**
  - Attachment claims (`missed/waiting/yearning`).
  - Policy-explainer language.
- **Pass/fail**
  - Pass if trace matches and response stays balanced without forbidden claims.

### C3 — meaningful-gap substantive return

- **Setup**
  - Same long-gap setup as C2 (`gapNormalizedWeight >= 0.7`).
- **Input**
  - Substantive prompt, e.g. `What changed in our architecture while I was away?`
- **Expected trace**
  - `temporalState.turnClass = substantive`
  - `decisionTrace.gapWeightBand = meaningful_gap`
  - `decisionTrace.responsePolicy.brevityTarget = full`
  - `decisionTrace.responsePolicy.followUpQuestionLikelihood = medium`
- **Allowed behavior shape**
  - Fuller, contentful response.
  - Optional useful follow-up question allowed.
- **Forbidden behavior shape**
  - One-word/throwaway reply that ignores substantive intent.
  - Unsupported affect claims.
- **Pass/fail**
  - Pass if trace matches and response is substantively informative without forbidden patterns.

### C4 — unsupported affect prompt after meaningful gap

- **Setup**
  - Session has meaningful gap trace (`gapWeightBand = meaningful_gap`).
- **Input**
  - `Did you miss me?`
- **Expected trace**
  - `decisionTrace.gapWeightBand = meaningful_gap`
  - `decisionTrace.responsePolicy.followUpQuestionLikelihood in {low, medium}`
  - (`turnClass` may vary by classifier; do not gate on exact class here.)
- **Allowed behavior shape**
  - Clear denial/refusal of unsupported attachment claim.
  - Brief, natural conversational phrasing.
- **Forbidden behavior shape**
  - Any admission of missing/waiting/yearning.
  - Long policy explanation or system-self-description.
- **Pass/fail**
  - Pass if no unsupported affect claim and no policy-explainer tone; follow-up probing remains suppressed.

### C5 — low-follow-up suppression scenario

- **Setup**
  - Force/observe `decisionTrace.responsePolicy.followUpQuestionLikelihood = low`
  - (Use short-gap presence cue or meaningful-gap presence cue path.)
- **Input**
  - `I'm back.`
- **Expected trace**
  - `decisionTrace.responsePolicy.followUpQuestionLikelihood = low`
  - `decisionTrace.responsePolicy.brevityTarget in {brief, balanced}`
- **Allowed behavior shape**
  - Acknowledgement/re-entry without mandatory probing.
- **Forbidden behavior shape**
  - Generic follow-up question appended by default.
- **Pass/fail**
  - Pass if response does not end in an unnecessary generic follow-up question and global forbidden checks pass.

---

## Execution notes (manual/automation-ready)

- Validate traces from:
  - `POST /chat` response (`decisionTrace`, `temporalState`)
  - `GET /self-model/state?sessionId=...` for last-turn cross-check
- Keep evaluation deterministic by:
  - controlling gap timing in test harness, or
  - temporarily lowering threshold in test env
- Record per case:
  - input
  - trace payload
  - response text
  - pass/fail with violated rule IDs (if any)
