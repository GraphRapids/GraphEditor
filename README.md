# GraphEditor

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![CI](https://github.com/GraphRapids/GraphEditor/actions/workflows/ci.yml/badge.svg)](https://github.com/GraphRapids/GraphEditor/actions/workflows/ci.yml)
[![Tests](https://github.com/GraphRapids/GraphEditor/actions/workflows/test.yml/badge.svg)](https://github.com/GraphRapids/GraphEditor/actions/workflows/test.yml)
[![Secret Scan](https://github.com/GraphRapids/GraphEditor/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/GraphRapids/GraphEditor/actions/workflows/gitleaks.yml)

GraphEditor is the web authoring UI in the GraphRapids suite.

It provides a Monaco-based YAML editor and live SVG preview pipeline backed by GraphAPI.

## Features

- Monaco YAML editor with near real-time rendering
- Context-aware YAML autocomplete for graph keys and node types
- JSON Schema validation against GraphAPI schema endpoint
- Debounced and abortable render requests to avoid stale preview updates
- Interactive SVG pan/zoom/fit toolbar via `react-svg-pan-zoom`
- Built-in light/dark mode toggle with SVG color-scheme synchronization
- Download rendered SVG output

## Requirements

- Node.js `>=20`
- npm `>=10`
- GraphAPI running locally (default: `http://127.0.0.1:8000`)

## Installation

```bash
npm install
```

## Quick Start

```bash
# Start GraphAPI first (in its own repository)
# then run GraphEditor
npm run dev
```

Open:

- `http://127.0.0.1:9000`

## Environment Configuration

Vite now reads address/port configuration from environment variables:

```bash
GRAPHEDITOR_HOST=127.0.0.1
GRAPHEDITOR_PORT=9000
GRAPHAPI_HOST=127.0.0.1
GRAPHAPI_PORT=8000
```

You can place these in `.env.local` (recommended) or export them in your shell before running `npm run dev`.

## CLI Reference

GraphEditor is a browser application and does not expose a CLI.

Available npm scripts:

```bash
npm run dev      # local development server (host/port via GRAPHEDITOR_HOST/GRAPHEDITOR_PORT)
npm run test     # vitest + coverage thresholds
npm run build    # production build
npm run preview  # preview built assets
```

## Input Expectations

GraphEditor validates and submits minimal graph input accepted by GraphAPI.

Typical structure:

- `nodes[]`: string or object (`name`, `type`, `id`, nested `nodes`, nested `links`)
- `links[]`: string or object (`id`, `label`, `type`, `from`, `to`)

Schema source:

- `/api/schemas/minimal-input.schema.json` (proxied to GraphAPI)

### YAML Autocomplete

Autocomplete is enabled in the Monaco YAML editor with context-aware suggestions:

- Root keys: `nodes`, `links` (`edges` is accepted as an alias suggestion and inserts `links`)
- Node object keys: `name`, `type`, `id`, `nodes`, `links`
- Link object keys: `from`, `to`, `label`, `type`, `id`
- Node `type` values: predefined GraphLoom node types (for example `router`, `switch`, `firewall`, `cloud`, etc.)

Insertion behavior:

- Key completions insert `key: `
- Collection keys (`nodes`, `links`, `edges`) insert a multiline snippet with indentation (`key:\n  `)
- Selecting `type` triggers follow-up suggestions so node type values pop immediately
- Pressing `Tab` also triggers suggest after indentation is inserted

### Extending Graph Intelligence

GraphEditor now uses layered document analysis and cached metadata for authoring intelligence:

- `YAML syntax layer`: parse with `js-yaml`, surface Monaco markers with line/column, skip render API on syntax error.
- `Schema layer`: validate with AJV against `/api/schemas/minimal-input.schema.json`, map instance paths to YAML markers when possible.
- `Domain layer`: collect node references and endpoint metadata to power `from`/`to` value suggestions.

To extend completions and validation:

1. Update domain key/value registries in `src/AppCore.jsx` (`NODE_KEYS`, `LINK_KEYS`, `STYLE_KEYS`, `STYLE_VALUE_SUGGESTIONS`).
2. Extend key docs in `KEY_DOCUMENTATION` for completion docs + hover help.
3. Add context rules in `getYamlAutocompleteContext` and `getYamlAutocompleteSuggestions`.
4. If schema introduces new enums (for example node types), they are auto-loaded from schema via `extractNodeTypesFromSchema`.

### Render Pipeline Guarantees

- Debounced render dispatch (`170-380ms`, size-aware).
- Client-side YAML parse and schema validation before API requests.
- Abort stale requests via `AbortController`.
- Guard against out-of-order responses with monotonic request IDs.
- Cache successful renders by normalized content hash to avoid repeated network calls.
- Keep last good SVG visible on failures while surfacing clear error messages.

## API Integration

During development, Vite proxies:

- `/api/*` -> `http://${GRAPHAPI_HOST:-127.0.0.1}:${GRAPHAPI_PORT:-8000}/*`

Main endpoints used:

- `GET /api/schemas/minimal-input.schema.json`
- `POST /api/render/svg`

## Troubleshooting

### `Schema load failed`

Confirm GraphAPI is running and reachable at `http://${GRAPHAPI_HOST}:${GRAPHAPI_PORT}`.

### Preview is blank

Check GraphAPI response body and browser console. Ensure the response contains valid `<svg ...>...</svg>` output.

### `Address already in use` on port 9000

Stop the existing process on `${GRAPHEDITOR_HOST}:${GRAPHEDITOR_PORT}` or set different environment variables.

## Development

```bash
npm install
npm run test
npm run build
```

## Project Layout

```text
index.html                    # Vite entry HTML
src/main.jsx                  # React bootstrap
src/App.jsx                   # Application logic
src/App.test.jsx              # App test suite
src/test/setup.js             # Test environment setup
src/styles.css                # UI styling
vite.config.js                # Dev server and /api proxy
.github/workflows/            # CI, tests, release, secret scanning
```

## Governance and Community

- Security policy: `SECURITY.md`
- Contribution guide: `CONTRIBUTING.md`
- Code of conduct: `CODE_OF_CONDUCT.md`
- Changelog: `CHANGELOG.md`
- Release process: `RELEASE.md`

## Automation

- CI build checks: `.github/workflows/ci.yml`
- Test/build matrix: `.github/workflows/test.yml`
- Secret scanning (gitleaks): `.github/workflows/gitleaks.yml`
- Tagged releases: `.github/workflows/release.yml`
- Dependency updates: `.github/dependabot.yml`

## GraphRapids Suite

GraphEditor is part of GraphRapids:

- `GraphLoom`: graph enrichment pipeline
- `GraphRender`: SVG rendering engine
- `GraphAPI`: API service integrating GraphLoom + GraphRender
- `GraphTheme`: shared theming (in progress)

## Third-Party Notices

See `THIRD_PARTY_NOTICES.md` for dependency and license notices.

## License

GraphEditor is licensed under Apache License 2.0. See `LICENSE`.
