# Repository Guidelines

## Current State
- This repository is initialized but does not yet contain application source, tests, or build tooling.
- Do not assume a language, framework, package manager, or deployment target until project files are added.

## Working Conventions
- Keep new project setup files focused and conventional for the chosen stack.
- Prefer documenting setup, run, test, and lint commands as soon as they exist.
- Avoid committing generated artifacts, local environment files, dependency folders, or editor-specific files unless the project explicitly requires them.
- This project uses npm workspaces with `apps/web`, `apps/api`, and `packages/shared`.
- Caddy is the only public HTTP(S) entrypoint in production; app services stay on internal HTTP ports.

## Recommended Next Additions
- Add automated tests with the first meaningful source code.
- Update this file when build, test, lint, or formatting commands are introduced.
