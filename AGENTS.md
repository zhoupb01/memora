# Memora maintenance

Run `npm test` from the repository root. It bundles `packages/core` (with `CONTRACT.md` and `DREAM.md`) into the three peer host plugins (`packages/pi-memory`, `packages/dsh-memory`, `packages/agy-memory`), validates `packages/agy-memory` with `agy plugin validate --strict` when `agy` is installed, and runs all unit, adapter parity, dream, and migration tests against temporary directories.

Keep `CONTRACT.md` and `DREAM.md` verbatim unless the user supplies new wording.

When changing `scripts/migrate-v2.mjs`, verify preflight failures leave the fixture unchanged. Run the migration only on fixtures or scratch copies; the manager runs it on the real memory folder after review.
