# Streamlined purchase execution: findings and approved redesign

## Scope and state — 14 October 2026

Baseline: main `cd09458`, version 27.0.23. Fresh origin/main check matched it.
The latest diagnostic also reports 27.0.23. This review does not operate the
real account, clear journals or submit trades/contributions.

The user asks for a genuinely automated completion flow, rather than repeated
manual reconciliation. They also require English product UI for international
users; conversation with Sam can remain Chinese. The English Points Solver
patch was prepared on `codex/streamlined-english`. Other existing
modules are not represented as fully migrated by this scoped change.

## Findings

1. The selected market group requests eight copies of one exact version at
   reference price and approved cap 5,500. The route requires at least eight
   batches, with seven repeat purchases. The retained diagnostic includes a
   46,000 purchase-cost alternative with a one-batch estimate, versus 44,000
   for the selected market-only route. The existing lowest-value objective
   deliberately chooses cost over speed; a reference quote is not supply proof.
2. `NO_AFFORDABLE_CARDS` conflates distinct conditions. A local replay through
   the real planner, wave allocator and procurement driver reproduces it for
   no supply, insufficient budget, no capacity, and an already-held exact
   Club version. The last three cases perform zero market searches.
3. Reconciliation does not alter the frozen route. The diagnostic repeatedly
   reports recovered -> paused, with confirmed score unchanged at 1,660.
   An isolated replay also rejects a different plan as PURCHASE_RECOVERY_REQUIRED
   even with zero spend, no entries and no pending transaction. An incomplete
   goal is being treated like an unresolved transaction.
4. After all candidates in a wave have been attempted, a partial batch can
   still wait the configured 60 seconds. `waitForPartial` only runs timers;
   it does not continue searching. This is a deliberate existing wait policy,
   and must be displayed as batching wait, not claimed to be active search.
   Sam subsequently confirmed lowest material cost over fast completion.
5. Native search/bid/move diagnostics exist in the shared buyer, but Streamlined
   does not pass its `onEvent` recorder through. This export therefore lacks
   the actual market request/response facts needed to distinguish unavailable
   supply, search rejection/filtering, held-version blocking and capacity.
   No claim is made that EA had no listings, that a particular native request
   was wrong, or that increasing the price cap alone would fix this incident.

## Reproduction evidence

Local-only `node artifacts/streamlined-no-candidate-replay.mjs` exercises the
actual modules with synthetic state and an in-memory journal. It confirms
the selected 44,000 / eight-copy / one-version shape, the four conflated
pause conditions, recovery without route adaptation, and the changed-plan
block with no pending purchase. Irreversible effects: zero.
The first two prototype attempts had fixture import/cap omissions; the final
validated replay fixes those fixture issues without altering production code.

## Approved purchase redesign — lowest material cost

- Confirm the target, total spending limit and eligible inventory scope once.
  Keep locks, active-squad protection, source policy and exact receipts intact.
- Authorize an eligible candidate pool, not a single brittle exact-price route.
  Within that approval, adapt candidates and batch composition to actual
  availability and remaining points; never silently raise spending limits or
  expand inventory consumption.
- Separate normal scarcity/capacity/budget pauses from genuinely unknown
  purchases, moves or contributions. Reconcile known state in the background;
  do not require a recovery click for a zero-side-effect search failure.
- Close a useful partial batch when bounded search is exhausted. Do not
  present a timer-only delay as continuing to look for players.
- Record bounded search/offer/rejection and wave-exclusion facts. Show the
  actual blocker and next action, rather than the current umbrella message.
- Sam explicitly chose lowest material cost, accepting more batches and longer
  waits. The default remains `lowest-value`; no premium or faster route is
  automatically authorized. Sam also established commit/push main as this
  project's default after validation, unless explicitly told not to publish.

## Implementation in 27.0.24

- New previews freeze the eligible, quoted market substitution pool and every
  version's price cap into the plan fingerprint. The selected stock list is
  unchanged: other stock IDs do not become consumable by authorizing a pool.
- The execution button approves the displayed target, stock list, market pool,
  quote coverage and editable total purchase budget once. Default budget is
  the chosen route's cap sum, not a speculative extra allowance. After starting,
  this run's budget is frozen; a new budget requires a new explicit plan/action.
- Existing economic planning selects the lowest-cost feasible remaining market
  recipe within that approval after supply/holding blockers. An acquired cheap
  version is contributed before repeating it; the next expensive version is
  not bought merely to fill a wave sooner. Frozen estimates are not renewed;
  the exact selected-source quote is refreshed by the native adapter before
  purchase, and neither individual caps nor total budget can be raised.
- New schema 2 journals bind the immutable pool and bounded per-group demand
  to the approved plan. Old schema 1 journals keep their original route-only
  permission; read-only recovery does not migrate or expand them.
- The effective search cap is the lesser of the frozen card cap and remaining
  budget. A reviewed regression reproduces the old error of skipping a 200-coin
  offer because its per-card cap was 250 while the total budget was 200. Known
  bid rejections are kept distinct from empty supply and unknown receipts.
- Ordinary empty supply is retried at most twice, with 15-second waits, during
  the existing ten-minute approval. Stop, expiry and unknown receipts override
  retries. Capacity, already-held versions, budget, quote failures and native
  search rejections have separate reasons. Normal pauses can be retried directly.
- A different explicitly approved plan is allowed only after all dispatched
  effects have settled. The full old record is durably archived before
  replacement. Unconsumed purchases/unknown receipts are retained and block
  replacement; they are not dropped to satisfy a new route.
- Scoped Club holdings are read through the existing reviewed native read
  transport, in chunks of at most 50 version IDs, rather than inferred from
  partial/stale Club cache entries. Foreign or unverified rows stop execution;
  held stock is never silently adopted. Native search/bid/move events are now
  passed into the existing redacted diagnostic log.

## Local English UI validation

The Points Solver's labels, settings, tooltips, progress, protection errors,
quote warnings and recovery wording are translated. Numerical display uses
English separators; card/batch labels use singular/plural forms; native
player/SBC names remain unchanged. The pause message now says no executable
candidate for the current plan, rather than claiming verified market absence.
The language-only intermediate build passed 4,675 tests before the approved
redesign. It was not published as a completed purchase fix. The redesign's
version and final validation are recorded in the 27.0.24 release note.

## Remaining acceptance

Actual account search responses, supply and end-to-end automatic completion
remain unverified. Passing offline tests and the previous quote fix do not
prove real-account completion or market availability. No real purchases,
moves, contributions, journal clearing or browser installation were performed.
