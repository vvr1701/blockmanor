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

## Dial behavior notes (learned the hard way — Stage 0, don't rediscover)

**Density is NOT monotonic in difficulty.** More prefill can make a level
EASIER, because a partly-filled row needs fewer cells to complete. Measured on
the `edges` pattern with a fixed goal: d=0.15 → 51% win, d=0.25 → 40%,
d=0.3 → 46%, d=0.35 → 67%, d=0.4 → 100% (median 1 move — the prefill
practically solves it). The curve falls, then climbs, then collapses into
triviality. Never assume "denser = harder" and never bisect on density
expecting a monotonic response — sweep the whole range and read the shape.
`scatter` is the one class that behaves monotonically; `edges` and
`mid-fragments` do not.

**500 seeds is the MINIMUM for an accept/reject decision.** At p≈0.7, 150
seeds carries ~±7.5pp of sampling noise at 95% confidence — wider than the
±10pp acceptance band itself, so a 150-seed run cannot tell "in band" from
"out". Two Stage-0 fixtures passed at 150 and failed at 500 (70%→57.4%,
50%→35.4%). Sweep cheap at 150 to find candidates; **always confirm at 500
before committing.** 500 seeds gives ~±4pp, which fits inside the band.

**Measure with the level id AND seedSalt you will actually ship.** The salt IS
the layout — same density and pattern under a different salt is a different
board with a different win-rate. The **id** matters too: the harness derives its
per-playout seeds from it (`L<id>-s<n>` / `bot-<id>-<n>`), so sweeping under id
1 and shipping under id 904 measures a different seed stream and lands a few pp
off the real gate. Measuring one and shipping the other silently voids the
balance evidence. `balance/sweep.bal.ts` takes both as required inputs for this
reason — use it rather than rolling a one-off probe.

**Reject `medianMoves < 8`.** A level the bot finishes in one or two
placements has a meaningless win-rate: the prefill did the work, not the
player. Check median moves alongside win-rate on every accept.

## Star thresholds
s2 ≈ p40 of winning bot scores, s3 ≈ p10 — counted **from the top**, i.e. the
score the best 40% and best 10% of WINNING runs reach. In ascending-percentile
terms that is p60 and p90. Round to friendly numbers, and force s3 > s2: on a
tight score spread both round to the same value, and §7.5 needs the 3rd star
strictly harder than the 2nd.

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
