# @zhoupb01/dsh-memory

Memora's native DeepSeek Harness plugin for shared Markdown memory in `~/.agents/memory`.

## Install

```bash
dsh plugin --profile desktop add @zhoupb01/dsh-memory
```

Automatically rebuilds `MEMORY.md` indexes from note frontmatter (initializing `~/.agents/memory/global/MEMORY.md` on first run), injects capped global and project indexes without modifying `AGENTS.md`, and registers `/dream [--dry-run] [--since YYYY-MM-DD] [--model <id>]`.
