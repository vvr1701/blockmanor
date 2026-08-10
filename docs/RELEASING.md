# Releasing — deploy windows

Normative. Referenced by PRD §8.2 (changelog v1.12).

## The one rule

**A Functions deploy that can affect engine behaviour lands in the window
immediately AFTER daily generation — never mid-day.**

Daily generation runs at **23:45 UTC** for the next UTC day (PRD §8.2). The
deploy window is therefore **23:50–00:30 UTC**: the day's board is already
sealed, and no player has submitted against it yet.

## Why

§8.5 re-simulates a submitted move log with the same `packages/engine` code the
client ran. A mid-day deploy that changes engine behaviour makes honest
submissions from before the deploy re-simulate to a different score — which
reads as cheating. The published board carries `engineVersion` (engine package
version + determinism corpus hash) so the mismatch is *detectable*; this rule
is what keeps it *rare*.

## What counts as engine-behaviour-affecting

Anything that changes what `simulate()` returns for a fixed
(config, seed, moves) triple:

- any change under `packages/engine/`
- any change to the version of `packages/engine` the Functions bundle pins
- any change to `packages/shared/src/dailyBoard.ts` `dailyGameConfig()`
- a `packages/content` change that the daily path imports (the greedy bot)

If in doubt: does the determinism corpus hash change (`pnpm --filter
@blockmanor/engine test`)? If yes, it is engine-behaviour-affecting.

## Everything else

Rules, indexes, and Functions changes that cannot alter `simulate()` output
(logging, alerting, new callables) deploy any time.
