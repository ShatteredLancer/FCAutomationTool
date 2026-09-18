# Changelog

All notable user-facing changes are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [27.0.0] - 2026-09-18

### Read-only First Release

- Publish the explicitly approved read-only scope. Live execution remains
  hard-disabled; the release gate pins this exact Runner and FSU artifact pair
  and does not authorize later versions or unverified business execution.

- Switch the default build to the new `FC Automation Tool` installation identity
  and `fc-automation-tool@27.0.0`; keep legacy FC26 sources/tests for regression.
- Ship only the allowlisted FC27 traditional SBC preparation and recovery modules.
  Live execution remains disabled pending real low-value SBC acceptance.
- Prepare explicit Runner/FSU script, metadata, manifest and checksum assets;
  exclude legacy Loop/Profile and Preview assets from the new release workflow.
- Verify actual Tampermonkey installation, isolated GM storage, cross-tab locking
  and a local controlled update with state preserved after browser restart.
- Reject FC27 in the legacy Hot Reload loader. Real business acceptance is deferred
  until safe inventory is available and will require a separate feature release.

## [0.8.64] - 2026-09-03

### Fixed

- Forecast the next Rolling primary squad before submitting the current valid
  squad, but treat Provisions preflight as advisory. If no safe Provisions
  batch can be built, the Runner records the shortage and submits the already
  validated current squad once instead of entering an unrelated Storage
  recovery or stopping before useful work is completed.
- Treat EA's empty background-submit `status:0` / `UTServerErrorVO code:0`
  result as an ambiguous transport timeout rather than an ordinary error. The
  Runner now waits, refreshes My Packs and Unassigned, reloads the Challenge
  from a fresh Challenge-list request, reconciles the Rolling Inventory
  Ledger, reruns every submission validator, and retries the same squad once
  only when the completion counter, pack inventory, and every exact submitted
  item prove that the first request caused no server mutation. Any changed or
  incomplete evidence still stops without resubmitting.

## [0.8.63] - 2026-08-31

### Fixed

- Add **Resolve reward** under `Options -> Config` for a Rolling primary
  reward journal whose exact Pack is no longer found. The action refreshes My
  Packs six times, retains the journal when the Pack is visible, and only
  clears it after an explicit confirmation that the exact reward was already
  opened or was not granted by EA. This avoids a 24-hour stale-journal block
  without silently allowing a duplicate primary SBC submission.

## [0.8.60] - 2026-08-29

### Added

- Publish the dynamic high-rated Upgrade Rolling plan as one session entry:
  unlimited `86x10` takes priority, while a bounded `86x10` is combined with
  an independently confirmed unlimited `85x10` fallback. Set, Challenge, Pack,
  repeatability, and pending-reward identities remain bound and are rechecked
  before stage changes.
- Allow a live `TEAM_RATING`-only Rolling Challenge to enter rating planning
  without inventing a Required Special matcher; Challenges that do require
  special cards remain subject to the existing live-contract checks.
- Add an explicit Rolling setting that lets normal Provisions shortage
  recovery use exact Club current-pool non-TOTW special cards inside the
  configured `87-91` Provisions range only as a final fallback. The option is
  off by default, is overridden by strict Club special protection, and keeps
  FSU locks, Evolutions, Active Squad conflicts, protection ratings, and all
  other submission guards in force.

### Fixed

- When a delayed Storage-pressure Player Pick appears only after a Provisions
  pack open returns EA code `471`, redeem that known Pick through its Rolling
  owner, stage the selected card through normal Unassigned routing, and defer
  the still-unopened pack for the next bounded recovery pass. This avoids
  misreporting `PACK_OPEN_RESPONSE_LOST` or trying to move the Pick item to
  Club while preserving fail-closed handling for unrelated or mixed items.
- Continue Rolling when a deferred primary-pack duplicate has already become a
  normal Club item because another recovery SBC consumed its duplicate
  counterpart. The Runner verifies the exact item ID and definition and still
  blocks if a matching duplicate remains in Unassigned.
- Route an opened current-pool special duplicate to Storage when its exact
  submission entity is a Club non-TOTW special, including EA runtime items
  whose group metadata exists only under nested static data. Expanded live
  group-83 quantity no longer lets that exact duplicate target become a
  mandatory primary-squad item that is then rejected by the source filter,
  while the explicit Club current-pool Provisions fallback remains available.
- Complete a Rolling duplicate transaction when EA has already returned the
  exact protected counterpart to Club before finalization. The Runner now
  verifies that exact ID and value fingerprint through refreshed inventory
  reconciliation instead of repeatedly blocking because it is no longer in
  Unassigned.

## [0.8.48] - 2026-08-25

### Fixed

- Keep a Rolling primary squad that exceeds the live target rating as a plan
  only; do not save or otherwise mutate the current EA squad before recovery
  has produced a target-rated plan.
- When that rating excess occurs with insufficient SBC Storage headroom, run
  Provisions as an emergency Storage-first recovery. The recovery must consume
  enough real Storage cards for its reward, and may additionally use only the
  exact live group-83 special cards authorized by the current primary
  Challenge while preserving locks, Evolutions, high cards, pending duplicate
  signals, and Club non-TOTW specials.
- Refresh unresolved Provisions capability metadata once before declaring the
  recovery unavailable, so a loop captured before the latest SBC scan does not
  stop on stale capability state.

### Verification

- Full `npm run verify` passed, including syntax, ESLint, config/profile,
  architecture, FSU patch replay, tests, userscript/FSU builds, dist equality,
  metadata, and release-asset checks.

## [0.8.47] - 2026-08-25

### Fixed

- Make Rolling check existing Required Special/TOTW rewards before crafting,
  then open existing Provisions rewards one at a time and replan before
  attempting a new Provisions SBC only after those rewards are exhausted.
- Track exact Pack reward IDs and names for fully scanned TOTW and Provisions
  activity families, including bounded account-scoped history, so old and new
  reward IDs remain usable while avoiding similar unverified Pack names.
- Log the verified family reward candidates and current My Packs counts when
  Rolling enters TOTW or Provisions recovery.
- Preserve the live EA minimum count for `PLAYER_RARITY_GROUP=83`, while
  allowing Rolling to consume additional current-pool cards that the same live
  matcher accepts, subject to the existing source and protection guards.

## [0.8.46] - 2026-08-24

### Changed

- Consolidate the latest Manual Player Pick FUTBIN links and Rolling Recap
  card-version protection into a new updateable userscript release.
- Keep the merged release metadata and generated distribution artifacts at the
  same Runner version so Tampermonkey can detect the update reliably.

### Verification

- Full `npm run verify` passed: `199` test files / `1776` tests, plus syntax,
  ESLint, config/profile, architecture, FSU patch replay, userscript/FSU
  builds, dist equality, metadata, and release-asset checks.

## [0.8.45] - 2026-08-24

### Added

- Make each resolvable candidate name in the Manual Player Pick review a direct
  FUTBIN card link using the existing exact-ID resolver and cache. Links open in
  a new tab without selecting the candidate; unresolved names remain plain text.

### Fixed

- Prevent Rolling Recap from replacing a temporary Player Pick card with a
  different card version that shares its `definitionId`, such as an evolved
  Club card with a different rating or upgraded/cosmetic state.
- Keep the original Player Pick response authoritative when no same-version
  inventory entity can be found, while still hydrating metadata from an exact
  same-version Club entity when available.

### Verification

- Full `npm run verify` passed: `199` test files / `1776` tests, plus syntax,
  ESLint, config/profile, architecture, FSU patch replay, userscript/FSU
  builds, dist equality, metadata, and release-asset checks.

## [0.8.44] - 2026-08-24

### Added

- Add an optional HTTPS forwarding proxy for FUT.GG, configurable from the
  Trade Scheduler provider panel without exposing proxy credentials.
- Show the configured FUT.GG proxy origin and the provider circuit state in
  the live provider diagnostics.

### Fixed

- Treat FUT.GG HTTP 403, Cloudflare, and equivalent forbidden responses as a
  session-level circuit failure and automatically use FUTNext in Auto mode
  until the retry window expires or a FUT.GG request succeeds.
- Route Player Pick and special-card recap pricing through the shared quote
  provider so cache, fallback, proxy, and recovery behavior stay consistent.

### Verification

- Full `npm run verify` passed: `199` test files / `1774` tests, plus syntax,
  ESLint, config/profile, architecture, FSU patch replay, userscript/FSU
  builds, dist equality, metadata, and release-asset checks.

## [0.8.43] - 2026-08-24

### Fixed

- Expire a persisted Required Special/TOTW reward journal after 24 hours only
  when its pack is absent, no eligible material is confirmed in Storage/Club,
  and live Inventory Ledger reconciliation succeeds.
- Replan from current inventory after expiration instead of blocking every
  future Rolling run. Recent or unreconciled reward journals remain
  fail-closed, and a fresh recovery SBC is still subject to the normal Settings
  gate and submission guards.

### Verification

- `199` test files / `1769` tests passed; syntax, ESLint, config/profile,
  architecture, FSU patch replay, userscript/FSU builds, dist equality, metadata,
  and release-asset checks passed.

## [0.8.42] - 2026-08-24

### Fixed

- Reconcile the live Inventory Ledger when a persisted Required Special/TOTW
  recovery journal points to a reward pack that is no longer visible. If an
  eligible, unprotected Required Special is already confirmed in Storage or
  Club, clear the stale journal and continue without crafting another recovery
  SBC.
- Keep the existing fail-closed stop when reconciliation fails or only
  protected/locked material is present, and include the journal age plus the
  missing eligible-material state in the diagnostic.

### Verification

- `vitest run`: 199 files / 1765 tests passed.
- Syntax, undefined-symbol, config, profile, architecture, and FSU patch checks
  passed.
- Rebuilt and verified the root/distribution userscript at `0.8.42` and the FSU
  Local release assets at `26.09.6`.

## [0.8.41] - 2026-08-23

### Fixed

- Prefer fresh EA Purchased/Unassigned evidence when resolving opened-card
  duplicate identity, preventing stale pack or Club metadata from resurrecting
  a cleared duplicate signal and trapping ordinary cards such as Isak.
- Route fresh non-duplicate opened cards to Club and keep the route blocked until
  the exact item IDs are reconciled in their destination piles.
- Treat partial or no-op Storage moves as incomplete even when EA returns HTTP
  200; retain the exact unsettled IDs instead of reporting the whole batch as
  moved or replanning with stale Club counterparts.
- Preserve Academy-enrolled protection when EA inventory snapshots are used for
  candidate planning and final squad safety checks.

### Verification

- Full `npm run verify` passed: 199 test files, 1,763 tests, syntax/lint,
  configuration, architecture, FSU patch, build, distribution, and release
  asset checks.

## [0.8.40] - 2026-08-22

### Release

- Promote the guarded native duplicate-swap transaction, Storage-pressure
  recovery hardening, background Rolling SBC submission, and confirmed
  Storage Pressure/TOTW submission telemetry to the `0.8.40` release.
- Rebuild and validate the root/dist userscripts and release metadata.

## [0.8.35] - 2026-08-22

### Fixed

- Replace the unavailable live `Direct cycles` and `TOTW recoveries` estimates
  with exact per-run submission counters: `Storage Pressure` increments once
  per confirmed Storage Pressure challenge, and `TOTW SBCs` increments once per
  confirmed TOTW challenge. Planned, failed, cancelled, and ambiguous submits
  are excluded.
- Productized native duplicate-swap scope: the UI now exposes `off`,
  `special-only`, `safe-only`, and explicit test-only `all-eligible` modes.
  Legacy boolean opt-in migrates to `special-only`; controlled swaps require
  known tradeability, complete value fingerprints, and are limited to one
  pair per attempt. Unknown card state, extra EA identity mappings, and
  incomplete responses fail closed.
- Keep every pending Storage-routed Unassigned duplicate protected during
  emergency Provisions while native duplicate swaps are disabled. A pending
  reserve-rated card can no longer inherit the ordinary Provisions reserve
  consumption permission and resolve to its Club counterpart.
- Validate the selected duplicate signals again immediately before saving and
  submitting the recovery squad. If candidate protection ever regresses, a
  pending Storage signal is rejected independently of the submitted Club item.
- Preserve the existing Storage-pressure fallback: an infeasible safe
  Provisions squad remains unavailable, so Rolling can try the configured
  Storage pressure SBC and gain headroom only by consuming real Storage cards.

## [0.8.34] - 2026-08-22

### Fixed

- Route `DUPLICATE_SWAP_DISABLED_STORAGE_BLOCKED` through the existing safe
  Storage-pressure recovery chain instead of stopping immediately. Rolling
  first tries emergency Provisions, then the explicitly enabled Storage
  pressure SBC, and retries the exact pending Storage route only after enough
  capacity was verifiably released.
- While native duplicate swaps are disabled, require Storage-pressure recovery
  squads to consume enough real Storage cards. The pending Unassigned
  duplicates remain protected and cannot be submitted as duplicate signals by
  the recovery SBC.
- Reuse only the exact reverse duplicate mapping created by the active
  materialization transaction during same-Challenge replanning. This mapping
  submits the newly materialized Club entity without issuing a second native
  exchange; every changed, missing, or additional mapping remains blocked.
- Treat the Repository location as authoritative when restoring the protected
  Club counterpart. A stale EA entity `pile` scalar no longer blocks an exact
  Unassigned entity, while item ID, definition, tradeability, chemistry,
  evolution, upgrades, cosmetics, rarity, and other value fingerprints remain
  strict.

## [0.8.33] - 2026-08-22

### Changed

- Add `Enable experimental native duplicate swaps` to Selection Policy and
  keep it disabled for new and existing configurations by default. Enabling it
  retains the current native Unassigned/Club exchange transaction for targeted
  real-page testing.
- With the switch disabled, Rolling routes every newly materialized Unassigned
  duplicate to SBC Storage before any squad can consume its duplicate signal.
  If Storage cannot accept the complete batch, Rolling stops with
  `DUPLICATE_SWAP_DISABLED_STORAGE_BLOCKED` without moving a card, creating a
  journal, or submitting an SBC.
- Add a final submission guard for any duplicate signal missed by routing. It
  returns `DUPLICATE_SWAP_DISABLED` before the native EA move and journal write,
  so disabling the experiment can never fall back to submitting the original
  Club counterpart.
- Keep prior-run journal cancellation independent of the new switch. An
  exchange already performed by an earlier run is still classified and its
  exact protected Club ID is restored or safely cleared before current
  inventory is replanned.

### Fixed

- Isolate the still-experimental duplicate materialization chain from normal
  Rolling submissions. Ordinary cycles and duplicates that fit in Storage no
  longer enter that chain while the switch is off.

## [0.8.32] - 2026-08-21

### Fixed

- Treat every persisted duplicate-materialization transaction as cancelled at
  startup instead of attempting to continue the previous run. The reconciled
  Ledger now classifies every original protected Club item ID independently;
  the stale journal no longer depends on the old authorized consume item,
  squad, Challenge, or submission result still being present.
- If an original protected item is still displaced at startup, restore it and
  then clear the prior-run journal. Startup recovery never resumes the old SBC
  submission or requires the old squad and consume-card placement to survive
  across sessions.
- Classify every protected ID independently across Club, Unassigned, Storage,
  Transfer, and missing states. Restore only exact IDs still in Unassigned;
  preserve external Storage/Transfer moves, warn and continue for IDs that no
  longer exist, never substitute a same-definition card, and discard malformed
  journals instead of retrying them forever.
- Fail closed and retain a valid journal when the reconciled Ledger is absent,
  throws, returns another item ID or an unknown pile, when an exact Unassigned
  entity cannot be loaded or moved, when post-move Club reconciliation fails,
  or when journal deletion fails. A partially restored multi-pair journal is
  reclassified from current piles on the next startup instead of assuming the
  previous attempt completed atomically.

## [0.8.31] - 2026-08-21

### Fixed

- Validate an active duplicate transaction against the reconciled Inventory
  Ledger by exact item ID, definition ID, pile, and a non-stale inventory
  version. Normalized Ledger snapshots no longer fail transaction-local
  replanning merely because they omit complete EA chemistry, upgrade, cosmetic,
  or attribute fields; those value fingerprints remain strictly checked on the
  live EA entities at the physical swap and restoration boundaries.
- Verify post-compensation Club restoration and reverse-swap placement through
  the reconciled Ledger. A transiently missing Club Repository entity can no
  longer override confirmed exact restoration, while a wrong ID, definition,
  or pile still fails closed.
- Clear a `recovery-required` journal automatically when every recorded consume
  item is exactly back in Unassigned and every original protected counterpart
  is unchanged in Club. Ambiguous submission outcomes remain blocked.
- Preserve and log the original transaction-local replan failure when its
  compensation also fails, so the triggering planner error is not hidden by a
  later restoration error.

## [0.8.30] - 2026-08-21

### Fixed

- Persist each native untradeable duplicate exchange pair immediately from
  the strict live EA postcondition, before any cache or Ledger refresh. This
  prevents a transiently missing new Club entity from invalidating a confirmed
  swap and incorrectly compensating it.
- Reconcile the persisted exact IDs and piles through the Inventory Ledger
  after refresh, while retaining full value-fingerprint validation against the
  live EA entities. The original Club counterpart remains hard-protected.

## [0.8.29] - 2026-08-21

### Fixed

- Treat EA's pile-local `loyaltyBonus` normalization as runtime state rather
  than persistent card value identity. An old never-materialized duplicate
  journal can now be cleared when its exact source is safely in Storage and
  only loyalty changed from `1` to `0`; card version, tradeability, EVO,
  upgrades, cosmetics, chemistry style, attributes, and rarity remain strict.

## [0.8.28] - 2026-08-21

### Fixed

- Use EA's native two-argument single-entity `Item.move(item, CLUB)` contract
  for untradeable duplicate exchanges. Multiple pairs are exchanged
  sequentially; each exact new Club ID and protected counterpart ID is
  persisted before the next pair, with no Storage staging.
- Preserve and recover partial duplicate-swap progress by exact identity. A
  later pair failure compensates only pairs that were physically exchanged;
  ambiguous or incomplete EA mappings remain fail-closed.
- Load Rolling Provisions and 5x80 requirement-recovery Challenges directly
  through the SBC DAO. These guarded background submissions no longer open the
  SBC Squad screen before saving and submitting their verified inventory squad.
- Normalize live EA pile enums during duplicate-transaction recovery. A failed
  swap that left both exact cards unchanged no longer turns a planned journal
  into a false ambiguous state.
- Recover the narrow interruption window where EA completed the native swap
  but Runner had not yet persisted the new Club entity ID. After restoring the
  protected card, Runner clears the journal only when exactly one remaining
  Unassigned entity matches the source's complete value fingerprint; changed
  or non-unique identities remain blocked.
- Clear a legacy never-materialized journal without moving cards when the exact
  source has already been routed to Storage and the exact protected counterpart
  remains unchanged in Club. This does not use Storage as swap staging, and any
  value-identity change continues to block recovery.

### Diagnostics

- Add an opt-in, bounded native duplicate-swap trace to the console API. It
  observes the EA Unassigned controller, matching Item service methods, and
  Observable results without changing the production swap path, and restores
  every wrapper when stopped or when Runner is destroyed.
- Report the exact journal role, live pile, expected fingerprint, actual
  fingerprint, and changed fields when duplicate recovery blocks on value
  identity, so repository-model drift is distinguishable from a changed card.

## [0.8.27] - 2026-08-21

### Fixed

- Treat an Unassigned duplicate and its same-version Club counterpart as two
  distinct item identities. Rolling now materializes the Unassigned card into
  Club, invalidates the old squad, and replans the same exact Challenge so the
  original Club card cannot inherit submission authority.
- Validate the exact materialized item before save, after save, and immediately
  before transport. The submitted squad is read back for transport, and the
  protected counterpart must return unchanged to Club afterward.
- Keep duplicate swaps recoverable across Stop, refresh, validation failures,
  Active Squad replans, and transport timeouts through a persisted transaction
  journal. Journal write or clear failures now compensate and stop explicitly.

### Safety

- Same-definition cards, evolved or customized counterparts, loans, Academy
  cards, active trades, and FSU-protected cards cannot inherit the exact
  materialized item's one-time authorization.
- Transaction-local replanning is bounded to the original Challenge. Generic
  Requirements recovery rolls back when it cannot prove that binding, and the
  legacy 89/88 Storage Sink does not continue to the next squad after a failed
  transaction replan.

## [0.8.22] - 2026-08-19

### Fixed

- Normal Rolling Provisions and Required Special/TOTW recovery is Unassigned-
  first again by default. Selection Policy now exposes an opt-in Storage-first
  order; pending Unassigned duplicates stay Unassigned-first, while explicit
  Storage-pressure and maintenance recovery stays Storage-first.
- Provisions reserve max is now an explicit `87-88` through `87-91` selector.
  `87-88` is the default, while saved higher limits remain effective.
- Manual Player Pick candidates now render a dedicated player-name line and a
  secondary metadata line, while the resolved price stays in a fixed right-hand
  column. Long names or tags no longer hide the price needed for manual picks.
- Treat a fully completed Storage-pressure SBC as an exhausted session
  capability. Automatic mode now skips it, tries every cached alternative,
  performs one live metadata refresh for newly available candidates, and
  stops with `NO_STORAGE_SINK_AVAILABLE` when none remain. Selected mode does
  not switch SBCs and reports `STORAGE_SINK_COMPLETED` directly.

## [0.8.21] - 2026-08-19

### Fixed

- Recap rows now reserve the flexible primary column for the player name.
  Long reward-pack/source labels and metadata can truncate instead of forcing
  the name to disappear early; all three keep their full text in a hover
  title.
## [0.8.19] - 2026-08-19

### Added

- Added four Player Pick selection strategies: rating-first automatic,
  rating-first protected review, special-card price-first, and manual review
  whenever a special card appears.
- Added the same strategy selector to Selection Policy and Loop Builder, with
  migration from the legacy automatic-selection boolean.

### Safety

- Special price-first selection always ranks special cards before normal cards
  and pauses when a higher-priced duplicate special would displace a
  non-duplicate special, or when missing prices make a limited choice
  ambiguous.
- Applied the selected strategy consistently to ordinary, Provisions, Rolling,
  and Storage-pressure Player Picks, with regression coverage for legacy
  rating-first behavior.

## [0.8.20] - 2026-08-19

### Changed

- Provisions and normal Required Special/TOTW recovery now consume eligible SBC
  Storage material before Unassigned, Transfer, or Club, so recovery also
  relieves Storage pressure. The pending-Unassigned-duplicate recovery path
  remains intentionally Unassigned-first.
- Expanded the configurable Provisions reserve from 87-88/89 to 87-91; new
  installations default to 87-91 while existing saved settings remain intact.

### Safety

- The broader reserve still excludes FSU locks and filters, Evolutions,
  Required Special/TOTW cards, and ratings above the configured 91 cap.

## [0.8.18] - 2026-08-19

### Fixed

- Stopped FC26 group `44` TOTS/FUTTIES cards from being misclassified as TOTW,
  and normalized numeric EA pile values before enforcing the Club-only-TOTW
  Required Special policy.

### Safety

- Added live-shape regression coverage for `rareflag:3` TOTW and
  `rareflag:11/120` group-44 TOTS/FUTTIES cards from Club.

## [0.8.17] - 2026-08-19

### Fixed

- Routed a newly opened Required Special duplicate to SBC Storage when its
  exact Club submission target is protected by the live primary requirement.
- Rechecked reserved primary duplicates after the live Challenge refresh so a
  restored Unassigned state cannot require and protect the same card at once.
- Removed safely stored deferred duplicates from the next primary squad's
  mandatory routing set.

### Safety

- Protected Club event specials remain blocked from submission. This change
  stores the Unassigned duplicate signal instead of relaxing card protection.

## [0.8.16] - 2026-08-19

### Fixed

- Kept a successful pack response inside a committed settlement phase through
  item materialization, routing, receipt publication, recap recording, and
  Rolling Ledger reconciliation. A user Stop is now deferred until that work
  finishes instead of leaving opened items only partially accounted for.
- Changed pack-open retry recovery to inspect fresh Purchased/Unassigned API
  data before relying on page navigation. Hidden pending items now block a
  second open, verified-empty state allows a bounded retry with a fresh pack
  instance, and missing API/page evidence fails closed as ambiguous.
- Verified both sides of an untradeable-for-tradeable duplicate swap after EA
  completes the move, including exact card version, tradeability, identity,
  and expected Club/Unassigned piles.

### Safety

- Added regression coverage for Stop after the pack response, hidden
  Purchased items, stale pack instances, evidence-free 471 responses, and
  malformed duplicate-swap materialization.

## [0.8.15] - 2026-08-19

### Fixed

- Prevented a Required Special/TOTW recovery SBC from inheriting unrelated
  Unassigned primary-pack duplicates as mandatory recovery materials.
- When exact pending primary duplicates would block the Required Special
  reward, consume only those explicitly routed duplicates in the recovery SBC
  before creating or opening the reward.

### Safety

- Unrouted Unassigned duplicates remain protected during recovery, while FSU
  Lock, Evolution, Academy, rating, special-card, and Storage guards are
  unchanged.

## [0.8.14] - 2026-08-19

### Added

- Added independent, default-off permissions for Provisions shortage recovery
  and Required Special/TOTW recovery. Rolling now enters either recovery SBC
  only after its matching Settings checkbox is explicitly enabled.

### Changed

- Kept `Craft surplus Provisions/TOTW` scoped to proactive post-primary
  crafting; disabling it no longer implies that shortage recovery is allowed.
- Added policy summaries and stop reasons that distinguish a genuine Required
  Special shortage from disabled recovery permission.

### Safety

- Added final-squad regression coverage for FSU-locked, evolved, and
  Academy-enrolled players so each remains blocked before submission.

## [0.8.13] - 2026-08-19

### Fixed

- Routed non-required duplicate specials to SBC Storage whenever the live
  primary Challenge reserves every special slot for its exact Required Special
  condition. This prevents unrelated opened specials from becoming impossible
  required items in the no-special TOTW recovery squad and falsely stopping
  the Rolling Loop with `REQUIRED_ITEM_UNAVAILABLE`.

## [0.8.12] - 2026-08-19

### Fixed

- Preserved the exact Club or Storage pile while checking a newly opened
  duplicate's submission target, so protected Club non-TOTW specials are
  routed to SBC Storage before primary or Required Special recovery planning
  instead of causing a false `REQUIRED_ITEM_UNAVAILABLE` stop.

## [0.8.11] - 2026-08-19

### Added

- Added an opt-in Rolling policy that hard-protects every Club non-TOTW
  special card across primary, recovery, and Storage-pressure SBC squads.
- Added a shared pre-open capacity gate for existing and newly crafted
  Provisions, 5x80+, and Required Special recovery rewards.

### Changed

- Recovery reward opening now resolves full Storage through the configured
  Storage-pressure SBC, reconciles inventory, and retries the same pack rather
  than opening another reward into blocked Unassigned items.
- Club Other Specials retain their existing last-resort fallback when strict
  protection is disabled; Storage, Transfer, and Unassigned specials remain
  governed by the existing rating and role rules.

### Fixed

- Preserved the actual submission pile while resolving Unassigned and Transfer
  duplicate signals, preventing a signal from disguising a protected Club
  non-TOTW special as a non-Club candidate.
- Kept blocked recovery rewards unopened when Storage-pressure recovery is
  disabled or cannot release independently verified capacity.

## [0.8.10] - 2026-08-18

### Added

- Added dynamic Storage Sink challenge selection for supported high-rating
  Player Picks and direct Player SBCs, including live Required Special role
  parsing and source-aware Club fallback.
- Added bounded Storage Sink admission diagnostics covering candidate
  eligibility, duplicate targets, protection decisions, live EA entity
  resolution, and failure reasons.

### Changed

- Reused the primary Rolling challenge after Storage Sink and Required Special
  recovery instead of reloading an already active squad.
- Preserved protected primary duplicates while allowing explicitly required
  special cards to be consumed by the selected Storage Sink challenge.
- Added deterministic multi-squad rating selection and regression coverage for
  Unassigned, Storage, Transfer, Club, and live EA requirement entities.

## [0.8.5] - 2026-08-18

### Fixed

- Routed newly opened duplicate signals to SBC Storage when their exact EA
  `duplicateId` submission target is unavailable or protected, instead of
  reserving an impossible mandatory primary-squad item and stopping with
  `REQUIRED_ITEM_UNAVAILABLE`.
- Applied the same exact-target safety check when resuming a Rolling session
  with existing Unassigned duplicates.

## [0.8.4] - 2026-08-18

### Fixed

- Preserved exact Rolling primary duplicate items as their player-version
  candidate representatives after they move into SBC Storage, preventing
  same-definition inventory copies from causing a false
  `REQUIRED_ITEM_UNAVAILABLE` stop after Required Special recovery.

## [0.8.3] - 2026-08-18

### Fixed

- Reused and synchronized the already-loaded Rolling primary Challenge squad
  after Provisions or Required Special recovery submissions, avoiding EA `466`
  failures caused by immediately loading the same Challenge squad again.

## [0.8.2] - 2026-08-18

### Fixed

- Continued the Rolling Loop through an enabled Storage-pressure SBC when a
  pending Required Special reward cannot open because primary-pack duplicates
  exceed the available SBC Storage slots.
- Preserved the existing fail-closed behavior when Storage-pressure recovery is
  disabled, unavailable, or does not make independently verified progress.

## [0.8.1] - 2026-08-18

### Added

- Configurable Storage-pressure recovery with `Off`, `Automatic`, and
  `Selected SBC` modes for dynamically discovered high-rating Player Pick or
  direct Player SBCs.
- A lightweight Storage-pressure SBC catalog that preserves stable Set
  selection and deep-validates only the selected direct Player contract.
- Base-player `databaseId` snapshots and validation across EA inventory,
  deterministic rating selection, and final saved-squad inspection.

### Changed

- Generic Storage-pressure recovery submits one supported 87+ squad at a time,
  prioritizes Unassigned and Storage materials, and defers remaining squads to
  a later pressure event.
- Dynamic SBC discovery now recognizes direct Player rewards while excluding
  unvalidated Picks and scanned contracts without a supported 87+ squad.
- Rolling Selection Policy and documentation now distinguish automatic legacy
  recovery from an explicitly selected Storage-pressure SBC.

### Fixed

- Prevented two different card versions of the same base player from entering
  one rating SBC squad; conflicts are replanned without discarding required
  special-card roles.
- Reused and synchronized preloaded multi-Challenge squads after the first
  Storage-pressure submission, avoiding stale second-squad `466` failures.
- Prevented low-cost 83+/84+/87+ Pick contracts from remaining in the Selected
  SBC list after their Challenge metadata was rejected.
- Replaced the legacy `[BronzeLoop]` console prefix with `[DailyLoopRunner]`.

## [0.8.0] - 2026-08-17

### Added

- Dynamic `10x 85+ Upgrade Rolling Loop` discovery with live Challenge
  requirements, inventory bootstrap, one-pack-at-a-time processing, and
  configurable completion limits.
- Inventory Ledger, confirmed mutation deltas, low-cost runtime resource
  telemetry, and bounded Rolling Recap retention for long-running sessions.
- Role-aware exact-rating squad planning that reserves exactly one live
  Required Special and scales to large Club inventories without enumerating
  card combinations.
- Recovery workflows for existing or crafted TOTW rewards, bounded Provisions
  batches, immediate 85+ Pick and 5x80+ duplicate drains, and an optional
  sequential 89/88 95+ Storage-pressure Pick.
- Rolling Selection Policy controls for the automatic-use rating, Provisions
  reserve, shortage pack batch size, proactive surplus crafting, reward timing,
  and the optional Storage sink.
- A user-facing Rolling Loop guide with workflow and material-circulation
  diagrams, pack-opening rules, recovery behavior, and Stop/Resume guidance.

### Changed

- Dynamic SBC scanning uses incremental multi-pass recovery and only exposes
  Rolling when the current 10x85+ reward and single Required Special contract
  are fully supported.
- Rating planning now builds deterministic recipes from rating histograms and
  reuses bounded cache entries instead of searching card-instance combinations.
- Provisions made for Storage pressure remain unopened; historical Provisions
  are opened only after a real fodder shortage, in configurable batches that
  replan before continuing.
- Main-pack duplicates at or below the automatic-use threshold now feed the
  next primary squad first. Cards released to normalize the target rating are
  routed to Storage after submission.
- Player Pick tie handling automatically resolves safe equal-rating choices and
  only requests review when protected top choices exceed the available slots.

### Fixed

- Reconciled successful pack opens whose transport wrapper reports `471` or
  `500`, while retaining fail-closed checks for missing or ambiguous item
  materialization.
- Prevented stale Store catalog entries from being reopened as My Packs
  rewards and made retry decisions depend on repository and inventory evidence.
- Kept same-definition cards with different ratings, rarity flags, or Evolution
  versions from being misclassified as duplicate cleanup targets.
- Resumed pending Unassigned cards and partially completed 95+ Storage Picks
  before opening another primary reward.
- Prevented Storage-pressure recovery from repeatedly crafting Provisions that
  do not consume enough Storage cards to release the required slots.

### Safety Boundaries

- Club TOTS, FOF, FUTTIES, protected high-rated cards, FSU-locked cards, and
  uncertain item identities remain unavailable to automatic Rolling recovery.
- Club contributes only TOTW to the primary Required Special role; each primary
  squad is validated to contain exactly one matching special card.
- `Craft surplus Provisions/TOTW` and `Use 95+ Storage pressure Pick` remain
  opt-in. Disabling them does not disable recovery required by a real shortage.
- A Stop request waits for the current committed pack, submission, routing, and
  ledger reconciliation boundary before ending the session.

## [0.7.91] - 2026-08-12

### Added

- Guarded scheduling for up to three independently authorized Buy, Club
  Listing, or Transfer Reprice Jobs.
- Persistent run correlation across Scheduler history, authorization, Lease,
  Listing/Buy Journal, request-budget waits, and page reloads.
- Fail-closed Recovery review with evidence hashes, bounded audit history, and
  explicit acknowledgement for unknown Journals or expired Leases.
- Deterministic multi-Job soak, overlapping-tick, recovery-boundary, and
  cross-tab locking coverage.

### Changed

- Daily and Interval Jobs can consume two explicitly authorized occurrences;
  Once and Window Jobs remain limited to one.
- Scheduler preflight, Recovery checks, authorization consumption, Job
  selection, and execution-result handling now run inside the shared Scheduler
  lock and persistent Trade Lease boundary.
- Scheduler dialogs refresh external state without retaining stale local action
  messages.

### Fixed

- Prevented an overlapping Scheduler tick from treating the active Job's
  matching in-flight Journal as an unknown mutation and globally relocking
  unrelated Jobs.
- Preserved remaining recurring authorization and next-run timing across F5
  reloads while preventing duplicate run IDs or scheduled occurrences.
- Ensured expired Lease takeover remains two-phase and cannot clear uncertain
  mutation evidence before an audited terminal result exists.

### Safety Boundaries

- Trade mutations still require an authenticated EA page and explicit guarded
  authorization. Closing the page or browser does not provide background
  trading.
- Rare Gold Buy remains capped at four cards and four contiguous ratings;
  Listing/Reprice remains capped at four cards, and only three Jobs may be
  armed.
- Automatic bidding, Quick Sell, mixed Listing sources, bulk relist,
  server-side trading, and automatic unknown-Journal acknowledgement remain
  unsupported.
- Rollback point: `0.7.84`.

## [0.7.0] - Unreleased

### Added

- Production Tampermonkey identity and GitHub Release update endpoints.
- Lightweight `.meta.js` update assets for DailyLoopRunner and FSU Local.
- Immutable tag-driven Releases with SHA256 checksums.
- FSU Local `26.09.1`, maintained from the immutable FSU `26.09` baseline.
- MIT licensing, third-party notices, security guidance, and issue templates.

### Changed

- Simplified the root README and moved detailed usage, troubleshooting, and
  development guidance into `docs/`.
- Restricted remote ntfy notifications to the metadata-authorized ntfy.sh
  service.
- Removed localhost network permissions from the production Runner; the
  dedicated Hot Reload userscript retains local development access.

### Migration

- The production script has a new Tampermonkey name and namespace. Treat it as
  a new installation and disable or remove the old Validation script.
