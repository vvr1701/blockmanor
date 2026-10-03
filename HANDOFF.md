# HANDOFF — Block Manor, to a new coding agent

Written 2026-09-30, updated 2026-10-03, at PRD v1.46, `main` @ `a28d23c`. This project was built
by a human operator (vvr1701) working with Claude Code. It's changing hands to
a different coding agent (a GPT-based tool) to build the remaining stages
through launch. This file is the onboarding brief — read it first, then read
the two files it points at, before touching any code.

## Read these, in this order, before writing anything

1. **`CLAUDE.md`** (repo root) — the project constitution. Short, dense, and
   non-negotiable. It states the stage-gating rule, the engine-purity rule,
   the Remote Config discipline, the branch/PR naming convention, and the
   money-path audit requirement. Every rule in it has been enforced for real,
   repeatedly, in this project's history — they are not aspirational.
2. **`docs/PRD.md`** — the single source of truth for what the product is and
   does. ~640 lines. This is not a wishlist; every `[RC]` value, every screen
   name, every event name in it is load-bearing — code reads these values and
   names literally. **The §0 rule that matters most: if the PRD is wrong or
   incomplete, you amend the PRD FIRST (with a changelog row), then write
   code. Never the other way around.** The changelog at the top of the file
   (currently ~40 rows, v1.0 → v1.40) is not decoration — it's a decision
   log. Skim it; it tells you *why* things are the way they are, which the
   section text alone often doesn't.
3. **`BUILD_STATE.md`** — the full session-by-session build log. Very long.
   Don't read it front to back; use it as a reference when you hit a
   surprising design choice and want to know why. The "AWAITING HUMAN"
   section near the end lists outstanding operator/business tasks (secrets,
   accounts, domain) that block things regardless of which coding tool is
   building.

## What this project is

A hybrid-casual mobile block-puzzle game (React Native + Expo + Skia,
Firebase backend), monorepo layout: `packages/engine` (pure deterministic
game logic), `packages/content` (levels/balance, data not code),
`packages/shared` (types/analytics/RC registry shared client+server),
`apps/mobile` (the app), `backend/functions` (Cloud Functions).

## Current state (verify with `git log --oneline main` before trusting this — it will be stale the moment someone else commits)

**Stage 0 and Stage 1: done.** Engine complete and fuzz-tested, full daily-board
anti-cheat system, 16 screens, FTUE, analytics. Stage 1's closed-beta metrics
gate was explicitly waived by the operator (PRD v1.34) — Stage 2 started
without beta data. That's a recorded, deliberate risk, not an oversight.

**Stage 2 (Economy + Monetization, PRD §9–§10) — in progress:**
- §9.1 Coin wallet — **merged.** Server-authoritative, `grantCoins`/`spendCoins`
  callables, idempotency-keyed ledger, Firestore rules deny all direct client
  writes. `flag_economy` is deliberately OFF — it's the operator's launch
  switch, not a stage-boundary auto-flip, because it also gates the Shop nav
  tab and `ShopScreen` (§10.3) doesn't exist yet. See PRD v1.35(e)/v1.36.
- §9.2 Lives — **merged to `main`** (PRD-amended, v1.41–v1.44). Client-side
  (MMKV), not server-authoritative — see v1.41(a) for the full reasoning. The
  operator signed off on all three business decisions the auditor correctly
  refused to approve itself: lives being client- not server-authoritative
  (v1.41(a)), shipping this PR with the out-of-lives gate dormant/unwired
  (v1.42(a)) — and, for the device-clock-manipulation exploit (v1.42(e)),
  explicitly declined to just accept it and directed a real fix instead. That
  fix (v1.43, corrected v1.44 after a qa-prd-auditor FAIL) adds
  `apps/mobile/modules/device-uptime`, a local Expo native module exposing
  monotonic boot-uptime, and clamps regen credit to it — closing the exploit
  completely, at the cost of a disclosed fairness-only residual: any device
  reboot forfeits regen accrued before it (no clock survives a power cycle).
  **Not yet `[device]`-verified** — this needs a fresh native dev-client
  build (new native module, autolinking must re-run) before the real
  on-device clamp is confirmed; JS logic is fully unit-tested. **Known scope
  gap, intentional:** the out-of-lives gate
  (`canStartLevel`) and refill button are dormant primitives with no UI
  caller yet — a named follow-up PR (`feat/9.2-out-of-lives-sheet`) owns
  wiring them up once §16.1 names the sheet. **Do not turn `flag_economy` on
  before that follow-up lands** — until then lives would drain with nothing
  that ever blocks or shows them.
- §9.3 Boosters — **merged, engine + client, both audited.** `hammer`/
  `broom`/`hourglass` fully usable. NOT wired: `GameConfig.startScore` for
  the win-streak x5+ "+200" bonus (pre-approved in PRD, small isolated
  addition, just not built yet — see v1.37(viii)/v1.40(xii)).
- §9.4 Fail→Continue flow — **merged** (engine `reliefClear` + client:
  `ContinueSheet`, `OutOfCoinsSheet`, `continueFlow.ts`). PRD-amended to
  v1.46. Two qa-prd-auditor rounds: round 1 FAILed on a reproduced
  double-charge BLOCKER plus 4 MAJORs (all fixed); round 2 passed the code
  but found 2 of the new regression tests didn't exercise what they claimed
  — closed, self-verified (no third audit — see `CLAUDE.md`'s current
  operator guidance: one audit is enough for a small fix). Second chance's
  daily cap and the Give-up confirm copy both got explicit operator rulings
  along the way (v1.46(b)/(f)) — read that changelog row before touching
  this subsection, it has real traps (a background-flush pattern that looks
  reasonable but double-charges; a day-boundary cap that looks reasonable but
  resets via the clock).
- §10.1–§10.3 (rewarded ads, interstitials, IAP catalog) — **not started at
  all.** And can't fully complete: no AdMob account, no RevenueCat account
  exist yet (operator/business task, see `BUILD_STATE.md`'s AWAITING HUMAN
  list). You CAN and should build the code-side integration points (the
  RC-priced sinks, the UI, the callable stubs) the same way §9.1 shipped its
  backend dormant before UI caught up — just don't expect a live ad or a
  live purchase to actually complete without those accounts.

**Stage 3 (Manor meta + story) and Stage 4 (LiveOps + social): not started.**
Stage 3's PRD sections (§11) are a real spec; Stage 4's (§11.5) is
deliberately a sketch — PRD says its full spec lands as amendments before
Stage 4 begins, so don't build Stage 4 code from guesses about what the
sketch implies.

**Per PRD §5, Stage 3 is gated on Stage-2 metrics** (D7 retention ≥15%, ads
ARPDAU ≥$0.015) that don't exist without a live audience. The operator waived
an analogous gate once already (Stage 1→2) via an explicit PRD amendment —
whether to do that again for Stage 2→3 is the operator's call, not yours;
don't silently skip it the way the beta-gate waiver wasn't silent.

## Hard rules (condensed — `CLAUDE.md` has the full text, this is not a substitute)

1. Build in stage order. Never implement later-stage behavior early.
2. `packages/engine` is PURE — no React/RN/network/storage/`Math.random`/
   `Date.now`. Every engine change needs a `qa-prd-auditor`-equivalent review
   (in this new setup: whatever your own rigorous review step is) — this
   repo's history shows real production bugs caught exactly this way,
   repeatedly, including after full test suites already passed.
3. Every `[RC]`-tagged value in the PRD is a Remote Config key — read it from
   config, never hardcode it at a call site. Registry is PRD §13.
4. One PRD subsection per branch/PR, named `feat/<section>-<slug>`.
5. TypeScript strict, zero `any`, lint+format clean, full test suite green,
   before you call anything done.
6. Content (levels/story/economy) is data in `packages/content` JSON with
   zod schemas — balance changes touch content + RC, never engine logic.
7. **Anything touching money (wallet, IAP, ads) or the daily board needs a
   real adversarial review before merge, not just passing tests.** This
   project's history has several real bugs (a scoring-inversion bug, a
   backwards-clock stall, a dead permission gate with a comment lying about
   it) that ALL passed full test suites and were caught only by a dedicated
   review pass that actively tried to break the code rather than confirm it
   worked. Don't skip this step to move faster — it's what's kept this
   codebase actually correct, not just tested.

## Verification commands

```bash
pnpm exec turbo run typecheck lint test --force   # full monorepo check
cd packages/shared && npx vitest run test/prdChangelog.test.ts   # PRD self-consistency
```

Emulator suite (Firestore rules + callables) needs a JDK 21 (`firebase-tools`
refuses JDK 17): `backend/functions` — check `BUILD_STATE.md`'s "Environment
gotchas" section for the exact command and any JDK path already set up on
this machine.

Local Android build (device/emulator testing): a JDK 17 + Linux Android SDK
were set up under `~/tools/` on this machine specifically because the
operator's own Android Studio SDK is Windows-side (WSL2 environment) and
can't build for the WSL-side emulator directly. If you're not in that exact
environment, this won't apply — use whatever local build path makes sense
for wherever this is running now.

## If you hit an ambiguity the PRD doesn't answer

Don't guess and silently implement your guess. This project's entire
discipline — and the reason its changelog has 40 rows — is: flag it, propose
a ruling, get it confirmed (by the operator, or by your own best judgment if
operating autonomously and the ambiguity is genuinely low-stakes), write the
ruling into the PRD with a changelog row, THEN build against it. A PRD
amendment costs a few minutes. A silent guess that turns out wrong costs a
rebuild plus however many other things got built on top of the wrong
assumption in the meantime.
