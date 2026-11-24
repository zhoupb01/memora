# Changelog

Release notes for Memora. Native adapter and earlier pi-memory history are retained below.

## [Unreleased]

- Ship Memora v2 as three self-contained host plugins (`packages/pi-memory`, `packages/dsh-memory`, `packages/agy-memory`) sharing one bundled Node core, removing the global `memora` CLI, `AGENTS.md` edits, and Go/Bun runtime requirements.
- Auto-initialize `~/.agents/memory/global/MEMORY.md` and rebuild `MEMORY.md` indexes automatically from note frontmatter on session start; cap injected indexes at 200 lines / 25 KB and keep `NOW.md` bodies out of startup context.
- Remove all `git` dependencies: resolve project slugs directly from `.git` directories and worktree `commondir` files, and back up modified or deleted notes under `.dream/<digest>/backup/` during `/dream`.

## [0.4.0] - 2026-11-18

- **Breaking:** Project folders use repo names, `NOW.md` replaces `open-threads.md`, and `MEMORY.md` indexes are rebuilt from note frontmatter.
- Add a one-off migration for the legacy store.
- Add `dream` curation across pi, DeepSeek Harness, and Claude Code transcripts, with a dry run and a transcript cursor.

## [0.3.0] - 2026-11-18

- **Breaking:** pi and DSH now share `~/.agents/memory` by default. `MEMORA_DIR` replaces `PI_MEMORY_DIR` and `DSH_MEMORY_DIR`; `DSH_HOME` no longer sets the DSH memory default. DSH's explicit `directory` setting still takes priority.
- Document how to move existing memory into the shared root and merge overlapping `MEMORY.md` indexes by hand.
- Allow agents to add or fix shared notes during normal work, and reserve merging, archiving, or deleting another agent's notes for a user-requested `/dream`.

## [0.2.0] - 2026-11-16

- Introduce Memora as one workspace with a shared memory core and peer pi-memory and dsh-memory adapters.
- Move host-independent memory policy, project discovery, index handling and prompt rendering into `packages/core`; both standalone adapter packages include the same core and prompts without an unpublished runtime dependency.
- Loosen the shared save guide, track unfinished work in `open-threads.md`, and ask the model to check what to save before ending each answer without another model request.
- Rename `/tidy` to `/dream` in both adapters and maintain the complete guide and cleanup prompt in the shared core.
- Fix DSH 0.2.2-rc.2 compatibility by replacing the unavailable `agents.roots()` call with live-instance lookup and durable subagent-origin filtering. Runtime tests cover disposed instances replaced under the same ID.
- Fix invalid YAML metadata that caused Pi to skip the `/dream` prompt template, and add a regression check using Pi's actual template loader.
- Add core, cross-adapter, distribution and real Cordis integration tests; document how to enable both hosts' runtime checks.
- Synchronize the workspace, core and both adapters at version `0.2.0` using one workspace lockfile.
- Preserve the existing Markdown memory format and separate default storage roots. Install each adapter from its package directory; the repository root is now a private workspace and is no longer a Pi installation target. Existing pinned `v0.1.0` Pi installations need to switch to the new adapter source.

## [0.1.0] - 2026-11-06

- Markdown memories with a per-folder `MEMORY.md` index shown on every run; the model decides what to save and writes the files itself.
- Hot memory and cold storage in `archive/`, with outdated memories archived and passed dates checked automatically at conversation start.
- `/tidy` to review and clean up memory.
- An English guide that tells the model to write memories in the user's language.
- Memory active only in TUI and RPC mode.
