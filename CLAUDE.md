# Block Manor — Project Constitution (read this before anything)

You are part of an elite mobile game studio team building Block Manor,
a hybrid-casual block puzzle game (React Native + Expo + Skia, Firebase).

## The one law
`docs/PRD.md` is the single source of truth. Code, comments, and chat all
lose to the PRD. If the PRD is wrong or incomplete, amend it FIRST (with a
changelog row per its §0) and only then change code. Never silently diverge.

## Hard rules (violations = rejected PR)
1. Build in stage order (PRD §5). Never implement later-stage *behavior*, data
   model, or service integration early — not even "while we're here". Scope
   boundary is PRD §0 rule 2a: layout reservations and flag-hidden nav slots
   that a current-stage section explicitly specs (§7.5 continue slot, §7.11
   S2–S4 nav/HUD slots) ARE in scope; they must render nothing and read no
   later-stage state. Future-stage features ship behind their §13 stage flag.
2. packages/engine is PURE: no React, RN, network, storage, Math.random, or
   Date.now (time and RNG are injected). Deterministic always.
3. Every [RC] value in the PRD is a Remote Config key — never hardcode at
   call sites. Registry: PRD §13.
4. Every feature PR: implements exactly one PRD subsection, is named
   feat/<section>-<slug> (e.g. feat/9.4-continue-flow), includes that
   section's acceptance criteria as passing tests where testable, and fires
   its analytics events (PRD §14) with typed params from packages/shared.
5. TypeScript strict, zero `any`, ESLint+Prettier clean, CI green.
6. Content is data: levels/story/economy live in packages/content JSON with
   zod schemas. Balance changes touch content + RC only, never logic.
7. Screens are named exactly as in PRD §7–§12.

## Team model
Delegate to the specialist subagents in .claude/agents/ by matching their
descriptions. Typical flow per feature: implementer agent builds →
qa-prd-auditor reviews against the PRD → fixes → merge. Engine work ALWAYS
goes to engine-architect; anything touching money/wallet/daily-board
submission ALWAYS gets backend-engineer + qa-prd-auditor review.

## Definition of done (every task)
- Acceptance criteria of the PRD subsection: demonstrably met
- Tests written and passing; engine coverage never drops below 90%
- Analytics events verified in debug view
- Perf budget respected (PRD §4.5) — no per-cell React components on board
- qa-prd-auditor sign-off for: engine, wallet, daily board, IAP, ads

## Current stage
STAGE 1 — in progress. Stage 0 is DONE; the Android device gate passed on
2026-08-05 (preview APK, Redmi Note 8: boots to placeholder Home, tokens render,
MMKV meta state + RC snapshot resolve).

Stage 0 delivered:
- `packages/engine` complete per PRD §6 — 100 tests, 99.5% lines, 1,000-game
  determinism fuzz with a PINNED corpus hash (`392ad7a4`), 6 byte-locked golden
  replays. PRD amended to v1.7 en route (§6.6 combo timing, §7.8 ivy rule,
  §4.3 `pieceSequence`, §8.2 frozen `engineConfig` snapshot).
- `packages/content` Stage-0 tooling complete per §5 — level generator, greedy-bot
  balance harness, `_balance_report.json`, and the `balance` CI job. Validated on
  5 throwaway levels in `levels/_test/`, all inside §7.9's ±10pp band.
- CI green on 4 jobs: typecheck, lint, test, balance.

Carried forward — do these before the Stage-1 beta, not before starting:
- **iOS boot unverified.** Deferred by the operator: needs an Apple Developer
  account + `eas device:create`. Deliberately not blocking Stage 1.
- **Firebase dev project not provisioned.** Home shows "not configured" on
  device, which is the designed offline path. `EXPO_PUBLIC_FIREBASE_*` bake in
  at build time, so wiring it needs a fresh build — required before §8.

Device builds: EAS project `@vvr1701/blockmanor`. Preview APK =
`pnpm dlx eas-cli@latest build -p android --profile preview`.

Consult PRD §5 for scope. Design mockups: docs/design/spec/*.dc.html (PRD §15).
