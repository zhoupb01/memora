# Memora maintenance

pi and DSH are peer adapters. Shared memory behavior and model-facing prompts belong in `packages/core`; adapters own only host configuration, lifecycle, and command delivery.

Edit the core sources, then run `npm run build`. The `lib/core` directories inside adapter packages are generated distribution files; make source changes in the core, never in those copies.

Run `npm test` from the repository root. Set `DSH_TEST_RUNTIME` to an installed DSH runtime or its `node_modules` to include real Cordis checks; otherwise those checks explicitly skip. Core behavior must pass through both adapter paths.

Both plugin archives must run independently of the checkout. Build and inspect both packages after changing imports, resources, or package manifests. The repository root is a private workspace, not an adapter installation target.
