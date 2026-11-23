# Memora maintenance

Run `go test ./...` from the repository root. Tests invoke the compiled CLI and migration command against temporary homes and memory roots. Use `go get` for dependencies.

`cmd/memora` dispatches to the root `memora` package, which embeds `CONTRACT.md` and `DREAM.md` at build time. Keep `CONTRACT.md` verbatim unless the user supplies new wording.

When changing `cmd/migrate-v2`, verify preflight failures leave the fixture unchanged. Run the migration only on fixtures or scratch copies; the manager runs it on the real memory folder after review.
