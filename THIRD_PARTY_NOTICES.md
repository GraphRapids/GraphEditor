# Third-Party Notices

Last verified: 2026-02-22

GraphEditor is licensed under Apache-2.0. This file documents third-party software and tools used by the project.

## Runtime dependencies

| Component | How GraphEditor uses it | License | Source |
| --- | --- | --- | --- |
| `react` | UI runtime | MIT | https://github.com/facebook/react |
| `react-dom` | Browser rendering | MIT | https://github.com/facebook/react |
| `@monaco-editor/react` | Monaco editor integration | MIT | https://github.com/suren-atoyan/monaco-react |
| `monaco-editor` | YAML editing component foundation | MIT | https://github.com/microsoft/monaco-editor |
| `js-yaml` | YAML parsing and serialization | MIT | https://github.com/nodeca/js-yaml |
| `ajv` | JSON Schema validation | MIT | https://github.com/ajv-validator/ajv |
| `react-svg-pan-zoom` | Interactive SVG preview navigation | ISC | https://github.com/chrvadala/react-svg-pan-zoom |

## Build and development tooling (not redistributed)

| Component | How GraphEditor uses it | License | Source |
| --- | --- | --- | --- |
| `vite` | Dev server and production build pipeline | MIT | https://github.com/vitejs/vite |
| Node.js / npm | JavaScript runtime and package management | Mixed (Node.js project licensing) | https://nodejs.org/ |

## Services and integrations

| Component | How GraphEditor uses it | License/Terms | Source |
| --- | --- | --- | --- |
| GraphAPI | Schema and SVG rendering backend (`/api/*`) | Project-specific | https://github.com/GraphRapids/GraphAPI |

## Downstream obligations

- Verify transitive dependency license obligations before redistribution.
- Keep this file updated when runtime dependencies, build tooling, or service integrations change.

## Verification sources used for this update

- Local project files:
  - `package.json`
  - `README.md`
  - `src/App.jsx`
  - `vite.config.js`
- Upstream repositories and package metadata linked above.
