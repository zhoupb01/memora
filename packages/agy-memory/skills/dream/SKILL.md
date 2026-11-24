---
name: dream
description: >-
  Curate shared long-term memory across pi, DeepSeek Harness, and Claude Code
  session transcripts. Activate when the user asks to run dream, /dream, or
  curate/clean up shared memory notes.
---

# Dream

Curate `~/.agents/memory` from recent pi, DeepSeek Harness, and Claude Code transcripts using the bundled script [dream-cli.js](../../lib/core/dream-cli.js).

## Steps

1. Resolve the absolute path to `../../lib/core/dream-cli.js` relative to this `SKILL.md` file.
2. Run `node <dream-cli.js>` (passing `--dry-run`, `--since YYYY-MM-DD`, or `--model <id>` when requested by the user). If the sandbox blocks reading `~/.pi`, `~/.dsh`, or `~/.claude` (`EPERM`), re-run that command outside the sandbox.
3. Report the command output clearly. Do not edit memory files directly unless the user asks after reviewing the report.
