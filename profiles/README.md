# FCAutomationTool Profile Library

This directory is the source library for downloadable Workflow/Loop Profiles.

## File format

Add one `*.profile.json` file per Profile. The filename must match `id`.

Official presets may reference a built-in preset:

```json
{
  "schemaVersion": 1,
  "id": "example",
  "name": "Example",
  "description": "What this Profile changes.",
  "preset": "default",
  "minimumRunnerVersion": "0.6.10",
  "tags": ["official"]
}
```

Uploaded custom Profiles should contain the complete validated Builder export under `config` instead of `preset`:

```json
{
  "schemaVersion": 1,
  "id": "my-profile",
  "name": "My Profile",
  "description": "A complete custom Workflow/Loop configuration.",
  "minimumRunnerVersion": "0.6.10",
  "tags": ["community"],
  "config": {
    "loops": [],
    "recoveryRecipes": [],
    "unassignedRecoveryPolicies": [],
    "defaultUnassignedRecoveryPolicyIds": []
  }
}
```

Exactly one of `preset` or `config` is required. Dynamic Pick snapshots must not be uploaded as reusable static Profiles; descriptors containing `discovered`, `discoveryIdentity`, or a `discovered-player-pick-*` Loop fail validation.

## Validation and release packaging

Run:

```powershell
npm run check:profiles
npm run build:profiles
```

The build writes importable `*.loops.json` files and `manifest.json` to `dist/profiles/`. GitHub Actions validates Profile changes on every push and pull request. A tagged release includes the current library as `FCAutomationTool.profiles.zip`. Published releases are immutable, so every Profile library update that must be distributed requires a new package version and matching release tag.
