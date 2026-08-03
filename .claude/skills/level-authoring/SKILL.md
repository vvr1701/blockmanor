---
name: level-authoring
description: The data-driven level pipeline — generator parameters, greedy-bot balance harness, curve targets, balance reports, and OTA retuning from live analytics. Load when creating, validating, or retuning levels or daily-board templates.
---
# Level Authoring Pipeline

## Never hand-guess difficulty
Every level ships with simulated evidence. Pipeline:
1. Generate candidates from parameters: prefill (density %, pattern class:
   edges/bands/scatter/mid-fragments), obstacle mix, goals, piece-weight
   overrides, mercy on/off
2. Bot harness: greedy AI (maximize immediate clears, tiebreak on keeping
   large-piece placeability) plays each candidate ×500 seeds via simulate()
3. Accept if bot win-rate within ±10pp of the slot's §7.9 target; else
   adjust dials and regenerate
4. Commit levels + _balance_report.json (per level: winRate, medianMoves,
   p10/p90 score for star thresholds)

## Difficulty dials (weakest → strongest)
goal tightness → prefill density → prefill placement (mid-board fragments
are brutal) → obstacle compounding (ivy+chain interact) → piece-weight
overrides (invisible to players — use sparingly, feels unfair if extreme)

## Star thresholds
s2 ≈ p40 of winning bot scores, s3 ≈ p10 — then round to friendly numbers.

## Live retuning loop (post-beta)
- Pull level_fail / level_quit / attempts-per-level weekly
- Compute bot→human win-rate offset from levels with n≥100 attempts
- Any level >25% quit-after-fail or outside human-adjusted target: retune,
  re-simulate, ship via EAS Update same week (PRD §7.9)
- Never fix a level by changing engine rules

## Daily-board templates (§8.2)
Curated prefill patterns only (no obstacles), 6–14 cells, must pass the
median-15-placements bot check ×200 trials; keep a visual variety log so
consecutive days never look alike.
