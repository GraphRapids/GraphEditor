# AGENTS.md

## Scope
- Work only in this repository (`GraphEditor`).
- Keep changes focused on the user request.

## Environment
- Use the project virtualenv for all Python commands: `.venv`.
- Run commands from repository root unless a task requires a subdirectory.
- Verify context before changes:
  - `pwd`
  - `which python`

## Tech Stack
- Web framework: React.js.
- Frontend uses Vite + React with source under `src/`.
- Main entry files:
  - `index.html`
  - `src/main.jsx`
  - `src/App.jsx`
  - `src/styles.css`
- YAML editor: Monaco via `@monaco-editor/react` (`defaultLanguage="yaml"`).
- SVG preview: `react-svg-pan-zoom` (`UncontrolledReactSVGPanZoom`).

## API 
Use the API described in http://127.0.0.1:8000/openapi.json
- App calls API through local proxy path `/api/*` (not direct `:8000` from browser code).

## Local Run Instructions
- Install JS dependencies: `npm install`
- Run dev server from repository root: `npm run dev`
- The web UI is served at `http://127.0.0.1:9000`.
- Vite proxies `/api/*` to `http://127.0.0.1:8000/*`.
- Use `.venv` for Python-only tasks (e.g. `server.py` if explicitly needed).

## Current UI Behavior
- Layout: left pane (editor) is ~1/4 width, right pane (preview) is ~3/4 width on desktop.
- Preview controls policy: use `react-svg-pan-zoom` toolbar (`toolbarProps`) for pan/zoom/fit interactions.
- Keep header buttons limited to:
  - `Download SVG`
  - theme toggle (`Dark Mode` / `Light Mode`)
- Dark/light mode:
  - App theme is controlled with `data-theme` on document root.
  - Rendered SVG color-scheme is patched from app theme before preview rendering.
- Preview rendering:
  - API SVG is displayed inside pan/zoom viewer via blob URL image.
  - Preserve viewer zoom/pan state across rerenders (avoid remount-reset behavior).

## Public Repo Consistency
- Keep governance files aligned with other GraphRapids repositories:
  - `CHANGELOG.md`
  - `CODE_OF_CONDUCT.md`
  - `CONTRIBUTING.md`
  - `RELEASE.md`
  - `SECURITY.md`
  - `THIRD_PARTY_NOTICES.md`
- Keep workflow naming consistent:
  - `.github/workflows/ci.yml`
  - `.github/workflows/test.yml`
  - `.github/workflows/gitleaks.yml`
  - `.github/workflows/release.yml`

## Coding Rules
- Prefer small, reviewable changes.
- Avoid adding dependencies unless necessary.
- Preserve existing project structure and conventions.
- Update tests and README when behavior or functionality changes.

## Git Workflow
- Never use destructive git commands.
- Do not commit or push unless explicitly requested.
- When asked to commit, stage only intended files and use a clear message.

## Security
- Never hardcode secrets or tokens.
- Prefer environment variables for runtime configuration.
