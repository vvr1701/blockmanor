# BLOCK MANOR — Product Requirements Document (Source of Truth)

**Version:** 1.0 · **Date:** 2026-08-02 · **Status:** Approved for build
**Product type:** Hybrid-casual mobile puzzle game · **Platforms:** Android + iOS
**Stack:** React Native + Expo + react-native-skia · TypeScript everywhere · Firebase backend

---

## 0. HOW TO USE THIS DOCUMENT (instructions for coding agents)

1. This PRD is the **single source of truth**. If code, tickets, or chat instructions conflict with this document, this document wins. If this document is wrong, it must be amended here FIRST, with a changelog entry, before code changes.
2. Build strictly in **stage order** (§5). Do not implement features from a later stage early, even partially, unless the stage's Definition of Done is complete.
3. All numeric values marked `[RC]` are **Remote Config keys** (§13). Implement them as remote-configurable with the listed default. Never hardcode them at call sites.
4. All game logic lives in the pure engine package (§6). The engine MUST remain free of React, React Native, rendering, storage, network, and time-of-day dependencies. Any PR that imports such a dependency into the engine is rejected.
5. Every user-facing feature ships behind a feature flag (§13) defaulting per its stage.
6. Every feature spec in §7–§12 ends with **Acceptance Criteria**. A feature is not done until all criteria pass and its analytics events (§14) fire correctly.
7. Naming, file structure, and conventions in §16 are mandatory.

**Changelog**
| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-02 | Initial approved PRD |
| 1.1 | 2026-08-02 | Added §7.11 Home screen spec, §12.9 empty states, music spec in §15, returning-payer offer note in §10.3, store-asset list in §17 |
| 1.2 | 2026-08-04 | Added §15.1 complete audio manifest (named SFX inventory, mixing rules, size budget) |
| 1.3 | 2026-08-04 | Added purchase result states (§10.3), in-app review prompt (§12.9a), soft update nudge (§12.9b) to match final design pack |

---

## 1. VISION

**One line:** The block puzzle the whole world plays together, once a day, forever.

Block Manor fuses three proven systems into one product:
1. **Block Blast's core** — the most instantly-understood, lowest-CPI puzzle mechanic in the market (8x8 grid, drag pieces, clear lines, no timer).
2. **Wordle's ritual** — one shared daily board for every player on Earth, one attempt, a spoiler-free shareable result card. Acquisition is built into the product instead of bought.
3. **Royal Match's meta** — leveled goals/obstacles enabling booster monetization, and a manor-renovation story layer for long-term retention (Stage 3+).

**Strategic thesis:** Block puzzle games acquire cheaply but monetize shallowly (ads only). Renovation-meta games monetize deeply but acquire expensively. Nobody has welded a viral daily ritual + deep meta onto the cheap-to-acquire block core. That is the gap. Distribution strategy is organic-first (share cards, short-form content), India-first market, WhatsApp-native sharing.

**Product principles (agents: use these to resolve ambiguity):**
- P1. The clear moment is the product. When in doubt, spend effort on game feel.
- P2. Never punish without an exit. Every fail/loss screen offers a path (coins, ad, retry).
- P3. Every screen must answer: "what does the player lose by quitting here?"
- P4. Simplicity at the surface, depth underneath. Zero tutorials beyond FTUE.
- P5. Fair by design: the Daily Board is identical for everyone, boosters disallowed there.
- P6. Respect the player: no dark-pattern purchases, honest timers, ads never interrupt mid-placement, all odds-based mechanics disclosed.

---

## 2. TARGET AUDIENCE & MARKET

- **Primary:** casual puzzle players 22–55, skewing female 55/45, Tier-1 + India/SEA. Plays in 3–8 minute sessions (commute, breaks, before sleep).
- **India-specific:** WhatsApp is the share channel; Hindi + Telugu localization from Stage 3; low-end Android devices (2GB RAM) must run at 60fps.
- **Competitors:** Block Blast (no daily ritual, no meta, ad-only), Royal Match / Royal Kingdom (no viral loop, heavy paid UA), Wordle (no depth/monetization).

---

## 3. SUCCESS METRICS & GATES

| Metric | Gate (must hit to proceed) | Target (healthy) |
|---|---|---|
| D1 retention | ≥ 40% | 48% |
| D7 retention | ≥ 15% | 20% |
| D30 retention | ≥ 6% (Stage 3 gate) | 10% |
| Daily Board participation (DAU %) | ≥ 35% | 55% |
| Daily share rate (shares / daily players) | ≥ 8% | 15% |
| K-factor (installs from shares) | ≥ 0.15 | 0.35 |
| Avg sessions/day | ≥ 3 | 4.5 |
| Crash-free sessions | ≥ 99.5% | 99.8% |
| Level funnel: any level with >25% quit rate | 0 levels | — |
| (Stage 2) Ads ARPDAU | ≥ $0.015 blended | $0.04 |
| (Stage 2) First-purchase conversion (D7) | ≥ 1.5% | 3% |

**Kill criteria:** if after 8 weeks of public soft launch D30 < 6% OR daily share rate < 5% despite two iteration cycles, halt new-feature work and re-evaluate the concept.

---

## 4. TECHNICAL ARCHITECTURE

### 4.1 Stack decision (locked)
- **App:** React Native via **Expo SDK (latest stable)**, TypeScript strict. Rendering of the game board via **@shopify/react-native-skia**; UI chrome via RN views + **react-native-reanimated** v3 for transitions; **expo-haptics** for feedback.
- **Why not Unity:** AI-agent development velocity (pure-text codebase), single codebase for both stores, and OTA tuning via **EAS Update** (LiveOps without store review). Decision is final for v1.
- **Backend:** Firebase — Anonymous Auth (upgradeable to Google/Apple), **Firestore**, **Cloud Functions (TypeScript)**, **Remote Config**, **Cloud Messaging** (push), **Crashlytics**, **Analytics** (+ event mirror to BigQuery).
- **IAP (Stage 2):** RevenueCat over StoreKit/Play Billing. **Ads (Stage 2):** Google AdMob (UMP SDK for consent); mediation revisit post-launch.
- **Monorepo:** pnpm workspaces + Turborepo.

### 4.2 Repository layout (mandatory)
```
blockmanor/
  apps/mobile/            # Expo app (UI only — no game rules here)
    src/screens/          # one folder per screen, mirrors PRD §7–§12 names
    src/components/       # design-system components (§15)
    src/game/             # Skia renderers, input handlers, animation drivers
    src/state/            # Zustand stores
    src/services/         # firebase, analytics, ads, iap, notifications, share
    src/i18n/             # en.json, hi.json, te.json
  packages/engine/        # PURE TS game logic — deterministic, zero deps
    src/board.ts src/pieces.ts src/placement.ts src/clearing.ts
    src/scoring.ts src/rng.ts src/levels.ts src/obstacles.ts
    src/dailyBoard.ts src/simulate.ts src/index.ts
    test/                 # ≥90% line coverage required
  packages/shared/        # types, zod schemas, constants shared app<->backend
  packages/content/       # levels/*.json, story/*.json, economy tables
  backend/functions/      # Cloud Functions (imports engine for validation)
  docs/PRD.md             # this file — source of truth
```

### 4.3 The Engine Contract (critical)
The engine is a **pure, deterministic, seedable state machine**:
- `createGame(config: GameConfig, seed: string): GameState`
- `getLegalPlacements(state, pieceIndex): Placement[]`
- `applyPlacement(state, placement): { state: GameState; events: GameEvent[] }`
- `isGameOver(state): boolean` · `simulate(config, seed, moves: Move[]): FinalResult`
- RNG: **xorshift128+ (or mulberry32) seeded PRNG** implemented in `rng.ts`. `Math.random` is forbidden inside the engine (lint rule enforced).
- Determinism requirement: `simulate()` with identical (config, seed, moves) MUST produce identical results on device and in Cloud Functions. This is the anti-cheat foundation for the Daily Board (§8.5): the client submits its move log; the server re-simulates and accepts only matching scores.
- `GameEvent[]` (e.g. `LINES_CLEARED {rows, cols, cells, combo}`) is the only channel from engine → renderer for triggering juice.

### 4.4 State management
- Zustand stores: `useGameStore` (active session), `useMetaStore` (coins, streaks, progress — persisted via MMKV), `useConfigStore` (Remote Config snapshot).
- Server is authoritative for: daily results, leaderboards, streak count, coin balance (Stage 2+). Client caches optimistically; reconciliation on app-foreground.

### 4.5 Performance budgets
- 60fps board interaction on a 2019-class Android (e.g. Redmi Note 8, 2–3GB RAM). Skia draws batched; no per-cell React components — the board is ONE Skia canvas.
- Cold start ≤ 3.0s to interactive Home on that device. App size ≤ 40MB Android download.
- Full offline play for levels; Daily Board requires connectivity (graceful offline state §12.4).

---

## 5. STAGE PLAN (build order — mandatory)

### Stage 0 — Foundations (Week 1)
Monorepo scaffold, CI (typecheck + lint + engine tests on every PR), engine package complete per §6 with full test suite, Firebase project (dev/prod), EAS configured, design tokens (§15) implemented, analytics service wired with debug view.
**DoD:** `simulate()` reproduces 1,000 fuzzed games identically across two runs; CI green; app boots to a placeholder Home on Android + iOS.

### Stage 1 — Core Game + Daily Board (Weeks 2–6) → CLOSED BETA
Scope: FTUE (§7.1) · Core gameplay & feel (§7.2–7.6) · Levels 1–60 with obstacles: crate, double-crate, chain, ivy (§7.7–7.9) · Level map ch.1–2 (§7.10) · Win/fail screens WITHOUT paid continue — retry only (§7.5) · Daily Board full loop incl. share card + friends-less world percentile (§8) · Anonymous auth · Streak counter (display only, no repair) · Push: daily-drop + streak-risk (§8.7) · Settings, offline, edge screens (§12) · Analytics complete (§14).
Explicitly OUT: coins, lives, boosters, ads, IAP, manor, teams, events.
**DoD:** all §7–§8 acceptance criteria pass; 30-person closed beta (internal track / TestFlight) shows D1 ≥ 40%, level-1→10 funnel completion ≥ 85%, crash-free ≥ 99.5%; daily share tap-rate measured.

### Stage 2 — Economy + Monetization (Weeks 7–10) → PUBLIC SOFT LAUNCH (IN, PH, BR)
Coins & wallet (§9.1) · Lives (§9.2) · Boosters ×3 + win-streak auto-boosters (§9.3) · Fail→Continue flow + out-of-coins sheet (§9.4) · Rewarded ads engine (§10.1) · Interstitials (§10.2) · IAP: starter pack + coin store + remove-ads (§10.3) · Streak freeze + repair (§8.6) · Cloud save via auth upgrade (§12.6).
**DoD:** economy passes simulation tests (§9.5); IAP sandbox verified both stores; UMP consent flow; soft-launch dashboards live; gates of §3 measured weekly.

### Stage 3 — Manor Meta + Story (Weeks 11–16)
Manor dollhouse, rooms 1–3, renovation choices, star economy (§11.1–11.3) · Story chapters 1–4 (§11.4) · Levels 61–150 · Localization hi + te · Lapsed-player flows (§12.7).
**Gate to enter Stage 3:** Stage-2 cohorts show D7 ≥ 15% and ads ARPDAU ≥ $0.015.

### Stage 4 — LiveOps + Social (Weeks 17+)
Sky Race · collection events · Teams + team chest · Manor Pass · leaderboard tabs · friend invites/referrals · global launch + iOS featuring push.
*(§11.5 sketches these; full specs will be added as PRD v2.x amendments before Stage 4 begins.)*

---

## 6. ENGINE SPECIFICATION (packages/engine)

### 6.1 Board
- Grid: 8×8. Cell states: `empty` | `filled(colorId)` | obstacle per §7.8. Coordinates `[row, col]`, zero-indexed, row 0 = top.

### 6.2 Piece set (canonical — IDs are permanent)
| id | name | cells (r,c offsets) | weight |
|---|---|---|---|
| P01 | dot | (0,0) | 6 |
| P02 | duo-h | (0,0)(0,1) | 8 |
| P03 | duo-v | (0,0)(1,0) | 8 |
| P04 | tri-h | (0,0)(0,1)(0,2) | 8 |
| P05 | tri-v | (0,0)(1,0)(2,0) | 8 |
| P06 | quad-h | (0,0)(0,1)(0,2)(0,3) | 6 |
| P07 | quad-v | (0,0)(1,0)(2,0)(3,0) | 6 |
| P08 | penta-h | (0,0)(0,1)(0,2)(0,3)(0,4) | 3 |
| P09 | penta-v | (0,0)(1,0)(2,0)(3,0)(4,0) | 3 |
| P10 | square2 | (0,0)(0,1)(1,0)(1,1) | 8 |
| P11 | square3 | 3×3 all cells | 3 |
| P12–P15 | corner-S/E/N/W (3-cell L) | rotations of (0,0)(1,0)(1,1) | 5 each |
| P16–P19 | ell4 (4-cell L, 4 rotations) | (0,0)(1,0)(2,0)(2,1) rotations | 4 each |
| P20 | tee | (0,0)(0,1)(0,2)(1,1) | 4 |
| P21 | ess | (0,1)(0,2)(1,0)(1,1) | 3 |
| P22 | zed | (0,0)(0,1)(1,1)(1,2) | 3 |
- `SMALL_POOL = {P01..P05, P12..P15}`.
- Weighted draw from table above using seeded RNG; per-level overrides allowed via level schema.

### 6.3 Tray & placement
- Tray holds 3 pieces; refills with 3 new when all are used. Pieces are NOT rotatable by the player.
- A placement anchors the piece's (0,0) offset at target cell; legal iff every cell is in-bounds and `empty`.
- **Placeability guarantee:** on each tray refill, if none of the 3 drawn pieces has ≥1 legal placement, redraw entire tray (max 5 redraws) before accepting a dead tray. Applies everywhere EXCEPT the Daily Board (fixed sequence, §8.2).

### 6.4 Mercy RNG (the "lucky escape" system)
On every piece draw in level/endless modes: if `fillRatio > mercy_threshold [RC, 0.55]`, then with probability `mercy_small_prob [RC, 0.65]` draw from `SMALL_POOL` (weighted). Disabled on Daily Board. Never disclosed in UI as mechanics, but §1 P6 requires the FAQ to state "piece odds adapt to keep games fun".

### 6.5 Clearing & cascade rules
After each placement: find ALL simultaneously full rows + columns → clear their union atomically (a cell at a row/col intersection clears once). Obstacles react per §7.8. No gravity — remaining blocks never move.

### 6.6 Scoring (exact formulas)
- Placement: `+cellCount` points.
- Clear: `+ 10 × clearedCellCount × linesClearedSimultaneously`.
- **Combo streak:** counter starts 0; +1 on any placement that clears ≥1 line; resets to 0 after TWO consecutive non-clearing placements. Clear points are multiplied by `(1 + 0.25 × comboCounter)` rounded down.
- Perfect Clear (board fully empty after a clear): flat `+300` bonus.
- All constants `[RC]`: `score_clear_base 10`, `combo_step 0.25`, `perfect_clear_bonus 300`.

### 6.7 Game over
Level/endless: game over when no unused tray piece has any legal placement. Level WIN triggers the moment the last goal reaches 0 (win takes precedence over simultaneous board-death).

### 6.8 Acceptance criteria (engine)
- 100% deterministic under (config, seed, moves) — fuzz-tested with 1,000 random games.
- getLegalPlacements performance: full scan ≤ 2ms on mid Android via memoized empty-cell bitmask.
- Test coverage ≥ 90% lines; explicit tests for: intersection clears, combo reset boundary, mercy trigger, redraw guarantee, obstacle interactions (each type), perfect clear, win-vs-death same-move precedence.

---

## 7. STAGE 1 FEATURES — CORE GAME

### 7.1 FTUE (first session)
1. Cold open into Level 1 — no menus, no login. Board pre-set so ONE horizontal line is one piece from clearing; tray contains exactly the needed piece + two others. Hand cursor demonstrates drag.
2. L1: "Fill a row to clear it". L2: teaches columns. L3: teaches multi-line combo (pre-set). L4: first crate goal + goal bar callout. L5: free play; HUD fades in.
3. After L5 win → name/avatar screen (guest allowed) → Home reveal with Daily Board tile pulsing.
4. Daily Board soft-gate: after first Home visit, butler card introduces "Today's Board".
5. Notification soft-ask ONLY after first Daily Board completion (§8.7).
- FTUE steps fire `ftue_step {step}` events; funnel target ≥85% completion to L5.
- Skip logic: returning users (existing cloud/local save) bypass all FTUE.

### 7.2 Gameplay screen layout
Top HUD: pause · goal bar (icon + remaining count per goal) · score (tabular numerals). Center: Skia board canvas. Bottom: 3-piece tray (pieces rendered at 60% board-cell scale). Stage-2 adds booster row between board and tray.

### 7.3 Input & drag feel (exact values)
- Touch on tray piece → piece lifts: scale to 100% board scale, offset **-80px above finger** (thumb visibility), shadow + slight tilt (2°).
- Ghost preview: while dragging, the nearest legal anchor within snap radius (0.6 cell) shows the piece footprint tinted `--ok` green at 45% opacity; illegal hover shows red tint 45% on the footprint.
- Release on legal anchor → snap-in 90ms spring; illegal → piece returns to tray 180ms ease-out + light error haptic + board container 4px shake.
- Hitboxes: tray pieces min 64×64dp touch target regardless of visual size.

### 7.4 Juice specification (the product, per P1)
| Event | Visual | Haptic (expo-haptics) | Audio |
|---|---|---|---|
| Piece lift | scale-up 120ms | selection | soft pick |
| Legal snap | 90ms spring settle | impactLight | wooden thock |
| Line clear | per-cell pop 320ms staggered 12ms/cell outward from placement, star particles, +N floating score | impactMedium | chime (pitch +1 semitone per combo level, cap +7) |
| Multi-line | above + screen flash 8% white 80ms + "COMBO xN!" text slam | impactHeavy | layered chime |
| Perfect clear | gold fullscreen shimmer 600ms | notificationSuccess | harp gliss |
| Near-death (fill>0.8) | red edge vignette pulse 1.2s loop | none | low ambience |
| Level win | stars slam in ×3 (200ms apart), confetti | notificationSuccess | fanfare |
| Fail | desaturate board 400ms | notificationError | muffled thud |
- All timings are design tokens in one file `src/game/juice.ts`; reduced-motion OS setting disables shakes/particles (not core feedback).
- Sound: expo-av, single preloaded sprite sheet; mute toggles for SFX/music persist.
- **Music:** one looped ambient track per context — Home/manor (warm, fireplace-cozy, ~70 BPM), gameplay (light, minimal, non-intrusive), Daily Board (same gameplay track + subtle tension layer when fill>0.7 via volume automation, not a track switch). Ducks -12dB under SFX moments; off by default is NOT allowed (on by default, persistent toggle §12.1); licensed loops listed in repo NOTICE.

### 7.5 Win / Fail (Stage 1 versions)
- WIN: stars (thresholds from level schema), score, "Next level" CTA. Star 1 = win; star 2/3 = score thresholds `s2`,`s3`.
- FAIL: "Out of space!" + goal progress shown ("Crates 9/12 — so close!") + **Retry** (free, unlimited in Stage 1) + "Level map" ghost. NO monetization yet, but layout MUST reserve the continue-button slot (§9.4 drops in without redesign).

### 7.6 Endless mode
Unlocked after Level 10. Pure Block Blast mode: no goals, mercy RNG on, personal best tracked. Entry: Home → small "Endless" card. Purpose: session filler + habit; identical engine config `mode:"endless"`.

### 7.7 Level schema (packages/content/levels/NNN.json, zod-validated)
```json
{
  "id": 24, "chapter": 1,
  "seedSalt": "L24-a",
  "prefill": [ {"r":2,"c":3,"type":"crate"}, {"r":2,"c":4,"type":"crate2"} ],
  "goals": [ {"type":"crate","count":12} ],
  "pieceWeightOverrides": { "P11": 0 },
  "mercy": true,
  "stars": { "s2": 1500, "s3": 2600 },
  "estMoves": 22, "difficultyTier": "spike"
}
```

### 7.8 Obstacle behaviors (exact)
| type | occupies cell? | placeable on? | on line-clear through it | goal-countable |
|---|---|---|---|---|
| `crate` | yes | no | destroyed → cell empty | yes |
| `crate2` | yes | no | becomes `crate` (hit 1 of 2) | on 2nd hit |
| `chain` | overlays a filled block | no | chain breaks → normal filled block remains (block itself clears on a subsequent line) | chain-break counts |
| `ivy` | yes | no | destroyed | yes |
| `heirloom` | yes | no | collected → cell empty | yes |
- **Ivy spread rule:** every 3rd placement, if no ivy was destroyed in the last 3 placements, ONE random (seeded) ivy tile grows into a random orthogonally-adjacent empty cell. Ivy never grows past 16 total tiles.
- Obstacle cells DO count toward a row/col being "full" (they fill their cell); `chain` overlays an already-filled cell.

### 7.9 Difficulty curve (levels 1–60, content requirement)
- L1–10 tutorialized, win rate target ≥90%. L11–14 ramp. **L15 = first spike** (win rate target 35–45% first attempt) — this is the future starter-pack trigger. L16–22 breather (~70%). L23–29 ramp. **L30 spike** (~35%). L31–45 mixed with new obstacle each 5 levels. **L45 spike**. L46–60 ramp to sustained ~50%.
- Content pipeline: for every level, run `simulate()` with a greedy-AI bot × 500 seeds; recorded bot win-rate must sit within ±10pp of target. Store results in `levels/_balance_report.json`. Any level where beta players show >25% quit-after-fail gets retuned within a week (OTA content update).

### 7.10 Level map
Chapter 1 (L1–30) garden path, Chapter 2 (L31–60) fountain court. Medallion states: locked/current(pulse)/1–3 stars. Chest at L10/20/30… (Stage 1 reward: cosmetic avatar frames; coins retrofit in Stage 2). Map scrolls to current level on open.

### 7.11 Home screen (the hub — most-visited screen)
Layout top→bottom: (a) HUD bar (coins/lives from S2; settings gear; profile avatar); (b) manor exterior background reflecting real renovation state (S1: static night manor; S3: upgrades per room completion); (c) **Daily Board tile** — countdown or "LIVE" state, red badge dot if unplayed today, streak flame chip 🔥N; (d) center **primary CTA "PLAY — Level N"** (gold, largest element); (e) Endless card (post-L10); (f) event banner carousel slot (empty in S1–2, hidden via flag); (g) bottom nav: Home · Manor(S3) · Events(S4) · Team(S4) · Shop(S2) — locked tabs hidden, not greyed.
States: default · daily-unplayed (tile pulses once on screen entry, max 1 pulse/session) · daily-complete (tile shows today's percentile) · lapsed variant (§12.7) · out-of-lives (CTA subtitle shows refill timer, S2).
Rules: Home renders from cache instantly (no network wait); badge-dot logic centralized in `useMetaStore.badges`; deep links (push §8.7) bypass Home straight to target.
Acceptance: cold-start to interactive Home ≤3.0s budget (§4.5); all nav states verified per stage flags; screenshot test per state.

---

## 8. STAGE 1 FEATURES — DAILY BOARD (the ritual)

### 8.1 Definition
One globally identical challenge per UTC day: identical prefill pattern + identical fixed piece sequence for every player. One attempt. No boosters, no mercy RNG, no redraw guarantee. Score → world percentile (+ friends ranks in Stage 4; Stage 1 shows world percentile only).

### 8.2 Generation (server-authoritative)
- Cloud Function scheduled 00:00 UTC: `seed = HMAC_SHA256(secretSalt, "YYYY-MM-DD")`. From seed: (a) prefill = 6–14 obstacle-free filled cells from curated pattern templates; (b) piece sequence = first 60 piece IDs drawn from §6.2 weights (no mercy). Board doc published to `dailyBoards/{date}` with the sequence ENCRYPTED; client receives decryption via the play-start callable → prevents pre-computing.
- Solvability check at generation: greedy bot must survive ≥15 placements across 200 trials median; else re-roll with seed+"-r1".

### 8.3 Client flow
Gate screen (countdown to next board, "one attempt", yesterday's percentile) → PLAY → gameplay with gold DAILY frame, attempt badge 1/1 → death → result: score count-up 900ms → percentile reveal → share card → "Continue to levels".
- Abandoning mid-run (app kill) = attempt consumed; move log up to that point is submitted on next open. One attempt means one, or streak psychology dies.

### 8.4 Percentile
Cloud Function maintains per-day histogram (100 buckets); percentile = rank vs all submissions so far, floor display "Top X%". Before 100 submissions exist, show "Early bird! 🌅" instead of percentile.

### 8.5 Anti-cheat (uses §4.3 determinism)
Client submits `{date, moves[], claimedScore}` via callable. Server re-runs `simulate(dailyConfig, seed, moves)`; mismatch → rejected, `daily_cheat_rejected` logged. Server also rejects: >1 submission/user/day, moves count >200, submission for a past date >36h old.

### 8.6 Streak (counter in Stage 1; economy in Stage 2)
- Streak +1 on completing (not winning — playing) the Daily Board; a missed UTC day resets to 0. Server-authoritative (`users/{uid}.streak`), client-displayed flame + calendar month view.
- Stage 2 adds: **Streak Freeze** (item, auto-consumes on first missed day, max 2 equipped, earned at streak milestones 7/30/100 or ₹49) and **Streak Repair** (restore within 48h of break: watch 3 rewarded ads OR ₹89 `[RC streak_repair_price]`).
- Milestones 7/30/100: celebration screen + cosmetic flame upgrades (bronze/silver/gold flame).

### 8.7 Share card & notifications
- Share card: 1080×1080 PNG generated on-device (Skia offscreen): spoiler-free mini-grid of final board (colors only, no numbers except score), score, "Top X% · 🔥N · Block Manor", store-badged footer + install link (Branch/AppsFlyer link — attribution required for K-factor). Native share sheet; WhatsApp prioritized on Android.
- Push (opt-in via soft-ask §7.1): (a) daily drop at user-local `daily_push_hour [RC, 08:00]` "Today's board is live — 🔥 keep your N-day streak"; (b) streak-risk at 20:00 local IF today's board unplayed; (c) nothing else in Stage 1. All notifications deep-link to the Daily gate.

### 8.8 Acceptance criteria (Daily Board)
Same board verified on 2 devices + server logs; attempt-consumption on app-kill verified; percentile matches server histogram; share card renders <300ms and opens WhatsApp with image; cheat submission (edited score) rejected in test; streak increments/reset verified across UTC boundary with device clock skewed ±3h (server time wins).

---

## 9. STAGE 2 FEATURES — ECONOMY

### 9.1 Coins (soft currency)
- Sources: level win `+40 + 10×stars [RC]`; chest every 10 levels `+150`; daily board completion `+50`; rewarded ads (§10.1); IAP.
- Sinks: continue `900 / 1200 / 1600` escalating per level attempt `[RC continue_price_1..3]`; boosters `hammer 600 / broom 800 / hourglass 500 [RC]`; life refill `900`.
- Wallet server-authoritative from Stage 2: balance in `users/{uid}.wallet`, mutations ONLY via callables (`grantCoins`, `spendCoins`) with idempotency keys; client optimistic with rollback.
- New-player balance: 500. Target economy pressure: an average non-payer should hit a can't-afford-continue moment first between levels 18–25 (validated via §9.5 simulation).

### 9.2 Lives
- 5 max; -1 on level FAIL (not on quit-before-3-moves); +1 per `life_regen_minutes [RC, 30]`; full refill on level-chapter completion. Out-of-lives sheet: timer, "Refill 900 🪙", rewarded ad +1 (2/day), (Stage 4: ask team). Endless mode and Daily Board never consume lives.

### 9.3 Boosters
- `hammer`: tap any single cell → destroy (counts as a "hit" for crate2/chain). `broom`: clear one chosen row. `hourglass`: redraw current tray (new seeded draw).
- Usable mid-level from booster row; pre-level selection slot ×1.
- **Win-streak system:** consecutive level wins (streak resets on fail, not on app close): x2 → 1 random booster pre-filled next level; x3 → 2; x5+ → 2 + start-score +200. Flame UI on pre-level screen. `[RC winstreak_thresholds]`.
- First grant of each booster arrives via a level that showcases it (L12 hammer, L18 broom, L26 hourglass) with a one-shot tooltip.

### 9.4 Fail → Continue flow (the monetization moment)
Sequence on board-death with goals unmet:
1. Fail screen (§7.5 layout) now shows: streak flame guttering animation (if win-streak ≥2), goal progress, **"Continue — 900 🪙"** primary (grants: clear 12 cells around densest region via engine `reliefClear()` + tray redraw), "Second chance 📺 free" secondary (1/day `[RC]`, same effect), tiny grey "Give up".
2. Continue accepted → `continues_used++`; next continue this level costs tier-2 price.
3. Insufficient balance → §9.4b out-of-coins sheet: compact 2-bundle store slides over (smallest bundle highlighted "covers your continue"), full store link. Cancel → back to fail screen.
4. Give up → if win-streak ≥2, confirm dialog "Your x4 streak will end" with keep-trying default.
- Analytics on every branch (§14). Max 3 paid continues per level attempt, then only retry.

### 9.5 Economy validation (required before Stage-2 DoD)
Extend the bot harness: simulate 2,000 synthetic non-payer players through L1–60 with defined skill distribution; report: median coin balance by level, % hitting zero-balance moment and where, life-blocked sessions/day. Tune `[RC]` values until §9.1 pressure target met. Report committed to `packages/content/_economy_report.json`; re-run on every economy-value PR (CI job).

---

## 10. STAGE 2 FEATURES — MONETIZATION

### 10.1 Rewarded ads ("The Projector Room" + inline placements)
Inline: double-coins on win screen (📺 x2) · second-chance continue (1/day) · +1 life (2/day) · streak-repair (3 ads). Hub: Projector Room screen with daily wheel (1 free spin + 1 ad spin; prizes: 50–300 coins, 1 booster, 1 life; odds disclosed on tap per P6).
Caps: `rv_daily_cap [RC, 8]` per user. Target 3–5 completed RV/DAU. AdMob rewarded units, server-side verification callbacks credit the wallet (§9.1) — never client-granted.

### 10.2 Interstitials
Only after level END (win or fail→gave-up), never mid-game, never after Daily Board. Start at level `interstitial_min_level [RC, 12]`, min gap `interstitial_cooldown_s [RC, 180]`, max `interstitial_daily_cap [RC, 10]`, suppressed 24h after any IAP and permanently by remove-ads. These four knobs are THE lever balancing ads ARPDAU vs retention — tune via A/B in soft launch.

### 10.3 IAP catalog (RevenueCat; prices via store price tiers, INR anchors)
| SKU | Contents | Price | Trigger |
|---|---|---|---|
| `starter_pack` | 1,000 coins + 3 boosters (1 each) + Golden Door Knocker cosmetic + 7d ad-free | ₹89 | One-shot offer on first fail at L15±2, 24h timer, reappears once at L25 if unpurchased |
| `coins_s / m / l / xl` | 1,100 / 3,600 / 12,000 / 33,000 coins | ₹89 / 269 / 799 / 1,999 | store; `m` badged MOST POPULAR |
| `remove_ads` | no interstitials/banners forever (RV stays) | ₹199 | store + post-interstitial "tired of ads?" link (max 1/week) |
| `streak_freeze` | 1 freeze (max 2 held) | ₹49 | streak screen |
| `chapter_bundle_N` *(S3)* | chapter-themed coins+boosters+cosmetic for returning payers | ₹269 | shown once per chapter to users with ≥1 prior purchase, ≥7d since last purchase; full spec in Stage-3 amendment |
- Restore purchases mandatory (both stores). All purchases server-validated via RevenueCat webhooks → wallet grant.
- **Purchase result states:** success → calm receipt screen (contents animate into HUD counters, order line, no upsell); failure/cancel → "you haven't been charged" card with Retry + support link, no guilt framing. Pending-webhook edge: show "delivering…" state ≤10s then optimistic grant with server reconciliation.
- No gacha/loot boxes anywhere; wheel prizes are ad-gated not paid (keeps store rating simple + P6).

### 10.4 Store compliance checklist
Play Data Safety + App Privacy forms · UMP consent (GDPR) shown before any ad SDK init in EEA; ATT prompt on iOS with pre-prompt explainer · age rating questionnaires (target E/4+... realistically E10 with "digital purchases") · privacy policy + terms URLs (host on product site) · support email · account-deletion flow (§12.6, Play policy requires it).

---

## 11. STAGE 3 — MANOR META + STORY (summary spec; details amended pre-stage)

### 11.1 Stars & rooms
Level win grants 1–3 ⭐ (first-win only re-grants difference on improvement). Rooms 1–3 (Library, Kitchen, Study): 5 renovation tasks each costing 1–3 ⭐, three style choices per task (pure cosmetic, restyle free later). Room completion → chapter story beat + coin chest + Home manor exterior visibly upgrades.
### 11.2 Structure
`packages/content/story/chapterN.json`: beats keyed to room-task completion; heir + butler dialogue (typewriter, tap-through, skippable); journal screen archives beats. Chapters 1–4 written for Stage 3; tone: cozy mystery, light sarcasm, no dark themes (audience §2).
### 11.3 Retention wiring
Per P3: Home always shows the next incomplete renovation ("The fireplace awaits — ⭐2/3"); story beats end mid-hook; push (opt-in category) on new-chapter unlock only.
### 11.4 Localization
i18next; en/hi/te string files; story content localized; share card text localized; number formatting via Intl.
### 11.5 Stage 4 preview (spec-level only)
Sky Race (async ladder vs matched ghost), 72h collection events (special tiles on level boards feed milestone track), Teams of 20 (chest = weekly team level count, preset chat), Manor Pass (28d, free+₹799 gold track, XP from any level), leaderboards (friends/country/world), referral (both +500 coins, 5-install milestone).

---

## 12. SYSTEM SCREENS & EDGE CASES (Stage 1 unless noted)

12.1 **Settings:** SFX/music/haptics toggles · notification prefs by category · language (S3) · link account · restore purchases (S2) · support (mailto) · privacy/terms links · delete account (S2) · version/build footer.
12.2 **Pause:** resume / restart (consumes life in S2; free in S1) / settings shortcut / quit-to-map (confirm if goals >50% done).
12.3 **Profile:** avatar/name edit, stats (levels done, best daily percentile, longest streak, total lines), badge case.
12.4 **Offline:** levels + endless fully playable; Daily tile shows "Needs connection" state with retry; queued analytics + queued daily submission flush on reconnect.
12.5 **Maintenance/force-update:** Remote Config `min_supported_version`; below → blocking screen with store button; `maintenance_mode` flag → butler-with-toolbox screen.
12.6 **Auth & save:** anonymous by default; "Save your progress" card after L20 or first purchase → Google/Apple link; cloud save = Firestore user doc (progress, wallet, streak, manor); conflict rule: server wins for wallet/streak, max() wins for level progress. Account deletion: callable wipes user docs + RevenueCat alias, confirm dialog with 7-day grace.
12.7 **Lapsed (S3):** if lastSession >72h: welcome-back gift (200 coins), warm-up level (tier: easy), streak-repair offer if within window.
12.8 **Error states:** every callable failure → toast with retry, never dead-end modals; global error boundary → friendly restart screen + Crashlytics report.
12.9a **In-app review prompt:** native review API (StoreKit/Play In-App Review), triggered only after a 3★ win while win-streak ≥3, max once per version, never within 24h of a fail-heavy session (≥3 fails), never after spending money. `[RC review_prompt_enabled true]`.
12.9b **Soft update nudge:** when a newer optional build exists (RC `latest_version` > installed < `min_supported_version` threshold): dismissible Home banner, max 1/week; forced-update screen (§12.5) unchanged for below-minimum.
12.9 **Empty states (P: invitations, never dead ends):** no percentile yet → "Early bird! 🌅" (§8.4) · no endless best → "Set your first record" · (S4) no team → "A manor is better with company — Browse teams" CTA · (S4) empty friend leaderboard → "Invite someone to beat" + share CTA. Every empty state ships with exactly one action button.

---

## 13. REMOTE CONFIG & FLAGS (initial registry — every key listed here MUST exist in code)
`flag_daily_board(S1,on) · flag_endless(S1,on) · flag_economy(S2) · flag_ads(S2) · flag_iap(S2) · flag_manor(S3) · flag_events(S4)`
`mercy_threshold .55 · mercy_small_prob .65 · combo_step .25 · perfect_clear_bonus 300 · continue_price_1 900 · continue_price_2 1200 · continue_price_3 1600 · life_regen_minutes 30 · winstreak_thresholds "2:1,3:2,5:2+200" · interstitial_min_level 12 · interstitial_cooldown_s 180 · interstitial_daily_cap 10 · rv_daily_cap 8 · starter_pack_trigger_level 15 · streak_repair_price 89 · daily_push_hour 8 · min_supported_version · maintenance_mode false`
Rules: fetch on cold start + 6h TTL; snapshot into `useConfigStore`; A/B experiments via Firebase A/B on these keys only.

---

## 14. ANALYTICS EVENT TAXONOMY (Firebase → BigQuery; names are permanent API)
Session/FTUE: `first_open · session_start · ftue_step{step} · ftue_complete`
Core: `level_start{id,attempt} · level_complete{id,score,stars,duration_s,continues,boosters_used} · level_fail{id,goal_progress_pct,fill_ratio} · level_quit{id,moves} · endless_end{score,best}`
Daily: `daily_view · daily_start · daily_complete{score,percentile,moves} · daily_missed(server) · streak_milestone{n} · streak_broken{n} · streak_repair{method}`
Share/growth: `share_tap{surface} · share_complete{channel} · install_attributed{source}(via MMP)`
Economy (S2): `coins_earned{source,amount} · coins_spent{sink,amount} · continue_shown/accepted/declined{level,price,balance} · oob_sheet_shown/converted · booster_used{type,level} · life_blocked`
Ads (S2): `rv_offer/start/complete{placement} · interstitial_shown{level}`
IAP (S2): `offer_shown{sku,trigger} · purchase{sku,price_inr}(server-confirmed) · restore`
Meta (S3): `room_task_complete{room,task} · style_chosen{task,option} · chapter_complete{n}`
Rules: snake_case, params typed in `packages/shared/analytics.ts` (single source), every new feature PR includes its events, PII never in params. Dashboards required at Stage-1 beta: D1/D7 cohort, level funnel, daily participation & share rate, crash-free.

---

## 15. DESIGN SYSTEM (tokens — from approved Claude Design mockups)
Colors: `--night #131830 · --night2 #1C2344 · --gold #E9C46A · --gold-deep #C99A35 · --cream #F3EAD7 · --muted #98A1C6 · --ok #7ED99E · --bad #E85D5D` + block set `coral #E76F51 · teal #2A9D8F · gold #E9C46A · violet #8E7CC3 · amber #F4A261 · sky #57A0E5 · rose #D46A9E`.
Type: display serif (Playfair Display) for titles/chapters; Nunito for UI; tabular numerals for scores/timers. Scale 12/14/16/20/26/34.
Components (single folder, storybook-style gallery screen in dev builds): GoldButton(3 sizes/states) · GhostButton · Card · ModalSheet(brass frame) · HUDBar · TimerChip · Badge · ProgressBar(3 variants) · Toast · Confetti.
Blocks: glossy top highlight, dark bottom bevel, 6px radius at 1x; obstacle sprites per §7.8 (8 designs). Reduced-motion + colorblind-safe: obstacles differ by SHAPE not only color; block colors pass deuteranopia check (add subtle pattern overlay toggle in settings).
Asset pipeline: SVG masters → PNG @1x/2x/3x via script in `packages/content/assets`; Skia loads atlases.

### 15.1 Audio manifest (complete SFX inventory — file names are permanent)
Gameplay (from §7.4): `piece_pick · snap_thock · clear_chime (pitched at runtime) · combo_layer · perfect_gliss · near_death_amb (loop) · win_fanfare · fail_thud`
UI: `btn_tap (all buttons, subtle) · btn_gold (primary CTAs, warmer) · modal_open · modal_close · toast`
Reward/economy: `coin_single · coin_flurry (payouts, count-scaled volume) · star_slam (win stars, ×3) · chest_open · booster_hammer · booster_broom · booster_hourglass · streak_flame_up · streak_break`
Daily/meta: `daily_reveal (percentile count-up riser) · share_ready · reno_complete (S3, sparkle sweep) · chapter_sting (S3)`
Music: `music_home · music_gameplay · music_daily_tension (layer)`
Rules: all SFX in one expo-av sprite (music streamed separately); every named cue above MUST exist before its screen ships — no silent interactions on rewarding moments, no invented extra cues without adding them here; UI taps ≤ -18dB relative to gameplay SFX; total audio budget ≤ 4MB.

---

## 16. ENGINEERING CONVENTIONS (mandatory for all agents)
- TypeScript strict, `noUncheckedIndexedAccess`, zero `any` (lint error). ESLint + Prettier committed configs; CI blocks on lint/type/test.
- Engine: no non-deterministic imports (custom lint rule bans `Math.random`, `Date.now` inside packages/engine — time injected via config).
- Tests: engine ≥90% lines (vitest); services mocked-unit-tested; one Maestro e2e smoke flow (boot → L1 win → daily gate) per release.
- Conventional commits; PR template links the PRD section implemented; feature branches per PRD § number (e.g. `feat/9.4-continue-flow`).
- Content is data: levels/story/economy in `packages/content` JSON with zod schemas — agents editing balance touch ONLY content + RC, never logic.
- Every screen named exactly as in this PRD (§7–§12) for traceability.
- Secrets in EAS/Firebase env config, never in repo. Daily-board salt only in Functions config.

---

## 17. LAUNCH CHECKLIST (business-side, human tasks)
Company/legal: entity for store accounts + payment collection (India: consider Pvt Ltd/LLP before revenue; needed for Play payments profile & taxes) · Google Play dev account ($25) · Apple dev ($99/yr, needs D-U-N-S for org account) · privacy policy + terms hosted · support email.
Product ops: Firebase prod project + budget alerts · RevenueCat account · AdMob account (payment profile) · MMP (AppsFlyer free tier / Branch) for share attribution · store listings — asset list: app icon (final pick from the 3 mockup candidates, 512/1024px), 8 phone screenshots per store from approved mockups (order: gameplay clear moment → daily share card → level map → manor → streak calendar → events teaser), feature graphic 1024×500 (Play), 30s gameplay video (App Preview + Play), localized listing text en/hi/te (S3) · closed-track testers list (Play requires 12 testers/14 days for new personal accounts — start this clock EARLY in Stage 1) · TestFlight group.
Content ops: 60 levels balanced (§7.9 report) · 30 daily-board pattern templates · SFX pack licensed (e.g. asset-store bundle, license kept in repo NOTICE).

---

## 18. RISKS
| Risk | Mitigation |
|---|---|
| Core loop retention below gate | §3 kill criteria; iterate juice/difficulty before any Stage-2 work |
| Share rate low → viral thesis fails | A/B share-card designs; test share incentive (+50 coins, watch for spam) |
| RN/Skia perf on low-end Android | §4.5 budget tested weekly on physical Redmi-class device from Stage 0 |
| Play 12-tester/14-day rule delays launch | start closed track week 2 |
| Clone competition | speed + daily ritual moat + India localization; ship Stage 1 in 6 weeks |
| Scope creep from Stage 3/4 dreams | §0 rule 2: stage gates are hard |

*End of PRD v1.0 — amendments require a changelog entry (§0).*
