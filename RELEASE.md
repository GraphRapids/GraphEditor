# Release Process

This project uses Semantic Versioning (SemVer) and tagged GitHub releases.

## Versioning Policy

- `MAJOR` (`X.0.0`): breaking API or behavior changes
- `MINOR` (`0.X.0`): backward-compatible features
- `PATCH` (`0.0.X`): backward-compatible fixes and documentation updates

Tag format is `vX.Y.Z` (for example, `v0.2.1`).

## 1. Prepare Release PR

1. Ensure `main` is green (`CI`, `Tests`, and `Secret Scan`).
2. Update `CHANGELOG.md`:
   - Move items from `Unreleased` to a new version section.
   - Add the release date.
3. Bump `version` in `package.json`.
4. Open a PR and merge it to `main`.

## 2. Tag and Publish

After merge to `main`:

```bash
git checkout main
git pull --ff-only
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

The `Release` workflow publishes the GitHub release for that tag.

## 3. Post-Release

1. Add a new empty `Unreleased` section at the top of `CHANGELOG.md`.
2. Verify build artifacts (`npm run build`).
3. Announce release notes.

## Hotfixes

For urgent fixes, branch from the latest release tag, apply the fix, and release as the next patch version.
