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

`engineVersion()` (`packages/shared/src/dailyBoard.ts`) is the instrument: it
plays fixed probe boards and hashes the whole trace, and its pinned value lives
in `packages/shared/test/dailyBoard.test.ts`. **Read it in one direction only:**

- **Red** — the pinned value moved. The change IS engine-behaviour-affecting and
  this deploy window applies. No judgement call.
- **Green** — **not proof of safety.** A fingerprint covers only what its probes
  reach; a scoring path no probe exercises can change under a green test. (This
  is not hypothetical: before the perfect-clear probe existed, changing the
  perfect-clear bonus left the digest byte-identical.) So for **any** change
  under `packages/engine/`, use the window regardless — unless you can show the
  changed code is unreachable on the daily path (e.g. obstacle logic: §8.2
  prefill is obstacle-free, so no daily board can contain one).

Green is genuinely informative in the other direction: comments, renames,
formatting and pure refactors do not move it, and a value that jumped on every
deploy would be noise while §8.5's verdict needs signal. It is a *detector*, not
an oracle — that is also why the bullet above says "any change under
`packages/engine/`" rather than "whatever reddens the test".

The §5 determinism corpus hash (`pnpm --filter @blockmanor/engine test`) is a
*different* instrument and is not a substitute here. It exercises engine
behaviour on **generated** piece streams and never calls `dailyGameConfig()`;
`engineVersion` pins the published board's **fixed-sequence** surface — the
`GameConfig` §8.5 rebuilds, played from the sequence the player played — plus
the builder itself. Neither subsumes the other. Keep both pinned, and treat
either going red as "the window applies".

A `packages/content` change that the daily path imports (the greedy bot) is
**not** engine-behaviour-affecting: the bot only measures solvability at
generation, never re-simulates. It changes which board gets published, which is
recorded per-board in `solvability`, not in `engineVersion`.

## Everything else

Rules, indexes, and Functions changes that cannot alter `simulate()` output
(logging, alerting, new callables) deploy any time.
