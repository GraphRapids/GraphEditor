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

## API 
Use the API described in http://127.0.0.1:8000/openapi.json

## Local Run Instructions
- Use `.venv` for Python commands.
- Run the local web server from repository root:
  - `source .venv/bin/activate`
  - `python server.py`
- The web UI is served at `http://127.0.0.1:9000`.
- The server proxies `/api/*` to `http://127.0.0.1:8000/*`.

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
