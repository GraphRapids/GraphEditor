# GraphEditor - Project Context

## Purpose
GraphEditor is the GraphRapids web application playground for authoring graph YAML and previewing rendered SVG output against the canonical GraphAPI profile runtime.

## Primary Goals
- Fast, schema-aware YAML authoring workflow.
- Predictable, step-by-step autocomplete behavior.
- Low-latency live rendering with request debouncing and cancellation.
- Clear error handling without blocking editing.
- Keep active runtime profile consistent across autocomplete and render calls.

## System Snapshot
- Frontend: React + Vite.
- Editor: Monaco via `@graphrapids/graph-yaml-editor`.
- Autocomplete core: `@graphrapids/graph-autocomplete-core`.
- Viewer: `@graphrapids/graph-view`.
- Validation: YAML parse + JSON schema validation (AJV).
- Render backend: GraphAPI (`/api/render/svg`) behind Vite proxy.
- Profile runtime backend: GraphAPI (`/api/v1/profiles`, `/api/v1/autocomplete/catalog`).

## Runtime Configuration
- `GRAPHEDITOR_HOST`
- `GRAPHEDITOR_PORT`
- `GRAPHAPI_HOST`
- `GRAPHAPI_PORT`
- `VITE_GRAPHEDITOR_PROFILE_ID`

## Architecture Notes
- `src/AppCore.jsx`:
  - document state + validation pipeline
  - autocomplete orchestration + editor integration
  - render pipeline (debounce, abort, stale-response guard, cache)
- `src/App.jsx`:
  - re-exports AppCore and helper functions used by tests
- `e2e/autocomplete.behavior.spec.ts`:
  - Playwright behavior contract checks

## Autocomplete Contract Source of Truth
- `AUTOCOMPLETE_BEHAVIOR_TEMPLATE.md`

When behavior changes:
1. Update `AUTOCOMPLETE_BEHAVIOR_TEMPLATE.md`.
2. Update unit/e2e tests.
3. Implement code changes in `src/AppCore.jsx` (or extracted autocomplete module when refactored).

## Current Behavior Guardrails
- Root suggestions only for missing sections (`nodes`, `links`).
- No value suggestions for `name` and `label`.
- `type` values are suggested from schema/domain options.
- Link endpoint values (`from`, `to`) suggest known node names.
- Recursive behavior applies for nested `nodes`/`links`.

## Render Pipeline Rules
- Never render on every keystroke.
- Syntax/schema errors prevent render requests.
- Render requests are debounced and abortable.
- Out-of-order responses must not overwrite newer previews.
- Keep last known good SVG visible on render failures.
- Include profile id/version/checksum in render cache identity.

## Safety Rules
- Do not inject raw SVG with `dangerouslySetInnerHTML`.
- Render SVG through blob/object URL flow (current approach).

## Testing Expectations
- Unit/integration: `npm run test`
- E2E behavior: `npm run test:e2e -- e2e/autocomplete.behavior.spec.ts`
- Build: `npm run build`

## Open Decisions / TODO
- [x] Move autocomplete behavior callbacks consumed by GraphYamlEditor to `@graphrapids/graph-autocomplete-core`.
- [ ] Remove remaining duplicate autocomplete helper logic still present in `src/AppCore.jsx`.
- [ ] Add fixture-driven scenario tests from behavior template rows.
- [ ] Evaluate richer schema-location mapping for diagnostics.

## How To Maintain This File
- Keep this file stable and concise.
- Update after any architectural, behavioral, or contract-level change.
- Link to exact files, not chat history.
