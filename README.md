# GraphEditor
Web-based YAML editor with near real-time SVG preview.

## Run locally

1. Activate virtualenv:
   `source .venv/bin/activate`
2. Confirm python path:
   `which python`
3. Start the dev server:
   `python server.py`
4. Open:
   `http://127.0.0.1:9000`

The page proxies API calls through `/api/*` to `http://127.0.0.1:8000/*`.

## Features

- React single-page UI with split layout:
  - Left: YAML editor
  - Right: rendered SVG preview
- YAML to JSON conversion + JSON Schema validation via `/schemas/minimal-input.schema.json`
- Debounced + abortable render calls to `/render/svg` using `AbortController`
- Zoom controls (in, out, reset)
- SVG download button
