# pi-memory

Memora's native `pi` plugin for shared Markdown memory in `~/.agents/memory`.

## Install

```bash
npm install && npm run build   # from the memora repo root
pi install /path/to/memora/packages/pi-memory
```

On every interactive session start, `pi-memory` automatically rebuilds `MEMORY.md` indexes from note frontmatter (initializing `~/.agents/memory/global/MEMORY.md` on first run) and injects the shared contract plus capped global and project indexes (up to 200 lines / 25 KB each). Run `/dream` (`--dry-run`, `--since YYYY-MM-DD`, `--model <id>`) to curate notes from transcripts.
