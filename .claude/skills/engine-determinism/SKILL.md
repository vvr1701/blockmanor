---
name: engine-determinism
description: Rules and patterns for writing or reviewing code in packages/engine — purity constraints, seeded RNG usage, event emission, fuzz testing, and the simulate() anti-cheat contract. Load for any engine work or engine review.
---
# Engine Determinism

## Why this matters
The Daily Board's anti-cheat (PRD §8.5) re-runs the player's move log on the
server with the SAME engine code and compares scores. One nondeterministic
line breaks the entire trust model silently.

## Banned inside packages/engine (lint-enforced, but know why)
- Math.random → use rng.ts seeded PRNG (mulberry32 — pinned in PRD §4.3;
  swapping it is a breaking change requiring an amendment), advanced
  only through GameState so replays consume identical sequences
- Date.now / new Date → time is not a game input; if ever needed, inject
  via GameConfig
- Any import of react/react-native/expo/firebase/fs/fetch
- Floating-point accumulation in scoring — all scores integer math
- Iteration over object keys where order affects outcomes — use arrays

## Patterns
- State is immutably updated; applyPlacement returns {state, events}. No
  hidden mutation, no module-level state.
- All randomness flows: seed → PRNG state stored IN GameState → draws
  advance it. Redraws (§6.3) and mercy (§6.4) consume draws deterministically.
- GameEvent[] is the only renderer channel. Events describe what happened
  (LINES_CLEARED{rows,cols,cells,combo}), never how to animate it.

## Testing requirements per change
- Unit tests for the changed rule + its edges
- Determinism fuzz: 1,000 random games, run twice, deep-equal final states
  and event logs; include the output in your report
- Golden replays: committed (config,seed,moves,expectedScore) fixtures that
  must never change without a PRD amendment — they ARE the rule spec
- Coverage ≥90% lines (CI gate)
