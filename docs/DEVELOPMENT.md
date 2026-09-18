# FCAutomationTool Development and Release

Current version: `fc-automation-tool@27.0.0`, approved explicitly as a read-only first release. Live remains hard-disabled and real low-value SBC acceptance is deferred. `scripts/fc27-readonly-release.json` pins this exact Runner/FSU artifact pair; future versions, changed scripts and Live are not authorized by this approval.

## Requirements

- Node.js 22
- npm with the committed `package-lock.json`
- Git
- PowerShell for local helper scripts
- Python only for the optional Hot Reload HTTP server

```powershell
npm ci
npm run verify
```

## Source Layout

- `src/fc27/production-entry.js`: default production-format entry, currently read-only.
- `src/fc27`: traditional planner, transaction and recovery contracts.
- `src/userscript-entry.js` and legacy modules below: FC26 regression source, not bundled into FC27 unless explicitly allowlisted.

- `src/config`: Loop schema, discovery, Profile and runtime policy.
- `src/workflows`: side-effect orchestration by strategy.
- `src/adapters`: EA, browser and fake boundaries.
- `src/selection`, `src/pack`, `src/unassigned`, `src/sbc`, `src/reward`: domain services.
- `src/ui`: main panel, Builder, dialogs and recap rendering.
- `tests`: unit, contract, workflow, architecture and fixtures.
- `FSU_mod`: immutable FSU upstream baseline, local derivative, patch and manifest.

The detailed dependency and safety rules are in [`AGENTS.md`](../AGENTS.md).

## Generated Files

Do not manually edit:

- `FCAutomationTool.user.js`
- `dist/FCAutomationTool.user.js`
- `dist/FCAutomationTool.meta.js`
- `dist/FSU-Local.user.js`
- `dist/FSU-Local.meta.js`
- `dist/profiles/*`

Build them with:

```powershell
npm run build
npm run build:profiles
```

`package.json` is the sole active Runner version source. The FC27 entry receives metadata and display versions from the production builder. `build:profiles` remains a legacy FC26 regression build, not a FC27 release asset. `scripts/build-fc26-regression.mjs` compiles the frozen legacy entry in memory using its historical package input without overwriting current assets.

## Verification

`npm run verify` performs:

1. JavaScript syntax checks.
2. Loop/Profile/schema validation.
3. Architecture audits.
4. FSU patch hash and replay verification.
5. Full Vitest suite.
6. Runner and FSU Local release builds.
7. Full/meta asset and version consistency checks.

CI additionally checks that the generated root compatibility userscript is committed, uploads JUnit reports, and preserves failure logs.

## Local Installation

FC27 must run directly in the Tampermonkey sandbox. Build and serve the local script:

```powershell
powershell -ExecutionPolicy Bypass -File ".\StartFCAutomationToolDevServer.ps1"
```

After source changes:

```powershell
npm run build
```

Install/reinstall the exact `FCAutomationTool.user.js` through Tampermonkey, then reload the page. Disable old Runner/Preview/Acceptance/Hot Reload scripts; keep FSU Local enabled. The legacy Hot Reload script now rejects FC27 before destroy/eval. No FC27 page-global GM bridge or localhost production grant is allowed.

In the owned inspection profile, after user login:

```powershell
node scripts/browser-inspection/acceptance.mjs --production --install --live-read
node scripts/browser-inspection/production-update.mjs
node scripts/browser-inspection/acceptance.mjs --production --live-read
```

These commands install only the reviewed Live-disabled build, test synthetic GM recovery/locks and optionally read EA state. The update probe temporarily installs synthetic older metadata under the same identity, tests Tampermonkey's updater over loopback, and restores exact production source. It never publishes the synthetic version or proves GitHub delivery. Do not run these commands concurrently against the same profile. Reports/screenshots remain local under `artifacts/fc27-browser`; only sanitized evidence enters fixtures.

## FSU Local Maintenance

FSU Local uses two versions:

- `upstreamVersion`: immutable upstream baseline, currently `26.09`.
- `localVersion`: local derivative revision, currently `26.09.8`.

The maintained build must keep the upstream userscript identity exactly: `@name 【FSU】EAFC FUT WEB 增强器` and `@namespace https://futcd.com/`. Tampermonkey isolates GM storage by script identity, so changing either field creates a separate settings scope and resets the user's SBC exclusions, ranges, locks, and related preferences. GitHub release ownership is expressed through the version, description, homepage/support URL, and update/download URL instead.

Maintenance inputs are in `FSU_mod/fsu-mod.config.json`. After changing the local derivative:

```powershell
npm run build:fsu-patch
npm run check:fsu-patch
npm run build:fsu-release
npm run check:fsu-release
```

The patch generator must reproduce the exact modified SHA256 from the immutable origin. A new upstream version requires a new reviewed origin/mod baseline and live validation; patch context applying cleanly is not sufficient evidence.

## Release Process

1. Verify explicit publication approval for the exact scope and artifact. The 27.0.0 approval is read-only; enabling Live requires separate real low-value SBC acceptance and approval.
2. Update `package.json` using `27.x.y` for FC27 and synchronize the lock file.
3. Update `CHANGELOG.md` and compatibility documentation with actual evidence.
4. Run `npm run verify`, `node scripts/verify-fc27-prelaunch.mjs --browser`, and `git diff --check`.
5. Run `node scripts/package-fc27-release.mjs` and `node scripts/check-release-readiness.mjs --packaging`. Installation evidence must match the exact artifact SHA256; rerun when the artifact changes.
6. Only after final approval, commit the generated root script and create/push the matching tag, for example `v27.0.0`.

The tag workflow verifies first, enforces the pinned scope/installation gate, and uploads only the explicit Runner/FSU script/meta/manifest asset list plus `SHA256SUMS` from a draft Release. Release notes come from `docs/releases/<version>.md`, not automatically generated feature claims. No legacy Loops/Profile/Preview assets are shipped. After publishing, verify actual GitHub downloads/metadata and fresh-install delivery. The local update test cannot replace that check. Published Releases remain immutable. Old FC26 assets must be referenced by their version tag once latest points at FC27.

## Live Smoke Checklist

The following is the legacy broad matrix; FC27 only claims evidence recorded in `FC27_LIVE_ADAPTATION_ZH.md`. Unsupported old features remain excluded, not implicitly accepted.

- Fresh production userscript installation.
- Manual Tampermonkey update from the previous test release.
- FSU upstream and FSU Local startup.
- Enhancer enabled and disabled.
- Built-in and official Profile restoration.
- Incremental and cold Dynamic SBC scan.
- Dry Run plus one low-risk live SBC.
- One Pack with non-duplicate and duplicate routing.
- Stop behavior and Save log.
- Release rollback by manually installing the previous versioned asset.

Automated tests do not replace these page-level checks.
