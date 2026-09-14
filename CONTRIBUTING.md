# Contributing

## Development Setup

Requirements:

- Windows or a compatible PowerShell environment
- Node.js 22
- Git

Install dependencies and run the complete verification chain:

```powershell
npm ci
npm run verify
```

Do not edit `FCAutomationTool.user.js` or files under `dist/` manually. Edit
`src/` and run `npm run build`. FSU Local changes must update the origin/mod
patch chain through `npm run build:fsu-patch` and pass replay verification.

## Pull Requests

- Keep changes scoped and explain the affected Workflow/Loop surface.
- Add tests proportional to the submission and inventory risk.
- Include real EA Web App validation steps when automated tests cannot cover
  page behavior.
- Do not weaken FSU settings, locked-player handling, rating limits, special
  card protection, or pre-submit entity validation.
- Run `npm run verify` and `git diff --check` before submitting.

Architecture and release requirements are documented in [`AGENTS.md`](AGENTS.md).

## Releases

Only a version tag matching `package.json`, such as `v0.7.0`, can publish a
Release. The GitHub workflow verifies, builds, records SHA256 checksums for the asset set,
creates a draft, uploads immutable assets, and then publishes it.
