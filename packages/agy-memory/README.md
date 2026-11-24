# agy-memory

Memora's native Antigravity (`agy`) plugin for shared Markdown memory in `~/.agents/memory`.

## Install

```bash
npm install && npm run build   # from the memora repo root
agy plugin install /path/to/memora/packages/agy-memory
```

Uses `SessionStart` and `Stop` hooks to rebuild `MEMORY.md` indexes automatically and inject the shared contract plus capped global and project indexes at conversation start, with a bundled `dream` skill for transcript curation.
