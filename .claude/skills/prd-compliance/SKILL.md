---
name: prd-compliance
description: How to work with docs/PRD.md as the source of truth — reading order, amendment procedure, stage gating, and the [RC] value convention. Load whenever starting a feature, resolving an ambiguity, or when code and spec seem to conflict.
---
# PRD Compliance

## Reading order for any task
1. §0 (rules of the document) → 2. §5 (confirm what the current stage
allows) → 3. the specific subsection you're implementing, fully → 4. §13
(which of your values are RC keys) → 5. §14 (which events you must fire)
→ 6. §16 (conventions).

## When code and PRD conflict
The PRD wins. Fix the code. If the PRD is genuinely wrong (contradicts
itself, impossible, or a decision changed): amend the PRD FIRST — edit the
section, add a changelog row (version bump, date, one-line change), THEN
change code in the same PR. A PR that diverges from the PRD without a PRD
diff in it is invalid.

## Stage gating
Nothing from a future stage gets built, stubbed, or "prepared for" beyond
what the current stage's spec says (e.g. §7.5 explicitly reserves the
continue-button slot — that reservation IS the spec; adding the button is
not). Feature flags in §13 default off for future-stage features.

## [RC] convention
Any value marked [RC, default] in the PRD is read from the Remote Config
snapshot (useConfigStore), never hardcoded at a call site. Adding a new
tunable = add to §13 registry + defaults file + typed accessor.

## Acceptance criteria
Each subsection ends with acceptance criteria. Convert every testable
criterion into an actual test. Non-testable ones (feel, visual) go in the
PR description as a manual-verification checklist.
