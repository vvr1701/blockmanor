# Releasing — deploy windows

Normative. Referenced by PRD §8.2 (changelog v1.12, v1.14).

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
reads as cheating. The published board carries `engineVersion` so the mismatch
is *detectable*; this rule is what keeps it *rare*.

## What counts as engine-behaviour-affecting

Anything that changes what `simulate()` returns for a fixed
(config, seed, moves) triple on the **daily path**:

- any change under `packages/engine/`
- any change to the version of `packages/engine` the Functions bundle pins
- any change to `packages/shared/src/dailyBoard.ts` `dailyGameConfig()`

Do not guess — **ask the field itself**. `engineVersion()`
(`packages/shared/src/dailyBoard.ts`) plays fixed probe boards and hashes the
whole trace, so it moves for exactly the changes above and for nothing else. Its
pinned value lives in `packages/shared/test/dailyBoard.test.ts`; if that test
goes red, the change is engine-behaviour-affecting and this deploy window
applies. If it stays green, the change cannot alter a re-simulation and deploys
any time.

What it deliberately does NOT move for: comments, renames, formatting, and pure
refactors — a version that jumped on every deploy would be noise, and §8.5's
verdict needs signal.

The §5 determinism corpus hash (`pnpm --filter @blockmanor/engine test`) is a
*different* instrument and is not a substitute here: its fuzz corpus sets no
`GameConfig.pieceSequence`, and the Daily Board plays entirely from a fixed
sequence, so a change to how `simulate()` consumes that sequence leaves the
corpus hash untouched. Keep both pinned.

A `packages/content` change that the daily path imports (the greedy bot) is
**not** engine-behaviour-affecting: the bot only measures solvability at
generation, never re-simulates. It changes which board gets published, which is
recorded per-board in `solvability`, not in `engineVersion`.

## Everything else

Rules, indexes, and Functions changes that cannot alter `simulate()` output
(logging, alerting, new callables) deploy any time.
