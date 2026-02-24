# GraphEditor

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![CI](https://github.com/GraphRapids/GraphEditor/actions/workflows/ci.yml/badge.svg)](https://github.com/GraphRapids/GraphEditor/actions/workflows/ci.yml)
[![Tests](https://github.com/GraphRapids/GraphEditor/actions/workflows/test.yml/badge.svg)](https://github.com/GraphRapids/GraphEditor/actions/workflows/test.yml)
[![Secret Scan](https://github.com/GraphRapids/GraphEditor/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/GraphRapids/GraphEditor/actions/workflows/gitleaks.yml)

GraphEditor is a React + Monaco web app for authoring graph YAML and previewing rendered SVG from GraphAPI.

## Current Capabilities

- Monaco YAML editor with a stable model lifecycle (`@monaco-editor/react`)
- Step-by-step autocomplete driven by YAML context + schema-derived rules
- Live validation:
  - YAML syntax (`js-yaml`)
  - schema validation (`ajv`)
  - Monaco markers for both
- Live SVG preview pipeline with debounce, request cancellation, stale response protection, and small render cache
- Interactive pan/zoom preview (`react-svg-pan-zoom`)
- Download rendered SVG
- Light/dark theme toggle

## Requirements

- Node.js `>=20`
- npm `>=10`
- GraphAPI running (default `http://127.0.0.1:8000`)

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Default local URL:

- `http://127.0.0.1:9000`

## Environment Variables

Dev host/port and GraphAPI target are environment-driven:

```bash
GRAPHEDITOR_HOST=127.0.0.1
GRAPHEDITOR_PORT=9000
GRAPHAPI_HOST=127.0.0.1
GRAPHAPI_PORT=8000
```

`vite.config.js` uses these for:

- Vite dev server host/port
- `/api` proxy target to GraphAPI

## NPM Scripts

```bash
npm run dev              # start Vite dev server
npm run build            # production build
npm run preview          # preview production build
npm run test             # unit/integration tests (Vitest + coverage)
npm run test:watch       # Vitest watch mode
npm run test:e2e         # Playwright e2e tests
npm run test:e2e:headed  # Playwright headed mode
```

## API Endpoints Used

Through the local `/api` proxy:

- `GET /api/schemas/minimal-input.schema.json`
- `POST /api/render/svg`

## Autocomplete Behavior (Current)

Autocomplete is intentionally next-step oriented (not full templates everywhere):

- Root:
  - Empty document suggests missing top-level sections (`nodes`, `links`)
  - At root, suggestions only include sections that are still missing
  - Deleting a root section (for example `links`) re-opens suggestions for the missing section
- Node flow:
  - Starts from `- name: `
  - After node name + enter, suggests next logical keys (for example `type`, `ports`, `nodes`) based on what is already present
  - Already-defined keys for the same node are not suggested again
- Link flow:
  - Starts from `- from: `
  - `from` and `to` values suggest known node names from the current document
  - When a node name matches exactly in `from`/`to`, `:` is suggested to continue with a port suffix
- Value policies:
  - No value suggestions for `name` and `label` (free user input)
  - `type` values are suggested from schema/built-in registries
  - `id` is excluded from autocomplete suggestions

Detailed scenario contract lives in:

- `AUTOCOMPLETE_BEHAVIOR_TEMPLATE.md`

## Validation and Rendering Pipeline

1. Parse YAML locally.
2. Validate normalized input against loaded JSON Schema.
3. If valid, debounce render request (`170-380ms`, size-based).
4. Cancel previous in-flight render requests (`AbortController`).
5. Ignore out-of-order responses with monotonic request IDs.
6. Cache successful renders by normalized document hash.

Error handling:

- Syntax/schema errors block API render calls and show markers/messages.
- API/network/render errors are surfaced while keeping the last good SVG visible.
- Retry is limited to retryable failures (single retry with short delay).

## SVG Safety

The app does not inject raw returned SVG via `dangerouslySetInnerHTML`.

Instead, rendered SVG is loaded through a Blob/Object URL and displayed as an `<image>` inside the viewer SVG. This isolates remote SVG markup from direct DOM injection.

## Architecture

```text
src/main.jsx                        # React entrypoint
src/App.jsx                         # re-export wrapper for AppCore
src/AppCore.jsx                     # app state, validation, render pipeline, autocomplete logic
src/GraphYamlEditor.jsx             # reusable Monaco editor component + Monaco integration
src/App.test.jsx                    # unit/integration tests
e2e/autocomplete.behavior.spec.ts   # Playwright autocomplete behavior tests
src/styles.css                      # UI styles
vite.config.js                      # env-based host/port + /api proxy + test config
```

## Extending Autocomplete and Validation

Main extension points:

- `src/AppCore.jsx`
  - `DEFAULT_AUTOCOMPLETE_SPEC`
  - `extractAutocompleteSpecFromSchema`
  - `getYamlAutocompleteContext`
  - `getYamlAutocompleteSuggestions`
  - `extractNodeTypesFromSchema` / `extractLinkTypesFromSchema`
- `src/GraphYamlEditor.jsx`
  - Monaco completion provider registration
  - insertion behavior and post-insert trigger behavior
  - keyboard-driven next-step transitions

## Troubleshooting

### Schema load failed

Verify GraphAPI is reachable at `http://${GRAPHAPI_HOST}:${GRAPHAPI_PORT}`.

### Rendered preview stays empty

Check API response payload/content-type. The app expects SVG text, or JSON containing an SVG string in nested fields such as `svg`, `data`, `result`, or `output`.

### Port already in use

Set a different `GRAPHEDITOR_PORT` or stop the process using `${GRAPHEDITOR_HOST}:${GRAPHEDITOR_PORT}`.

## Governance

- Security policy: `SECURITY.md`
- Contribution guide: `CONTRIBUTING.md`
- Code of conduct: `CODE_OF_CONDUCT.md`
- Changelog: `CHANGELOG.md`
- Release process: `RELEASE.md`
- Third-party notices: `THIRD_PARTY_NOTICES.md`

## License

Apache License 2.0 (`LICENSE`).
