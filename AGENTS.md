# Memora maintenance

Run `bun test` from the repository root. Tests invoke the CLI and migration script with temporary homes and memory roots. Use `bun add` for dependencies.

`bin/memora.ts` dispatches commands; shared note and index logic lives in `src/`. Keep `CONTRACT.md` verbatim unless the user supplies new wording.

When changing `scripts/migrate-v2.ts`, verify preflight failures leave the fixture unchanged. Run the migration only on fixtures or scratch copies; the manager runs it on the real memory folder after review.
