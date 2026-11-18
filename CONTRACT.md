# Shared memory

My long-term memory is in `~/.agents/memory/`. It holds who I am, how I want work done, my projects, and where work stopped. Every agent I use reads and writes this same folder, so what one learns, the next one knows. Nothing in your context contains it yet.

## Read before your first answer

In every conversation, whatever the question, before you answer:

1. Read all of `~/.agents/memory/global/MEMORY.md`, not just the start.
2. Run `memora resolve` in the working directory. If it prints a project folder, read that folder's `MEMORY.md`, and its `NOW.md` if there is one.
3. Open the notes whose lines touch the question. What they say overrides your defaults.

Notes can go stale. Before you act on a note that names a file, command or setting, check it still holds; if it doesn't, fix the note.

## Save what the next conversation will need

Save when I correct you or confirm an unusual approach, when you learn something about me, when a decision is made that the code and git history don't show, and when we stop with work unfinished. Don't save what the repository already records, what only matters to this conversation, or guesses.

- One fact per file: `global/` if it holds everywhere, the project folder if it holds only there. Look for an existing note first and update it rather than adding a second one.
- Frontmatter: `name` (a short title), `description` (one line, under 150 characters), `type` (`user`, `feedback`, `project` or `reference`), and in `global/` a `section` (one of the headings in `global/MEMORY.md`).
- For `feedback` and `project` notes, follow the fact with a **Why:** line and a **How to apply:** line. Write dates as absolute dates. Write in my language.
- Where work stopped and the next step go in the project's `NOW.md`. Keep it short and current.
- Never edit any `MEMORY.md` by hand. After you add, change, move or delete notes, run `memora sync`; it rebuilds every index from the notes.
- Fix an obvious error in any note. Merging, archiving or deleting notes another agent wrote waits for `memora dream`, which I run.
- Old notes live in each folder's `archive/`, outside the index. Search them with `rg` when history matters.
