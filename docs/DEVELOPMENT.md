# FCAutomationTool Development and Release

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

`package.json` is the Runner version source. `src/userscript-entry.js` keeps an `__DLR_VERSION__` metadata token, and the build injects the package version into the production metadata. Runtime display reads the bundled package version.

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

## Local Hot Reload

Install `FCAutomationToolHotReload.user.js`, then run:

```powershell
powershell -ExecutionPolicy Bypass -File ".\StartFCAutomationToolDevServer.ps1"
```

After source changes:

```powershell
npm run build
```

Use `Reload Loop` in the Web App. Only the dedicated Hot Reload userscript has `127.0.0.1`/`localhost` permissions; the production Runner must not gain them.

## FSU Local Maintenance

FSU Local uses two versions:

- `upstreamVersion`: immutable upstream baseline, currently `26.09`.
- `localVersion`: local derivative revision, currently `26.09.5`.

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

1. Update `package.json` using Semantic Versioning.
2. Update `CHANGELOG.md` and any compatibility documentation.
3. Run `npm install --package-lock-only` if package metadata changed.
4. Run `npm run verify` and commit the generated root userscript.
5. Complete the real Web App smoke checklist.
6. Create and push a matching tag, for example `v0.7.10`.

The tag workflow verifies again, builds profiles, creates a draft Release, uploads Runner/FSU/Profile assets plus `SHA256SUMS`, and only then publishes it. A published Release is immutable and cannot be overwritten by rerunning the workflow.

## Live Smoke Checklist

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
