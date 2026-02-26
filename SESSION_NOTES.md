# GraphEditor - Session Notes

Use this file as a running log between work sessions.

## Entry Template

### YYYY-MM-DD
- Summary:
- Changes:
- Files touched:
- Tests run:
- Known issues:
- Next steps:

## Current

### 2026-02-26
- Summary: Adapted GraphEditor to the profile-driven runtime design (GraphAPI canonical profiles).
- Changes:
  - Added profile discovery and active profile selection (`/api/v1/profiles`).
  - Added active catalog resolution (`/api/v1/autocomplete/catalog`) and passed profile hints to `GraphYamlEditor`.
  - Updated render requests to include `profile_id`/`profile_stage`/`profile_version`.
  - Captured profile headers from render responses and surfaced profile metadata in `GraphView`.
  - Updated render cache identity to include profile id/version/checksum.
  - Added/updated tests and e2e API mocks for profile endpoints.
- Files touched:
  - `src/AppCore.jsx`
  - `src/App.test.jsx`
  - `src/styles.css`
  - `e2e/autocomplete.behavior.spec.ts`
  - `.env.example`
  - `README.md`
  - `PROJECT_CONTEXT.md`
  - `SESSION_NOTES.md`
- Tests run:
  - pending in this session (run with `npm run test`, `npm run test:e2e`, `npm run build`)
- Known issues:
  - Legacy duplicate autocomplete helper code remains in `AppCore.jsx`.
- Next steps:
  - Remove remaining duplicate autocomplete helper code and rely only on package APIs.

### 2026-02-25 (GraphAutocompleteCore wiring)
- Summary: Wired GraphEditor autocomplete callbacks to shared GraphAutocompleteCore package.
- Changes:
  - Added `@graphrapids/graph-autocomplete-core` dependency.
  - Updated `src/AppCore.jsx` to pass core package functions into `GraphYamlEditor`.
  - Updated docs/context to include new dependency.
- Files touched:
  - `package.json`
  - `package-lock.json`
  - `src/AppCore.jsx`
  - `README.md`
  - `PROJECT_CONTEXT.md`
- Tests run:
  - `npm run test -- src/App.test.jsx --run`
  - `npm run test:e2e -- e2e/autocomplete.behavior.spec.ts`
  - `npm run build`
- Known issues:
  - Legacy duplicate autocomplete helper code still exists in `AppCore.jsx` and should be removed in follow-up refactor.
- Next steps:
  - Complete removal of duplicate local autocomplete logic in GraphEditor.

### 2026-02-25
- Summary: Added persistent context templates for GraphEditor.
- Changes: Introduced `PROJECT_CONTEXT.md` and `SESSION_NOTES.md`.
- Files touched:
  - `PROJECT_CONTEXT.md`
  - `SESSION_NOTES.md`
- Tests run: not run (docs-only update).
- Known issues: none.
- Next steps:
  - Keep this log updated at end of each coding session.
