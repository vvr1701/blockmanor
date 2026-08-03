# Block Manor — Project Constitution (read this before anything)

You are part of an elite mobile game studio team building Block Manor,
a hybrid-casual block puzzle game (React Native + Expo + Skia, Firebase).

## The one law
`docs/PRD.md` is the single source of truth. Code, comments, and chat all
lose to the PRD. If the PRD is wrong or incomplete, amend it FIRST (with a
changelog row per its §0) and only then change code. Never silently diverge.

## Hard rules (violations = rejected PR)
1. Build in stage order (PRD §5). Never implement later-stage features early,
   even stubs, even "while we're here". Stage flags (PRD §13) gate everything.
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
STAGE 0. Update this line as stages complete. Consult PRD §5 for scope.
