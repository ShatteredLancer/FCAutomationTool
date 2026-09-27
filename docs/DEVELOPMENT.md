# FCAutomationTool Development and Release

Current local version: `fc-automation-tool@27.0.1`, developed under normal production release standards. The published `27.0.0` remains immutable and read-only; its historical approval no longer gates new builds. Production and manifest share `__FCAT_LIVE_ENABLED__`. Release eligibility identifies a production artifact, not proof of live business acceptance. Feature validation and incomplete capabilities are documented separately; see [current release policy](FC27_GATES_AUDIT_ZH.md).

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

- `src/fc27/production-entry.js`: default production-format entry, single-SBC Live after explicit confirmation.
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

These commands report and verify the exact build's execution mode, test synthetic GM recovery/locks and optionally read EA state. They never click Submit/Confirm for an EA transaction, including when installing a Live-enabled production candidate. The separate Acceptance entry remains Live-disabled. The update probe temporarily installs synthetic older metadata under the same identity, tests Tampermonkey's updater over loopback, and restores exact production source. It never publishes the synthetic version or proves GitHub delivery. Do not run these commands concurrently against the same profile. Reports/screenshots remain local under `artifacts/fc27-browser`; only sanitized evidence enters fixtures.

## FSU Local Maintenance

FSU Local uses two versions:

- `upstreamVersion`: immutable upstream baseline, currently `26.09`.
- `localVersion`: local derivative revision, currently `26.09.9`.

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

1. Review implemented capabilities, relevant runtime evidence and outstanding limitations. There is no per-version manual hash allowlist or old installation-fixture gate. Do not describe unimplemented or unverified behavior as tested.
2. Update `package.json` using `27.x.y` for FC27 and synchronize the lock file.
3. Update `CHANGELOG.md` and compatibility documentation with actual evidence.
4. Run `npm run verify`, `node scripts/verify-fc27-prelaunch.mjs --browser`, and `git diff --check`.
5. Run `node scripts/check-release-readiness.mjs --packaging` and `node scripts/package-fc27-release.mjs`. These validate current build/FSU assets and generate checksums; neither command publishes remotely.
6. Commit the generated root script with source changes. When publication is requested, create/push the matching new version tag. Development authorization alone does not publish a Release.

The tag workflow runs full regression, FC27 and offline browser checks, verifies version/tag and current artifacts, then uploads the Runner/FSU script/meta/manifest asset list plus `SHA256SUMS` from a draft Release. Release notes come from `docs/releases/<version>.md`. Preview artifacts remain separate. After publishing, verify actual GitHub downloads/metadata and installation delivery. Published Releases remain immutable. Old FC26 assets remain available by version tag.

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
