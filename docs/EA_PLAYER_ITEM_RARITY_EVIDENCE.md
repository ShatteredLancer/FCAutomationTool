# EA Player Item Rarity Evidence

This document records the runtime evidence used by FCAutomationTool for Player
Item rarity and event-card decisions. It separates EA contracts from observed
FC26 data and compatibility-only probes so that a plausible method name cannot
silently become a submission policy.

## Evidence baseline

- EA Web App JavaScript build: `10821`
- Inspected file: `compiled_2.js?_=10821`
- FSU sources: `FSU_mod/*26.09*_origin.user.js` and the local optimized copy
- Installed FC26 Enhancer: extension `boffdonfioidojlcpmfnkngipappmcoh`, version
  `26.1.6.4`
- Runtime counterexample: `bug.log`, 2026-08-20

Re-check this baseline when the EA build changes. Runtime-observed rarity IDs
are current-build mappings, not permanent EA enum contracts.

## Verified EA entity contracts

EA build 10821 defines these Player Item methods on `UTItemEntity`:

```js
UTItemEntity.prototype.isCommon = function() {
  return this.rareflag === ItemRarity.NONE;
};

UTItemEntity.prototype.isRare = function() {
  return this.rareflag === ItemRarity.RARE;
};

UTItemEntity.prototype.isSpecial = function() {
  return !this.isCommon() && !this.isRare();
};

UTItemEntity.prototype.belongsToGroup = function(group) {
  return this.groups.indexOf(group) > -1;
};
```

The same entity also defines `isPlayer`, `isDuplicate`, `isLimitedUse`,
`isEnrolledInAcademy`, `isTradeable`, `isPlayerPickItem`, and the Bronze,
Silver, and Gold rating helpers. These methods describe the item state named by
the method. `belongsToGroup` only tests membership; the numeric group meaning
must come from the live EA requirement that consumes it.

EA build 10821 defines `isTOTW` on `UTSquadEntity`, not `UTItemEntity`:

```js
UTSquadEntity.prototype.setTOTW = function(value) {
  this._isTOTW = value;
};

UTSquadEntity.prototype.isTOTW = function() {
  return this._isTOTW;
};
```

It marks an EA squad as a Team of the Week squad. It is not a Player Item card
subtype API.

## Unsupported Player Item subtype calls

No Player Item contract for the following methods was found in EA build 10821,
FSU 26.09, or the installed FC26 Enhancer:

- `isTOTW` / `isTotw`
- `isTOTS` / `isTots`
- `isFOF` / `isFof`
- `isFUTTIES` / `isFutties`

FCAutomationTool must not call these methods on Player Items or use their return
values for eligibility, protection, routing, Active Squad handling, or submit
validation. In particular, the observed `isFOF() === true` result on a normal
card proves that the runtime member cannot mean "Festival of Football card".
Its actual origin and meaning remain unverified. There is also no evidence that
it means First Owner; EA uses item ownership data for that concept.

## Rejected group inference

`group 45` is not TOTW-specific. The runtime log contains both:

- Semenyo, rating 96, `rareflag:109`, groups `22/45/79/83/87`
- Jackson, ordinary Rare Gold, rating 80, `rareflag:1`, groups `4/22/36/45`

Therefore a raw group ID cannot identify a card subtype outside the live EA SBC
requirement matcher. The former `TOTW_GROUP_IDS = [45]` rule was invalid.

## Signals FCAutomationTool may use

1. Canonical normal/rare/special status comes from explicit `rareflag` and the
   verified EA rarity contract. Explicit metadata is authoritative over
   contradictory optional methods.
2. Dynamic SBC `PLAYER_RARITY_GROUP` eligibility comes from the current EA
   Challenge matcher (`meetsRequirements` or the injected exact matcher). The
   group ID remains opaque.
3. Rarity subtype labels may be read from EA rarity metadata via
   `services.Configuration.getItemRarity(item)` or `repositories.Rarity`.
   Player names are excluded. Name matching is supplemental protection and
   diagnostics, not a replacement for live Challenge eligibility.
4. Current FC26 TOTW items have been observed with explicit `rareflag:3`.
   Controlled items opened from a known TOTW Recovery reward can be temporarily
   marked as assumed TOTW until EA inventory metadata materializes. Both are
   current-runtime evidence, not a permanent enum guarantee.
5. Strict Club protection does not need TOTS/FOF/FUTTIES subtype inference: all
   explicit non-TOTW special cards are protected when the option is enabled.

## Compatibility-only probes

Some non-subtype aliases are not present on EA build 10821 but remain as
positive compatibility hints because FSU or another runtime may expose them:

- `isEvolution` / `isEvo`
- `isLoan` and related loan aliases
- `isConcept` and related concept aliases
- `isUntradeable`

They must not override contradictory explicit EA metadata. Their current use is
fail-closed: a positive result adds protection or removes a candidate. The
verified `isTradeable()` contract is checked before `isUntradeable()`.

## Regression controls

`tests/architecture/player-rarity-boundary.test.js` rejects unsupported Player
Item subtype calls and raw group-45/TOTW coupling. Unit and contract tests cover
explicit rarity precedence, the Semenyo/Jackson counterexample, metadata-only
subtype labels, dynamic EA matcher eligibility, and strict Club non-TOTW
protection.
