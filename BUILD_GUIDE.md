# Block Manor — Claude Code Build Playbook
How to drive Claude Code with this setup, session by session, through Stage 1.

## 0. One-time setup (you, ~30 min)
1. Repo: commit this folder's contents to your repo root (CLAUDE.md,
   .claude/) + your PRD at docs/PRD.md + mockup exports in docs/design/
   (name them by PRD section: 7.11-home.png, 8.3-daily-result.png ...).
2. Accounts (humans only): Google Play dev account TODAY (12-tester/14-day
   clock), Apple D-U-N-S application, Firebase projects (dev+prod),
   RevenueCat + AdMob accounts (needed Stage 2 — create early, slow KYC).
3. Hardware: one Redmi-class Android test phone. Non-negotiable.
4. Open Claude Code in the repo. It auto-reads CLAUDE.md; agents and
   skills are picked up from .claude/.

## 1. Operating rhythm (every session)
- One PRD subsection per session. Branch feat/<section>-<slug>.
- Prompt shape: "Implement PRD §X.Y [name]. Use <agent> for the work and
  qa-prd-auditor before you report done. Output: what changed, test
  results, and the §X.Y acceptance-criteria checklist."
- You review: run the app on the test phone, walk the acceptance criteria
  yourself for anything visual/feel, merge only on qa PASS.
- End each session: update CLAUDE.md "Current stage" line if a stage
  completed; commit.
- Context hygiene: new session per feature. Long sessions drift.

## 2. Session sequence — Stage 0 (week 1)
S0.1  "Read docs/PRD.md fully. Execute Stage 0 per §5: monorepo per §4.2,
      tooling, CI per §16, placeholder app booting on Android+iOS. No
      engine yet. Report the repo tree and CI run."
S0.2  "engine-architect: implement packages/engine per §6 complete — §4.3
      API, §6.2 piece table exact, §6.3–6.7 rules, §7.8 obstacles, seeded
      PRNG. Full test suite per §6.8 incl. 1,000-game determinism fuzz and
      golden replay fixtures. qa-prd-auditor reviews before done."
S0.3  "level-designer: build the level generator + greedy-bot harness per
      the level-authoring skill. Validate with 5 throwaway test levels.
      Commit harness + report format."
GATE: you run pnpm test yourself; fuzz passes twice identically; app boots
on the Redmi. Only then Stage 1.

## 3. Session sequence — Stage 1 (weeks 2–6)
Board & feel:
S1.1  gameplay-feel-engineer → §7.2 board renderer (static render of any
      GameState on one Skia canvas, perf-profiled)
S1.2  gameplay-feel-engineer → §7.3 drag input + ghost preview exact spec
S1.3  gameplay-feel-engineer → §7.4 juice table complete (audio/haptics/
      particles) — then YOU tune on device for a day; feel notes → PRD
      amendments → token updates
Game modes:
S1.4  engine+ui → §7.5 win/fail screens (S1 versions) + §7.7 level loader
S1.5  level-designer → author levels 1–60 per §7.9 with balance report
S1.6  ui-engineer → §7.10 level map + §7.6 endless mode
S1.7  ui-engineer → §7.1 FTUE (use mockups; funnel events wired)
S1.8  ui-engineer → §7.11 Home + §12.1–12.4 system screens
Daily Board:
S1.9  backend-engineer → §8.2 generation fn + §8.5 submit/anti-cheat +
      emulator tests (engine imported server-side)
S1.10 ui-engineer → §8.3 gate/gameplay/result flow + §8.6 streak display
S1.11 ui-engineer → §8.7 share card (on-device Skia PNG + share sheet +
      MMP link) — test the card IN WhatsApp on a real phone
S1.12 backend-engineer → §8.7 push (soft-ask, daily drop, streak risk)
Hardening:
S1.13 qa-prd-auditor full-repo drift audit vs PRD; fix list
S1.14 devops-release-engineer → beta builds: Play closed track +
      TestFlight; Crashlytics dashboards; EAS Update channels
GATE (Stage 1 DoD, PRD §5): 30-tester beta, D1≥40%, FTUE funnel ≥85%,
crash-free ≥99.5%, share-tap measured. Iterate juice/difficulty here —
do NOT start Stage 2 to "fix" retention with monetization.

## 4. Stage 2+ pattern
Same rhythm: §9.1 wallet (backend) → §9.2 lives → §9.3 boosters → §9.4
continue flow → §9.5 economy simulation → §10.1 RV → §10.2 interstitials →
§10.3 IAP (RevenueCat sandbox both stores) → §10.4 compliance →
soft launch IN/PH/BR. Money-touching PRs: backend-engineer builds,
qa-prd-auditor MUST pass, you test purchases in sandbox personally.

## 5. Review discipline (what YOU never delegate)
- Feel: play every build on the test phone daily; juice tokens are yours
- Difficulty taste: read _balance_report + beta funnels; L15 fail feel
- Economy pressure: read §9.5 sim output before accepting price changes
- Anything irreversible: store listings, pricing, release submissions
- Weekly: 15-min qa-prd-auditor drift audit even when nothing "needs" it

## 6. Failure modes to catch early
- Agent builds ahead of stage ("added a coins field for later") → revert;
  the stage rule exists to keep the beta measurable
- Silent PRD divergence ("the spec said 90ms but 150 felt better") → the
  feel note is GOLD but the flow is: PRD amendment → token change
- Green-tests-but-ugly: tests can't see jank; your phone can
- Fuzz test quietly skipped/reduced → CI must fail the build, verify it does
- Giant sessions "while I'm at it" → one section, one branch, always
