/**
 * `LevelSession` — PRD §7.5's progression loop: "Play -> L1 -> win -> advance
 * to L2 -> play." Not a §16.1 canonical screen (no PRD subsection names it);
 * it's the coordinator that mounts `GameplayScreen` for the player's current
 * campaign level (`useMetaStore.currentLevel`, `packages/content` `getLevel`)
 * and, off the terminal `GameEvent[]`/`GameState` `GameplayScreen.onEvent`
 * already reports (same boundary `FtueScreen` and `JuiceLayer` keep — never
 * re-deriving win/lose from the rules), swaps in `WinScreen` or `FailScreen`.
 *
 * §7.10's `LevelMapScreen` now exists, so §7.5's "Level map" ghost routes
 * there via the optional `onLevelMap` prop; the "ran past the last shipped
 * level" fallback still calls `onExit` (Home), which is the mount point's
 * own choice.
 *
 * §12.2's `PauseSheet` reaches the same two destinations: its restart IS
 * §7.5's Retry (one `handleRetry`, so `attempt` cannot diverge between them)
 * and its quit-to-map is the same `onLevelMap ?? onExit` route, plus §14's
 * `level_quit{id,moves}`.
 */
import {
  createGame,
  fillRatio,
  reliefClear,
  starsFor,
  type BoosterType,
  type EngineTuning,
  type GameEvent,
  type GameState,
} from '@blockmanor/engine';
import { MAX_LEVEL_ID, getLevel, parseLevel, type LevelJson } from '@blockmanor/content';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deriveGoalBar, goalProgressPct, type GoalBarEntry } from './goalBar';
import { BoosterPreLevelSheet } from './BoosterPreLevelSheet';
import { FAIL_HOLD_MS, WIN_HOLD_MS } from './juice';
import { useEngineTuning } from './useEngineTuning';
import {
  GameplayScreen,
  type BoosterControls,
  type PauseControls,
} from '../screens/GameplayScreen';
import { WinScreen } from '../screens/WinScreen';
import { FailScreen } from '../screens/FailScreen';
import type { ContinueSheetProps } from '../screens/ContinueSheet';
import { OutOfCoinsSheet } from '../screens/OutOfCoinsSheet';
import { OutOfLivesSheet } from '../screens/OutOfLivesSheet';
import { RetryToast } from '../components/RetryToast';
import { t } from '../i18n';
import { formatScore } from '../i18n/format';
import { track } from '../services/analytics';
import {
  BOOSTER_SHOWCASE_LEVELS,
  parseWinstreakThresholds,
  randomBoosterType,
  winstreakGrantFor,
} from '../services/boosters';
import {
  buyContinue,
  claimSecondChance,
  continuePrice,
  continuesExhausted,
  reliefWouldRevive,
  secondChanceAvailable,
} from '../services/continueFlow';
import { grantCoins } from '../services/wallet';
import {
  buyLifeRefill,
  canStartLevel,
  forfeitLife,
  hasLifeFor,
  lifeOnWin,
  livesRules,
} from '../services/lives';
import { selectLives, useLivesStore } from '../state/useLivesStore';
import { trustedNow } from '../services/trustedClock';
import { getInstalledVersion } from '../services/appInfo';
import { requestReview, shouldPromptReview } from '../services/reviewPrompt';
import { useBoosterStore } from '../state/useBoosterStore';
import { useConfigStore } from '../state/useConfigStore';
import { useMetaStore } from '../state/useMetaStore';
import { selectBalance, useWalletStore } from '../state/useWalletStore';

/** `attempt` tags the engine seed too (not just analytics) — a Stage-1 free
 * Retry (§7.5, normative as of §0 v1.17) deals a FRESH tray rather than
 * silently replaying the exact same loss: the level's own `seedSalt` still
 * pins ITS identity within the seed string below, `attempt` is the part that
 * varies the run. §1 P2 — never punish without an exit. */
function buildLevelGameState(
  json: LevelJson,
  tuning: EngineTuning,
  attempt: number,
  startScore: number,
): GameState {
  return createGame(
    {
      mode: 'level',
      tuning,
      level: parseLevel(json),
      ...(json.pieceSequence ? { pieceSequence: json.pieceSequence } : {}),
      ...(startScore > 0 ? { startScore } : {}),
    },
    levelRunSeed(json.id, attempt),
  );
}

/** The engine run seed for one attempt at one level. `attempt` is deliberately
 * part of it (§0 v1.17 ruling B) — drop it and Retry replays the identical
 * losing draw. The level's identity is pinned separately: `createGame` mixes
 * `level.seedSalt` (§7.7) into the RNG seed. */
export function levelRunSeed(levelId: number, attempt: number): string {
  return `level-${levelId}-a${attempt}`;
}

/** The attempt number the NEXT run of `levelId` gets (§0 v1.17): one past
 * whatever survived in MMKV, or 1 for a level never started on this install.
 *
 * Both guards below exist for a truncated or hand-edited MMKV blob only —
 * zustand runs `migrate` for OLDER versions, never at the current one, so a
 * corrupt `attempts` on a v2 blob reaches this read exactly as written:
 * `null` would throw on mount (a §12.9 dead end), and a string would
 * concatenate (`'x' + 1 === 'x1'`), leaking a non-number into the typed
 * `level_start.attempt` §14 param. This is the single read of `attempts` in
 * the app, so guarding here covers every caller. */
function nextAttempt(levelId: number): number {
  const prev = (useMetaStore.getState().attempts ?? {})[String(levelId)];
  return (typeof prev === 'number' && Number.isFinite(prev) ? prev : 0) + 1;
}

type Phase = 'playing' | 'won' | 'lost';

interface TerminalResult {
  score: number;
  stars: number;
  goals: readonly GoalBarEntry[];
  /** §9.4: the terminal `GameState` itself — present only for a `'lost'`
   * result. `ContinueSheet`'s dry run and the real `reliefClear` grant both
   * need the actual engine state, not the derived `goals`/`score` above. */
  state?: GameState;
  /** §0 v1.45(a): `winStreak` captured the instant BEFORE `recordLevelFail`
   * unconditionally zeroes it — display only (the fail-screen flame, the
   * give-up confirm copy); continuing does not restore the live counter. */
  streakAtDeath?: number;
}

/** §9.4: `ContinueSheet`'s offer, computed once per fail (see the `offer`
 * effect below) — kept separate from `ContinueSheetProps` because the
 * callbacks are rebuilt from the latest closures on every render while the
 * priced/capped facts only change when a NEW fail happens. */
interface ContinueOffer {
  price: number;
  secondChanceOffered: boolean;
}

export interface LevelSessionProps {
  onExit: () => void;
  /** §7.5's "Level map" ghost, and the destination for a level past the
   * shipped range. Optional so existing mounts keep the pre-§7.10 behaviour
   * (everything routes to `onExit`); `App.tsx` passes the real map. */
  onLevelMap?: () => void;
  /** §12.2's "settings shortcut" -> §12.1's `SettingsScreen`. This screen
   * owns no navigation of its own (same as `onLevelMap`), so it hands the
   * press straight to `App.tsx`'s route. */
  onOpenSettings: () => void;
}

export function LevelSession({
  onExit,
  onLevelMap,
  onOpenSettings,
}: LevelSessionProps): React.JSX.Element | null {
  const currentLevel = useMetaStore((s) => s.currentLevel);
  const setCurrentLevel = useMetaStore((s) => s.setCurrentLevel);
  const tuning = useEngineTuning();

  // §0 v1.17: the attempt counter is PERSISTED per level id, not session
  // state — `level_start{attempt}` is the denominator §7.9's "first attempt"
  // win-rate target and §3's per-level quit rate are read from, so a counter
  // that resets on relaunch emits a false second `attempt: 1`.
  //
  // `attempts` itself is read non-reactively (`nextAttempt` -> `getState()`),
  // only the stable action is subscribed: this component owns the counter for
  // the level it is playing, so subscribing to the value would re-render it
  // solely in response to its own writes — and would turn the
  // write-at-run-start below into a render loop. The write happens in the
  // run-start effect, never during render.
  const persistAttempt = useMetaStore((s) => s.setAttempt);
  // §7.10: the level map's medallions render "1-3 stars", and §7.5's
  // WinScreen computed stars that died with the session. This is the write
  // that gives them something to render. Same non-reactive discipline as
  // `attempts`: only the stable action is subscribed.
  const persistStars = useMetaStore((s) => s.setLevelStars);
  // §12.3 / §12.10: the lifetime and win-streak stats those screens read.
  // Stable actions only — same non-reactive discipline as above.
  const addClearedLines = useMetaStore((s) => s.addClearedLines);
  const recordLevelWin = useMetaStore((s) => s.recordLevelWin);
  const recordLevelFail = useMetaStore((s) => s.recordLevelFail);
  const markReviewPrompted = useMetaStore((s) => s.markReviewPrompted);
  const [attempt, setAttempt] = useState(() => nextAttempt(currentLevel));
  const [phase, setPhase] = useState<Phase>('playing');
  const [result, setResult] = useState<TerminalResult | null>(null);

  // --- §9.2 out-of-lives gate (§0 v1.47) ---------------------------------
  // True between a refused `canStartLevel` and the player either regenerating
  // a life or buying a refill — set by the run-start effect below, which is
  // the ONE choke point every entry path (Home CTA, map, Next, Retry,
  // restart) already funnels through (§0 v1.47(b)).
  const [livesBlocked, setLivesBlocked] = useState(false);
  // §0 v1.48, qa-prd-auditor NIT: a refill's spend can resolve AFTER the run
  // already started some other way (natural regen, or the player simply
  // waited out the poll) — `handleRefillPress`'s `.then()` closure captured
  // whatever `livesBlocked` was at TAP time (always `true`, since the sheet
  // is only reachable while blocked), so it can't see that by the time the
  // answer comes back. A ref mirrors the LATEST value for that async check;
  // reading `livesBlocked` state itself here would read the stale tap-time
  // closure, not the current one.
  const livesBlockedRef = useRef(livesBlocked);
  livesBlockedRef.current = livesBlocked;
  const [refillBusy, setRefillBusy] = useState(false);
  const [refillOutOfCoins, setRefillOutOfCoins] = useState(false);
  const [refillFailedToast, setRefillFailedToast] = useState(false);
  // Ticks the blocked sheet's countdown and re-checks for a regenerated life,
  // entirely through a plain `selectLives` read — never `canStartLevel`
  // again, which would refire `life_blocked` once per tick instead of once
  // per refusal.
  const [blockedNow, setBlockedNow] = useState(() => trustedNow());
  // Last `[json.id, attempt]` the render-time gate check below has already
  // corrected `livesBlocked` for — a plain ref, not state: it must never
  // itself trigger a render, only suppress redundant `setLivesBlocked` calls.
  const lastGateKeyRef = useRef<string | null>(null);

  // --- §9.4 continue flow ------------------------------------------------
  // `continuedState` seeds the NEXT `GameplayScreen` mount after an accepted
  // continue/second-chance — the SAME attempt/run, just past `reliefClear`'s
  // grant. Falls back to the normal fresh-attempt `initialState` below.
  const [continuedState, setContinuedState] = useState<GameState | null>(null);
  // `continues_used` / the price tier (§0 v1.39(b)): scoped to THIS attempt,
  // reset in the run-start effect — no separate persisted counter is needed
  // because any relaunch already mints a brand-new `attempt` (§0 v1.17), so
  // plain component state already satisfies "resets on a new attempt".
  const [continuesUsed, setContinuesUsed] = useState(0);
  const [continueBusy, setContinueBusy] = useState(false);
  // Set by "Give up" — this attempt's fail screens revert to the Stage-1
  // Retry/Level-map layout for the rest of THIS attempt (a later continue
  // death still re-evaluates `offer` below, but §0 v1.45(b) and the caps
  // below usually close it anyway by the time a player gives up).
  const [offerDeclined, setOfferDeclined] = useState(false);
  const [showOutOfCoins, setShowOutOfCoins] = useState(false);
  // §12.8: a 'failed' spend (offline/server fault) must not be swallowed —
  // the pending intent stays alive for the toast's own Retry to replay.
  const [continueFailedToast, setContinueFailedToast] = useState(false);
  // §9.4 step 1's priced/capped facts, computed once per fail (the effect
  // below) — null when nothing is offered (flag off, dry run stays `'lost'`,
  // caps exhausted, or Give-up already declined this attempt's offer).
  const [offer, setOffer] = useState<ContinueOffer | null>(null);

  // --- §9.3 boosters ---------------------------------------------------
  // The pre-level slot's resolved choice for the level CURRENTLY being
  // attempted — spans retries of that same level (unset only by leaving it,
  // §9.3 "pre-filled NEXT level" being a per-level-session grant, not a
  // per-attempt one). `preLevelResolvedFor` tracks which level id this
  // choice (or "no boosters owned, nothing to ask") belongs to.
  const [armedForLevel, setArmedForLevel] = useState<BoosterType | null>(null);
  const [preLevelResolvedFor, setPreLevelResolvedFor] = useState<number | null>(null);
  // §9.3 x5+ win-streak "start-score +200" (§0 v1.49): the NEXT fresh
  // attempt's starting score, resolved render-time below (same mechanism and
  // same reason as `livesBlocked`) so `buildLevelGameState` never builds a
  // run with a stale 0 that a later effect would have to correct after
  // `GameplayScreen` already mounted with it.
  const [startScoreBonus, setStartScoreBonus] = useState(0);
  const boosterCounts = useBoosterStore((s) => s.counts);
  const boosterPreSelected = useBoosterStore((s) => s.preSelected);
  // §14 `level_complete.boosters_used`: count of successful `applyBooster`
  // calls THIS run — reset per attempt (the run-start effect below), unlike
  // `armedForLevel` which spans retries.
  const boostersUsedRef = useRef(0);

  const json = useMemo(() => getLevel(currentLevel), [currentLevel]);

  // §9.2 out-of-lives gate (qa-prd-auditor MAJOR, §0 v1.48(e)): corrected
  // DURING render, not only in the effect below — without this, the FIRST
  // render after a new `[json.id, attempt]` (including the very first mount)
  // still carries the OLD `livesBlocked` value, so a blocked run would paint
  // `GameplayScreen` (and run ITS OWN mount effects — the back-handler
  // subscription, the pre-armed-booster auto-fire) for one real frame before
  // the effect catches up and swaps in `OutOfLivesSheet`. This is React's
  // documented "adjust state when a dependency changes" pattern: a `setState`
  // call during render bails out and re-renders before anything commits, so
  // nothing downstream of `livesBlocked` ever sees the stale value. It reads
  // the side-effect-free `hasLifeFor`, never `canStartLevel` (no `track`
  // calls during render) — the effect below still owns firing `life_blocked`
  // exactly once, and `beginRun`'s own idempotency guard means computing the
  // same answer twice (here and in the effect) is harmless.
  const gateKey = json ? `${json.id}:${attempt}` : null;
  if (lastGateKeyRef.current !== gateKey) {
    lastGateKeyRef.current = gateKey;
    const blocked = json ? !hasLifeFor(json.id, trustedNow()) : false;
    if (blocked !== livesBlocked) setLivesBlocked(blocked);
    // §9.3 (§0 v1.49(d)): a READ, never a store mutation, during render —
    // the actual one-shot consume lives in `beginRun`'s side effects below,
    // which this same `[json.id, attempt]` transition also triggers.
    const bonus = json ? useBoosterStore.getState().pendingStartScore : 0;
    if (bonus !== startScoreBonus) setStartScoreBonus(bonus);
  }

  // §9.4: a continued/second-chanced run reseeds `GameplayScreen` from
  // `reliefClear`'s own output rather than a fresh `buildLevelGameState` —
  // same attempt, same run, just past the grant.
  const initialState = useMemo(
    () =>
      continuedState ?? (json ? buildLevelGameState(json, tuning, attempt, startScoreBonus) : null),
    [continuedState, json, tuning, attempt, startScoreBonus],
  );

  // Wall-clock duration for `level_complete.duration_s` (§14) — app-layer
  // only; packages/engine stays `Date.now`-free (CLAUDE.md hard rule 2).
  const startedAtRef = useRef(Date.now());

  // §7.5 audit M-2: `GameplayScreen`'s own `JuiceLayer` fires the win/fail
  // celebration off the SAME terminal event `handleEvent` below reads, but
  // swapping `phase` unmounts `GameplayScreen` (and `JuiceLayer` with it) on
  // the very next commit — tearing the animation down before it plays. This
  // timer holds the board on-screen for exactly as long as that beat needs
  // (`WIN_HOLD_MS`/`FAIL_HOLD_MS`, §7.4) before the phase actually swaps.
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPhaseTimer = useCallback(() => {
    if (phaseTimerRef.current) {
      clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
  }, []);
  useEffect(() => clearPhaseTimer, [clearPhaseTimer]);

  // §12.2 quit-to-map fires `level_quit` (§14) exactly once per run. The
  // press can land twice before the mount point re-renders and swaps this
  // component out (a double tap is one frame apart, navigation is not), which
  // would double-count §3's per-level quit rate. Re-armed by the run-start
  // effect below, so a restart-then-quit still reports.
  const quitFiredRef = useRef(false);

  // The real "entering a run" side effects, shared by the run-start effect
  // below AND by whatever later un-gates a blocked run (a regenerated life
  // or a refill) — factored out so neither path can drift from the other.
  //
  // Guarded by `runStartedKeyRef`, keyed on `level.id:attemptNum` (qa-prd-auditor
  // MAJOR, §0 v1.48(c)): a refill's spend resolving and the regen-poll's next
  // tick can both decide to unblock the SAME run within the same instant (the
  // poll calls this directly; a refill success calls it from a promise
  // `.then()` that can land on either side of the poll's own tick) — each is
  // individually guarded at its own call site too (the poll clears its own
  // interval first, the refill checks `refillBusy`), but neither guard stops
  // the OTHER path from also firing. One shared idempotency check here, keyed
  // on the run itself rather than on how it was reached, is what actually
  // makes "starts exactly once" true regardless of which paths race.
  const runStartedKeyRef = useRef<string | null>(null);
  const beginRun = useCallback(
    (level: LevelJson, attemptNum: number) => {
      const key = `${level.id}:${attemptNum}`;
      if (runStartedKeyRef.current === key) return;
      runStartedKeyRef.current = key;
      // Advanced at run START, not on fail and not on the Retry tap: an
      // ABANDONED run is exactly the shape of a quit (§3's per-level quit
      // rate) and must count, and the first run after a relaunch is a new
      // run. §0 v1.17.
      persistAttempt(level.id, attemptNum);
      track('level_start', { id: level.id, attempt: attemptNum });
      // §9.3 first-grant showcase (L12 hammer / L18 broom / L26 hourglass):
      // idempotent (`grantShowcase` only fires once per booster type, ever),
      // so re-running this on every retry of a showcase level is harmless.
      const showcase = BOOSTER_SHOWCASE_LEVELS[level.id];
      if (showcase) useBoosterStore.getState().grantShowcase(showcase);
      // §9.3 (§0 v1.49(d)): one-shot consume of the win-streak score bonus —
      // the render-time block above already captured it into `startScoreBonus`
      // for THIS run's `buildLevelGameState` call, so clearing it here can
      // never race that read.
      if (useBoosterStore.getState().pendingStartScore > 0) {
        useBoosterStore.getState().setPendingStartScore(0);
      }
    },
    [persistAttempt],
  );

  useEffect(() => {
    startedAtRef.current = Date.now();
    setPhase('playing');
    setResult(null);
    quitFiredRef.current = false;
    boostersUsedRef.current = 0;
    // §9.4: a genuinely new attempt (this effect's own trigger, §0 v1.17)
    // resets continues_used/tier to zero/tier-1 and clears any continued
    // seed/decline from the attempt that just ended (§0 v1.39(b)).
    setContinuedState(null);
    setContinuesUsed(0);
    setContinueBusy(false);
    setOfferDeclined(false);
    setShowOutOfCoins(false);
    setContinueFailedToast(false);
    setOffer(null);
    // §9.2 (§0 v1.47): same per-attempt reset discipline as the continue
    // flow's state just above.
    setRefillBusy(false);
    setRefillOutOfCoins(false);
    setRefillFailedToast(false);
    clearPhaseTimer();
    if (!json) {
      setLivesBlocked(false);
      return;
    }
    // §9.2 out-of-lives gate (§0 v1.47(b)): the ONE check point every entry
    // path (Home CTA, map, Next, Retry, restart) already funnels through —
    // a refused start never mints this attempt or fires `level_start`.
    if (!canStartLevel(json.id, trustedNow())) {
      setLivesBlocked(true);
      setBlockedNow(trustedNow());
      return;
    }
    setLivesBlocked(false);
    beginRun(json, attempt);
  }, [json, attempt, clearPhaseTimer, beginRun]);

  // While blocked: ticks the sheet's countdown and watches for a regenerated
  // life through a plain `selectLives` read — never `canStartLevel` again,
  // which would refire `life_blocked` every tick instead of once per refusal
  // (§0 v1.47(b)).
  useEffect(() => {
    if (!livesBlocked || !json) return;
    const id = setInterval(() => {
      const nowTick = trustedNow();
      setBlockedNow(nowTick);
      if (selectLives(useLivesStore.getState(), nowTick, livesRules()).lives > 0) {
        // Clears itself BEFORE `beginRun` rather than waiting for the next
        // commit's cleanup — several ticks can fire back-to-back before
        // React gets a chance to re-render (e.g. a batch of fake-timer ticks
        // in a test, or a slow commit on a real device), and each one would
        // otherwise see the same still-stale `livesBlocked` closure and
        // mint a SEPARATE run.
        clearInterval(id);
        setLivesBlocked(false);
        beginRun(json, attempt);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [livesBlocked, json, attempt, beginRun]);

  // Past the shipped range (or a corrupt save) — nothing honest to play;
  // exit rather than render a dead end (§12.9).
  useEffect(() => {
    if (!json) onExit();
  }, [json, onExit]);

  const handlePreLevelConfirm = useCallback(
    (type: BoosterType | null) => {
      if (!json) return;
      // Consumed either way — a re-offered default only ever comes from a
      // FRESH win-streak grant (`recordWin` below), never a stale one.
      useBoosterStore.getState().setPreSelected(null);
      setArmedForLevel(type);
      setPreLevelResolvedFor(json.id);
    },
    [json],
  );

  const handleBoosterUsed = useCallback(
    (type: BoosterType) => {
      if (!json) return;
      boostersUsedRef.current += 1;
      useBoosterStore.getState().consume(type);
      track('booster_used', { type, level: json.id });
    },
    [json],
  );

  // §0 v1.46(d): a continued/second-chanced run remounts `GameplayScreen` (via
  // FailScreen in between) with the SAME `armedForLevel` still set, which
  // would otherwise re-fire the mount-only pre-arm for free on every continue
  // — `continuedState` is non-null only on that remount, never on a genuine
  // new attempt (Retry mints a fresh attempt and clears `continuedState`).
  const boosterControls: BoosterControls = useMemo(
    () => ({ preArmed: continuedState ? null : armedForLevel, onUsed: handleBoosterUsed }),
    [continuedState, armedForLevel, handleBoosterUsed],
  );

  // §12.10: a win advances the win-streak FIRST — this win counts toward the
  // "win-streak >= 3" it is judged against — then eligibility is read off the
  // post-write store. Returns the build to record the ask against, or null.
  const recordWin = useCallback(
    (stars: number): string | null => {
      recordLevelWin();
      const meta = useMetaStore.getState();
      // §9.3 win-streak grants: x2 -> 1 random booster "pre-filled next
      // level", x3 -> 2, x5+ -> 2 + start-score +200 (§0 v1.49: wired).
      // `winstreakGrantFor`'s own doc explains the exact-vs-"N+" tier match.
      const tiers = parseWinstreakThresholds(
        useConfigStore.getState().value('winstreak_thresholds'),
      );
      const grantTier = winstreakGrantFor(meta.winStreak, tiers);
      if (grantTier && grantTier.count > 0) {
        const boosterStore = useBoosterStore.getState();
        let lastGranted: BoosterType | null = null;
        for (let i = 0; i < grantTier.count; i++) {
          lastGranted = randomBoosterType();
          boosterStore.grant(lastGranted, 1);
        }
        // "Pre-filled next level": arms the pre-level sheet's default choice
        // for whichever level this player reaches next.
        if (lastGranted) boosterStore.setPreSelected(lastGranted);
      }
      if (grantTier && grantTier.bonus > 0) {
        useBoosterStore.getState().setPendingStartScore(grantTier.bonus);
      }
      const installedVersion = getInstalledVersion();
      const eligible = shouldPromptReview({
        enabled: useConfigStore.getState().value('review_prompt_enabled'),
        stars,
        winStreak: meta.winStreak,
        installedVersion,
        promptedVersion: meta.reviewPromptedVersion,
        recentFails: meta.recentFails,
        lastFailAt: meta.lastFailAt,
        // Stage 1 has no purchase flow (§10.3 is Stage 2), so there is no
        // purchase record to read; the predicate still carries the rule.
        lastPurchaseAt: 0,
        now: Date.now(),
      });
      return eligible ? installedVersion : null;
    },
    [recordLevelWin],
  );

  // The native ask waits for WinScreen — never over the win juice — and the
  // version is recorded only if we actually asked (see `requestReview`).
  const promptReview = useCallback(
    (version: string | null) => {
      if (!version) return;
      void requestReview().then((asked) => {
        if (asked) markReviewPrompted(version);
      });
    },
    [markReviewPrompted],
  );

  const handleEvent = useCallback(
    (events: readonly GameEvent[], state: GameState) => {
      if (!json) return;
      // §12.3 "total lines": accumulated from the engine's own events. `onEvent`
      // fires once per state change carrying only that change's events, so
      // this cannot double-count; never re-derived from score.
      const lines = events.reduce(
        (n, e) => (e.type === 'LINES_CLEARED' ? n + e.rows.length + e.cols.length : n),
        0,
      );
      if (lines > 0) addClearedLines(lines);
      // §9.2 lives: forfeit at the threshold or on death, refunded by a win.
      const runKey = levelRunSeed(json.id, attempt);
      if (state.status === 'won' || state.status === 'completed') {
        lifeOnWin(state, runKey, trustedNow());
      } else {
        forfeitLife(state, runKey, trustedNow());
      }
      // §8.2/§4.3: `'won'` (a goal reached 0) and `'completed'` (a fixed
      // `pieceSequence` ran dry with the board still alive — goal-less
      // scripted levels only, e.g. a stale save still pointed at FTUE's
      // L1-L3, §7.5 audit B-1) are both terminal outcomes `LevelSession` must
      // resolve to a screen. §8.2's own wording — "outlived the board" — is
      // win-shaped, so `'completed'` routes to `WinScreen` too. Neither is
      // re-derived: both read straight off the engine's own `status` /
      // `GameEvent[]`.
      if (state.status === 'won') {
        const won = events.find(
          (e): e is Extract<GameEvent, { type: 'LEVEL_WON' }> => e.type === 'LEVEL_WON',
        );
        // §4.3: `status === 'won'` and a `LEVEL_WON` event are set together,
        // in the same `applyPlacement` branch, always — never independently.
        // A `??` fallback here would be a second, silently-diverging source
        // of truth for score/stars (§7.5 audit mn-5); fail loud instead, the
        // engine contract is broken if this is ever missing.
        if (!won) {
          throw new Error(
            '[LevelSession] engine status is "won" with no LEVEL_WON event — §4.3 contract violation',
          );
        }
        const duration_s = Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000));
        track('level_complete', {
          id: json.id,
          score: won.score,
          stars: won.stars,
          duration_s,
          continues: continuesUsed,
          boosters_used: boostersUsedRef.current,
        });
        persistStars(json.id, won.stars);
        // §9.1 level-win coins: optimistic, server-priced and server-keyed.
        grantCoins({ source: 'level_win', levelId: json.id, stars: won.stars });
        const reviewVersion = recordWin(won.stars);
        setResult({ score: won.score, stars: won.stars, goals: [] });
        clearPhaseTimer();
        phaseTimerRef.current = setTimeout(() => {
          setPhase('won');
          promptReview(reviewVersion);
        }, WIN_HOLD_MS);
      } else if (state.status === 'completed') {
        // No `LEVEL_WON` event exists on this path (only `SEQUENCE_EXHAUSTED`,
        // which carries no `stars`) — `starsFor` is the one source for stars
        // here, not a second opinion alongside an event that doesn't exist.
        const stars = starsFor(state.score, state.config.level?.stars);
        const duration_s = Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000));
        track('level_complete', {
          id: json.id,
          score: state.score,
          stars,
          duration_s,
          continues: continuesUsed,
          boosters_used: boostersUsedRef.current,
        });
        persistStars(json.id, stars);
        grantCoins({ source: 'level_win', levelId: json.id, stars });
        const reviewVersion = recordWin(stars);
        setResult({ score: state.score, stars, goals: [] });
        clearPhaseTimer();
        phaseTimerRef.current = setTimeout(() => {
          setPhase('won');
          promptReview(reviewVersion);
        }, WIN_HOLD_MS);
      } else if (state.status === 'lost') {
        const goals = deriveGoalBar(state);
        // §0 v1.45(a): the streak §9.4's flame/give-up-confirm display, read
        // BEFORE `recordLevelFail` unconditionally zeroes it (§9.3). Display
        // only — a later continue does not restore the live counter.
        const streakAtDeath = useMetaStore.getState().winStreak;
        track('level_fail', {
          id: json.id,
          goal_progress_pct: goalProgressPct(goals),
          fill_ratio: fillRatio(state.board),
        });
        recordLevelFail(Date.now());
        setResult({ score: state.score, stars: 0, goals, state, streakAtDeath });
        clearPhaseTimer();
        phaseTimerRef.current = setTimeout(() => setPhase('lost'), FAIL_HOLD_MS);
      }
    },
    [
      json,
      attempt,
      clearPhaseTimer,
      persistStars,
      addClearedLines,
      recordWin,
      promptReview,
      recordLevelFail,
      continuesUsed,
    ],
  );

  const handleNext = useCallback(() => {
    // §7.10 defect fix (qa-prd-auditor M-7, raised via §7.11's chest badge):
    // this used to stop `currentLevel` AT `MAX_LEVEL_ID` forever on a win,
    // reasoning (§7.5 audit M-1, when this file predated `LevelMapScreen`)
    // that advancing past it left `getLevel` unable to resolve a level and
    // bricked Home's CTA. `LevelMapScreen` exists now, and BOTH it and
    // `selectBadges.mapChestReady` read the L60 chest as claimable only once
    // `currentLevel > MAX_LEVEL_ID` — clamping here meant `courtyard_crest`
    // (§7.10's L60 chest reward) could never be granted to anyone.
    // Always advance. The run-start effect above already resets `phase` off
    // `json`, and the separate "past the shipped range — exit rather than
    // render a dead end" effect already bounces to Home the moment `getLevel`
    // returns `undefined` for the new `currentLevel` — the exact same "nothing
    // honest to play" case this special-case used to handle by hand.
    setCurrentLevel(currentLevel + 1);
    // Not `1`: a level reached a second time (today only via a corrected or
    // rolled-back save — §7.10's map specs medallions, chests and
    // scroll-to-current, no replay affordance) resumes its own persisted
    // count rather than faking a first attempt. §0 v1.17 (i).
    setAttempt(nextAttempt(currentLevel + 1));
    // §9.3: this level's pre-level slot was for THIS level only — clear it
    // so the new level re-asks (or auto-resolves to "nothing owned").
    setArmedForLevel(null);
    setPreLevelResolvedFor(null);
  }, [currentLevel, setCurrentLevel]);

  const handleRetry = useCallback(() => {
    // The same persisted read `handleNext` uses, not `a + 1` off session
    // state: those agree today only because the run-start effect always
    // writes before a Retry can be tapped — an invariant a reader would have
    // to reconstruct. One source of truth for "what attempt is next" instead.
    setAttempt(nextAttempt(currentLevel));
  }, [currentLevel]);

  const handleQuit = useCallback(
    (moves: number) => {
      if (!json || quitFiredRef.current) return;
      quitFiredRef.current = true;
      // §14 `level_quit{id,moves}`. `moves` is the engine's own
      // `GameState.placements`, handed up by `GameplayScreen` (the only
      // holder of the live state) — not re-derived here.
      track('level_quit', { id: json.id, moves });
      // §9.3: leaving the level ends this pre-level slot's scope.
      setArmedForLevel(null);
      setPreLevelResolvedFor(null);
      (onLevelMap ?? onExit)();
    },
    [json, onLevelMap, onExit],
  );

  // --- §9.4 continue flow --------------------------------------------------
  // Computed once per fail (not at render time, unlike the booster pre-level
  // gate below): it fires `continue_shown`, a real analytics event, which a
  // render-time computation would re-fire on every unrelated re-render.
  useEffect(() => {
    if (phase !== 'lost' || !json || !result?.state || offerDeclined) {
      setOffer(null);
      return;
    }
    const config = useConfigStore.getState();
    if (!config.value('flag_economy') || continuesExhausted(continuesUsed)) {
      setOffer(null);
      return;
    }
    // §0 v1.38(iii): offered only if it revives — reliefClear's own refusal
    // rules ARE this gate (never Endless/Daily/FTUE/already-not-lost).
    if (!reliefWouldRevive(result.state, config.value('relief_clear_cells'))) {
      setOffer(null);
      return;
    }
    const price = continuePrice(continuesUsed);
    // §0 v1.46(f): trustedNow, not the raw wall clock — the daily cap below is a
    // real, live-wired source of free continues, not dormant like the ad-life
    // cap (§0 v1.42(d)), so it needs the same clock-exploit defense as lives.
    setOffer({ price, secondChanceOffered: secondChanceAvailable(trustedNow()) });
    track('continue_shown', {
      level: json.id,
      price,
      balance: selectBalance(useWalletStore.getState(), config.value('starting_coin_balance')),
    });
  }, [phase, json, result, offerDeclined, continuesUsed]);

  // One call does the clear AND the redraw (§0 v1.38(ii)) and returns to
  // `'playing'` -> back to `GameplayScreen`, same run, same attempt. Shared by
  // both acceptance paths below; only their OWN bookkeeping (tier advance,
  // analytics price) differs, per §0 v1.39(a).
  const finishContinue = useCallback(
    (newState: GameState) => {
      setContinuedState(newState);
      setResult(null);
      setOffer(null);
      setShowOutOfCoins(false);
      clearPhaseTimer();
      setPhase('playing');
    },
    [clearPhaseTimer],
  );

  const applyContinueGrant = useCallback(
    (price: number) => {
      if (!json || !result?.state) return;
      const config = useConfigStore.getState();
      const { state: newState } = reliefClear(result.state, config.value('relief_clear_cells'));
      const balance = selectBalance(
        useWalletStore.getState(),
        config.value('starting_coin_balance'),
      );
      track('continue_accepted', { level: json.id, price, balance });
      // §0 v1.39(b): advances the tier for this attempt's NEXT paid continue.
      setContinuesUsed((n) => n + 1);
      finishContinue(newState);
    },
    [json, result, finishContinue],
  );

  const handleContinuePress = useCallback(() => {
    if (!json || !offer || continueBusy) return;
    const config = useConfigStore.getState();
    const balance = selectBalance(useWalletStore.getState(), config.value('starting_coin_balance'));
    // §9.4 step 3: checked against the shown balance BEFORE ever touching the
    // engine or the server — `reliefClear` is irreversible (§0 v1.39(e)'s
    // client-trusted pricing is about the AMOUNT, not about skipping this).
    if (balance < offer.price) {
      track('oob_sheet_shown', { sink: 'continue' });
      setShowOutOfCoins(true);
      return;
    }
    const price = offer.price;
    const runKey = levelRunSeed(json.id, attempt);
    setContinueBusy(true);
    setContinueFailedToast(false);
    // Awaited, not optimistic (`services/continueFlow.ts`'s own doc comment):
    // a rejected spend must never have already cleared the board.
    void buyContinue(price, runKey, trustedNow()).then((outcome) => {
      setContinueBusy(false);
      if (outcome === 'spent') applyContinueGrant(price);
      else if (outcome === 'rejected') {
        track('oob_sheet_shown', { sink: 'continue' });
        setShowOutOfCoins(true);
      } else {
        // 'failed' (offline/server fault): the intent stays pending — the
        // toast's own Retry replays the SAME key, never mints a new one
        // (§12.8: a failed callable gets a toast, never silence).
        setContinueFailedToast(true);
      }
    });
  }, [json, offer, continueBusy, attempt, applyContinueGrant]);

  // §0 v1.46(c): guarded on `continueBusy` — without this, a tap on Second
  // chance or Give Up while a paid Continue's spend is still in flight could
  // revive the board (or leave the attempt) out from under the stale
  // `applyContinueGrant` closure the spend's `.then` runs when it resolves,
  // charging coins for a grant nothing is left to apply. `ContinueSheet`
  // also disables all three controls while `busy` for the same reason, but
  // the handler guard is the real fix — the UI disable is only the visible
  // half of it.
  const handleSecondChancePress = useCallback(() => {
    if (!json || !offer?.secondChanceOffered || !result?.state || continueBusy) return;
    if (!claimSecondChance(trustedNow())) return;
    const config = useConfigStore.getState();
    const balance = selectBalance(useWalletStore.getState(), config.value('starting_coin_balance'));
    // §0 v1.45(c): Second chance reuses `continue_accepted` with `price: 0` —
    // §14 names no separate event for the free path, and `continues_used`/the
    // tier are NOT advanced here (§0 v1.39(a)).
    track('continue_accepted', { level: json.id, price: 0, balance });
    const { state: newState } = reliefClear(result.state, config.value('relief_clear_cells'));
    finishContinue(newState);
  }, [json, offer, result, continueBusy, finishContinue]);

  const handleGiveUp = useCallback(() => {
    if (!json || continueBusy) return;
    const config = useConfigStore.getState();
    // §0 v1.46(b)/(g): one event per Give-up at the current paid-tier price —
    // Give Up declines Continue AND Second chance in the same action, so
    // there is no separate "declined just the free option" event to
    // discriminate with price:0 (unlike acceptance, where accepting IS a
    // distinct per-option choice).
    const price = offer?.price ?? continuePrice(continuesUsed);
    const balance = selectBalance(useWalletStore.getState(), config.value('starting_coin_balance'));
    track('continue_declined', { level: json.id, price, balance });
    setOfferDeclined(true);
    setShowOutOfCoins(false);
    // NIT from the §9.4 re-audit: a failed-spend toast left standing from a
    // PRIOR Continue attempt this same offer must not survive into the
    // Stage-1 layout Give-up reverts to — its own Retry would then no-op
    // forever (`handleContinuePress` returns early with no `offer`).
    setContinueFailedToast(false);
  }, [json, offer, continuesUsed, continueBusy]);

  const handleOutOfCoinsCancel = useCallback(() => setShowOutOfCoins(false), []);
  const handleContinueToastDismiss = useCallback(() => setContinueFailedToast(false), []);

  // §9.2 (§0 v1.47(c)): mirrors `handleContinuePress`'s exact shape — a
  // pre-flight balance check, then an awaited (never optimistic) spend, with
  // the same three-way outcome handling.
  //
  // qa-prd-auditor MAJOR, §0 v1.48(d): the pre-flight check is skipped
  // entirely when a `pendingRefill` already exists. §9.2's acceptance
  // requires a lost answer to be "replayed with the same key and amount and
  // still deliver its lives … even when the balance has fallen below it" —
  // `buyLifeRefill` already honours that (its own `pendingRefill` branch
  // replays unconditionally, ignoring the shown balance), but this pre-flight
  // check ran BEFORE that branch ever got a chance to, so a player whose
  // earlier refill already landed server-side (response merely lost) was
  // told "you need more coins" for a purchase they had already paid for.
  const handleRefillPress = useCallback(() => {
    if (refillBusy) return;
    const hasPendingIntent = useLivesStore.getState().pendingRefill !== null;
    if (!hasPendingIntent) {
      const config = useConfigStore.getState();
      const price = config.value('life_refill_price');
      const balance = selectBalance(
        useWalletStore.getState(),
        config.value('starting_coin_balance'),
      );
      if (balance < price) {
        track('oob_sheet_shown', { sink: 'life_refill' });
        setRefillOutOfCoins(true);
        return;
      }
    }
    setRefillBusy(true);
    setRefillFailedToast(false);
    void buyLifeRefill(trustedNow()).then((outcome) => {
      setRefillBusy(false);
      if (outcome === 'refilled') {
        setRefillOutOfCoins(false);
        if (json) {
          setLivesBlocked(false);
          beginRun(json, attempt);
        }
        return;
      }
      // qa-prd-auditor NIT, §0 v1.48: the run may have already started by
      // the time this answer lands (regen, or the player simply waited) —
      // popping `OutOfCoinsSheet`/the failed-spend toast now would surface
      // mid-gameplay over a sheet that is no longer showing, and would
      // inflate §9.5's zero-balance-moment count with a refusal nobody is
      // looking at. Nothing to show; the spend itself already resolved
      // correctly either way (replayed if lost, never double-charged).
      if (!livesBlockedRef.current) return;
      if (outcome === 'rejected') {
        track('oob_sheet_shown', { sink: 'life_refill' });
        setRefillOutOfCoins(true);
      } else if (outcome === 'pending') {
        // No answer yet (offline/server fault): the intent stays pending —
        // the toast's own Retry replays the SAME key (§12.8).
        setRefillFailedToast(true);
      }
      // 'full' cannot happen here — this gate only shows at 0 lives.
    });
  }, [refillBusy, json, attempt, beginRun]);

  const handleRefillOutOfCoinsCancel = useCallback(() => setRefillOutOfCoins(false), []);
  const handleRefillToastDismiss = useCallback(() => setRefillFailedToast(false), []);

  // §12.2 restart is `handleRetry` ITSELF, not a copy of it. Both start a new
  // run of the same level, and §0 v1.17 (i) defines `attempt` by runs
  // STARTED, not by which button started them — so re-seeding through one
  // function is what makes "restart-from-pause and retry-from-fail advance
  // `attempt` identically" true by construction rather than by two call sites
  // happening to agree. (The one asymmetry is upstream and not ours: a fail
  // has already fired `level_fail`, a pause-restart has not — an abandoned
  // run mid-level is a quit-shaped hole in the funnel by design, §3.)
  const pauseControls: PauseControls = useMemo(
    () => ({ onRestart: handleRetry, onQuit: handleQuit, onOpenSettings }),
    [handleRetry, handleQuit, onOpenSettings],
  );

  if (!json || !initialState) return null;

  if (livesBlocked) {
    const price = useConfigStore.getState().value('life_refill_price');
    return (
      <>
        <OutOfLivesSheet
          now={blockedNow}
          nextLifeAt={selectLives(useLivesStore.getState(), blockedNow, livesRules()).nextLifeAt}
          price={price}
          busy={refillBusy}
          onRefill={handleRefillPress}
          onCancel={onLevelMap ?? onExit}
        />
        {refillOutOfCoins ? (
          <OutOfCoinsSheet
            price={price}
            body={t('lives.oobBody', { price: formatScore(price) })}
            coversLabel={t('lives.oobCovers')}
            onCancel={handleRefillOutOfCoinsCancel}
          />
        ) : null}
        {refillFailedToast ? (
          <RetryToast
            message={t('toast.callableFailed')}
            onDismiss={handleRefillToastDismiss}
            onRetry={handleRefillPress}
          />
        ) : null}
      </>
    );
  }

  if (phase === 'won' && result) {
    return (
      <WinScreen
        score={result.score}
        stars={result.stars}
        onNext={handleNext}
        isLastLevel={currentLevel >= MAX_LEVEL_ID}
      />
    );
  }
  if (phase === 'lost' && result) {
    const continueOffer: ContinueSheetProps | undefined = offer
      ? {
          streakAtDeath: result.streakAtDeath ?? 0,
          price: offer.price,
          secondChanceOffered: offer.secondChanceOffered,
          busy: continueBusy,
          onContinue: handleContinuePress,
          onSecondChance: handleSecondChancePress,
          onGiveUp: handleGiveUp,
        }
      : undefined;
    return (
      <>
        <FailScreen
          levelId={json.id}
          goals={result.goals}
          onRetry={handleRetry}
          onLevelMap={onLevelMap ?? onExit}
          {...(continueOffer ? { continueOffer } : {})}
        />
        {showOutOfCoins && offer ? (
          <OutOfCoinsSheet price={offer.price} onCancel={handleOutOfCoinsCancel} />
        ) : null}
        {continueFailedToast ? (
          <RetryToast
            message={t('continue.error.offline')}
            onDismiss={handleContinueToastDismiss}
            onRetry={handleContinuePress}
          />
        ) : null}
      </>
    );
  }

  // §9.3 pre-level slot: blocks `GameplayScreen` from mounting until this
  // level's choice is resolved, but ONLY when there's something to offer —
  // computed at render time (not an effect) so a level with nothing owned
  // never flashes the sheet for a frame before skipping it. Covers the vast
  // majority of runs (boosters start at L12); FTUE never reaches here with
  // anything owned in practice, so no separate mode-check is needed on top
  // of this "has any" gate.
  const hasAnyBooster =
    boosterCounts.hammer > 0 || boosterCounts.broom > 0 || boosterCounts.hourglass > 0;
  if (hasAnyBooster && preLevelResolvedFor !== json.id) {
    return (
      <BoosterPreLevelSheet
        counts={boosterCounts}
        initialSelection={boosterPreSelected}
        hourglassDisabled={Boolean(json.pieceSequence)}
        onConfirm={handlePreLevelConfirm}
      />
    );
  }

  return (
    <GameplayScreen
      key={`${json.id}-${attempt}`}
      initialState={initialState}
      onEvent={handleEvent}
      pause={pauseControls}
      boosters={boosterControls}
    />
  );
}
