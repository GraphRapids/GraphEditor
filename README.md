# GraphEditor

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![CI](https://github.com/GraphRapids/GraphEditor/actions/workflows/ci.yml/badge.svg)](https://github.com/GraphRapids/GraphEditor/actions/workflows/ci.yml)
[![Tests](https://github.com/GraphRapids/GraphEditor/actions/workflows/test.yml/badge.svg)](https://github.com/GraphRapids/GraphEditor/actions/workflows/test.yml)
[![Secret Scan](https://github.com/GraphRapids/GraphEditor/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/GraphRapids/GraphEditor/actions/workflows/gitleaks.yml)

GraphEditor is the web authoring UI in the GraphRapids suite.

It provides a Monaco-based YAML editor and live SVG preview pipeline backed by GraphAPI.

## Features

- Monaco YAML editor with near real-time rendering
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

## CLI Reference

GraphEditor is a browser application and does not expose a CLI.

Available npm scripts:

```bash
npm run dev      # local development server (port 9000)
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

## API Integration

During development, Vite proxies:

- `/api/*` -> `http://127.0.0.1:8000/*`

Main endpoints used:

- `GET /api/schemas/minimal-input.schema.json`
- `POST /api/render/svg`

## Troubleshooting

### `Schema load failed`

Confirm GraphAPI is running and reachable at `http://127.0.0.1:8000`.

### Preview is blank

Check GraphAPI response body and browser console. Ensure the response contains valid `<svg ...>...</svg>` output.

### `Address already in use` on port 9000

Stop the existing process on `127.0.0.1:9000` or adjust `vite.config.js` server port.

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
