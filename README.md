# GraphEditor

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![CI](https://github.com/GraphRapids/GraphEditor/actions/workflows/ci.yml/badge.svg)](https://github.com/GraphRapids/GraphEditor/actions/workflows/ci.yml)
[![Tests](https://github.com/GraphRapids/GraphEditor/actions/workflows/test.yml/badge.svg)](https://github.com/GraphRapids/GraphEditor/actions/workflows/test.yml)
[![Secret Scan](https://github.com/GraphRapids/GraphEditor/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/GraphRapids/GraphEditor/actions/workflows/gitleaks.yml)

GraphEditor is a React web app for authoring graph YAML and previewing rendered SVG from GraphAPI.

## Current Capabilities

- Monaco YAML editing via reusable `@graphrapids/graph-yaml-editor`
- Step-by-step, schema-aware autocomplete for graph authoring
- YAML syntax + JSON schema validation with Monaco markers
- Debounced/abortable render pipeline with stale-response protection
- Interactive SVG preview (`react-svg-pan-zoom`)
- Light/dark mode and SVG download

## Requirements

- Node.js `>=20`
- npm `>=10`
- GraphAPI running (default `http://127.0.0.1:8000`)

## Local Setup

### 1. Build and pack GraphYamlEditor (sibling repo)

From `../GraphYamlEditor`:

```bash
npm install
npm run build
npm pack
```

### 2. Install and run GraphEditor

```bash
npm install
cp .env.example .env.local
npm run dev
```

Default URL:

- `http://127.0.0.1:9000`

## Environment Variables

```bash
GRAPHEDITOR_HOST=127.0.0.1
GRAPHEDITOR_PORT=9000
GRAPHAPI_HOST=127.0.0.1
GRAPHAPI_PORT=8000
```

`vite.config.js` uses these for:

- dev server host/port
- `/api` proxy target

## NPM Scripts

```bash
npm run dev
npm run build
npm run preview
npm run test
npm run test:watch
npm run test:e2e
npm run test:e2e:headed
```

## API Endpoints Used

Via `/api` proxy:

- `GET /api/schemas/minimal-input.schema.json`
- `POST /api/render/svg`

## Autocomplete Behavior (Current)

- Root:
  - Empty doc suggests missing root sections (`nodes`, `links`)
  - Root suggestions show only missing sections
  - Deleting a root section auto-opens missing-section suggestions
- Node flow:
  - Starts at `- name: `
  - After name + Enter, suggests next keys for that node (`type`, `ports`, `nodes`, `links`) excluding keys already defined on that node
  - Nested `nodes` and `links` follow the same recursive behavior as root collections
- Link flow:
  - Starts at `- from: `
  - `from`/`to` suggest known node names from document state
  - Exact node match in endpoint value suggests `:` for optional port suffix
- Value policy:
  - No suggestions for `name` and `label` values
  - `type` values come from schema/built-in registries
  - `id` is excluded from key suggestions

Behavior contract file:

- `AUTOCOMPLETE_BEHAVIOR_TEMPLATE.md`

## Validation + Render Pipeline

1. Parse YAML locally.
2. Validate normalized graph input against loaded schema.
3. Debounce render request (`170-380ms`, size-aware).
4. Abort stale in-flight requests.
5. Reject out-of-order responses using request IDs.
6. Cache successful render output by normalized content hash.

Error handling:

- Syntax/schema errors stop render calls and surface diagnostics.
- API/render errors are shown while keeping last good SVG visible.
- Retry is limited to retryable failures.

## SVG Safety

Returned SVG is not injected with `dangerouslySetInnerHTML`.

GraphEditor converts SVG text to a Blob/Object URL and renders it as an `<image>` inside the viewer SVG.

## Architecture

```text
src/main.jsx                        # React entrypoint
src/App.jsx                         # AppCore re-export
src/AppCore.jsx                     # app state + validation + render + domain autocomplete logic
src/App.test.jsx                    # unit/integration tests
e2e/autocomplete.behavior.spec.ts   # e2e autocomplete tests
src/styles.css                      # UI styles
vite.config.js                      # dev server + proxy + Vitest config
```

External dependency:

- `@graphrapids/graph-yaml-editor` from sibling repo tarball:
  - `file:../GraphYamlEditor/graphrapids-graph-yaml-editor-0.1.0.tgz`

## Troubleshooting

### Schema load failed

Check GraphAPI at `http://${GRAPHAPI_HOST}:${GRAPHAPI_PORT}`.

### Preview is empty

Ensure render API response contains valid SVG text (direct or nested in JSON payload).

### Port in use

Change `GRAPHEDITOR_PORT` or stop the process currently bound to `${GRAPHEDITOR_HOST}:${GRAPHEDITOR_PORT}`.

## Governance

- `SECURITY.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `CHANGELOG.md`
- `RELEASE.md`
- `THIRD_PARTY_NOTICES.md`

## License

Apache-2.0 (`LICENSE`).
