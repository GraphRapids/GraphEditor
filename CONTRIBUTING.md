# Contributing

Thanks for contributing to GraphEditor.

## Development Setup

```bash
npm install
```

Run GraphAPI separately (default: `http://127.0.0.1:8000`) before using the local UI.

Start GraphEditor:

```bash
npm run dev
```

## Running Checks

Build production bundle:

```bash
npm run build
```

Optional legacy Python server check:

```bash
source .venv/bin/activate
python -m py_compile server.py
```

## Project Structure

- `src/App.jsx`: main UI and API integration logic
- `src/main.jsx`: app bootstrap
- `src/styles.css`: visual styles and theme variables
- `vite.config.js`: dev server and API proxy configuration
- `server.py`: optional Python static/proxy server
- `.github/workflows/`: CI, tests, release, and secret scanning

## Pull Requests

Before opening a PR:

1. Keep changes focused and atomic.
2. Add or update tests where practical for behavior changes.
3. Update docs (`README.md`, `CHANGELOG.md`, `THIRD_PARTY_NOTICES.md`) when relevant.
4. Ensure workflows are green (`CI`, `Tests`, `Secret Scan`).

## Commit Guidance

- Use clear, imperative commit messages.
- Prefer conventional prefixes (`feat`, `fix`, `docs`, `test`, `chore`).
- Reference issue numbers when applicable.
- Avoid bundling unrelated changes in one PR.

## Reporting Bugs and Requesting Features

Use GitHub issues for bug reports and feature requests.

For security issues, follow `SECURITY.md`.
