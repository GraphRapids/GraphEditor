# GraphEditor
Web-based YAML editor with near real-time SVG preview.

## Run locally

1. Install JS dependencies:
   `npm install`
2. Start Vite dev server:
   `npm run dev`
3. Open:
   `http://127.0.0.1:9000`

The Vite dev server proxies API calls through `/api/*` to `http://127.0.0.1:8000/*`.

## Project structure

- `index.html` - Vite entry HTML
- `src/main.jsx` - React bootstrap
- `src/App.jsx` - GraphEditor app logic
- `src/styles.css` - UI styles
- `vite.config.js` - dev server config and API proxy
- `server.py` - optional lightweight Python static/proxy server (legacy)

## Features

- React single-page UI with split layout:
  - Left: Monaco YAML editor
  - Right: rendered SVG preview
- YAML to JSON conversion + JSON Schema validation via `/schemas/minimal-input.schema.json`
- Debounced + abortable render calls to `/render/svg` using `AbortController`
- Pan/zoom/fit via `react-svg-pan-zoom` toolbar
- SVG download button
