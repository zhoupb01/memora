# Changelog

Release notes for Memora and its native adapters. Earlier pi-memory history is retained below.

## [Unreleased]

- Loosen the shared save guide, track unfinished work in `open-threads.md`, ask the model to check what to save before ending each answer without another model request, and rename `/tidy` to `/dream` in both adapters.

- Fix dsh-memory turns and `/tidy` failing on DSH 0.2.2-rc.2: replace the unavailable `agents.roots()` call with live-instance lookup and durable subagent-origin filtering. Runtime tests now use the real host agent registry and cover disposed instances replaced under the same ID.

- Introduce Memora as a neutral workspace with peer pi-memory and dsh-memory adapters.
- Extract host-independent memory policy, project discovery, index handling and prompt rendering into `packages/core`.
- Preserve the complete original guide and `/tidy` prompt as the core's single source of truth.
- Build the same core into both standalone plugin packages, with no runtime dependency on an unpublished core package.
- Add core, cross-adapter, distribution and real Cordis integration tests.
- Use one workspace lockfile and synchronized versions for repository releases.

## [0.1.0] - 2026-11-06

- Markdown memories with a per-folder `MEMORY.md` index shown on every run; the model decides what to save and writes the files itself.
- Hot memory and cold storage in `archive/`, with outdated memories archived and passed dates checked automatically at conversation start.
- `/tidy` to review and clean up memory.
- An English guide that tells the model to write memories in the user's language.
- Memory active only in TUI and RPC mode.
