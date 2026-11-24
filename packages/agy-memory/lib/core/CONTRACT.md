# Shared memory

My long-term memory is in `~/.agents/memory/`. It holds who I am, how I want work done, my projects, and where work stopped. Every agent I use reads and writes this same folder, so what one learns, the next one knows. The indexes are below; note bodies are on disk.

## Read before your first answer

Before you answer, open the notes from the indexes below whose lines touch the question. What they say overrides your defaults.

Notes can go stale. Before you act on a note that names a file, command or setting, check it still holds; if it doesn't, fix the note.

## Save what the next conversation will need

Save when I correct you or confirm an unusual approach, when you learn something about me, when a decision is made that the code and git history don't show, and when we stop with work unfinished. Don't save what the repository already records, what only matters to this conversation, or guesses.

- One fact per file: `global/` if it holds everywhere, the project folder if it holds only there. Look for an existing note first and update it rather than adding a second one.
- Frontmatter: `name` (a short title), `description` (one line, under 150 characters), `type`, and in `global/` a `section` (one of the headings in `global/MEMORY.md`). `type` is one of:
  - `user`: who I am: my role, what I know, what I like.
  - `feedback`: how I want work done: my corrections, and the approaches I confirmed.
  - `project`: work going on: goals, decisions and deadlines the code and git history don't show.
  - `reference`: where to find things: links, dashboards, files outside the repository.
- For `feedback` and `project` notes, follow the fact with a **Why:** line and a **How to apply:** line. Write dates as absolute dates. Write in my language.
- Link related notes: `[[file-name]]` (the file name without `.md`) for a note in the same folder, a relative Markdown link for a note in another folder.
- Where work stopped and the next step go in the project's `NOW.md`. Keep it short and current.
- Never edit any `MEMORY.md` by hand; indexes are rebuilt automatically from note frontmatter.
- Fix an obvious error in any note. Merging, archiving or deleting notes another agent wrote waits for `/dream`, which I run.
- Old notes live in each folder's `archive/`, outside the index. Search them with `rg` when history matters.
