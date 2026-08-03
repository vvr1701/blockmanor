---
name: firebase-patterns
description: Server-authoritative patterns for this game — callable design, idempotency, security rules, daily-board generation/validation, wallet mutations, streak handling, and cost control. Load for any Firebase/backend work or review.
---
# Firebase Patterns

## The trust model
Client is optimistic UI; server owns truth for: wallet, streak, daily
results, leaderboards, entitlements. Anything a cheater would want to fake
is computed or verified server-side.

## Callable design
- Zod-validate inputs (schemas from packages/shared, shared with client)
- Idempotency: mutating callables take an idempotencyKey; store processed
  keys per-user with TTL; replays return the original result
- Auth required on everything; per-uid rate limits on submit endpoints
- Errors: typed codes the client maps to friendly toasts (PRD §12.8)

## Wallet (§9.1)
grantCoins/spendCoins callables only. Grants from ads = AdMob SSV callback;
from IAP = RevenueCat webhook → verify → grant. NEVER a callable that
grants based on client assertion. Every mutation writes an audit entry
{source, amount, balanceAfter, key}.

## Daily board (§8.2, §8.5)
- Scheduled fn 00:00 UTC: seed = HMAC(salt, date); salt in Functions config
  only; generate, bot-validate, publish with ENCRYPTED sequence
- playStart callable: marks attempt-consumed, returns decryption key
- submit callable: import packages/engine, simulate(config, seed, moves),
  accept only exact score match; reject dup/stale/oversized; update
  histogram (100 buckets) for percentile — never sort all scores

## Security rules
Default deny. Users read own docs; public read for dailyBoards metadata
(not sequences). ALL writes to protected collections via Functions (rules
block client writes). Rules tests in CI with the emulator.

## Cost control
Batch writes · histogram percentiles · cache RC 6h · schedule streak-risk
push locally on-device when possible · budget alerts assumed — flag any
feature projected >1 read/user/session in review.
