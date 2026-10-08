# Freemium claim projection browser proofs

Run the opt-in suite with:

```sh
npx playwright test --config e2e/freemium/playwright.config.ts
```

Run this suite, the root Playwright suite, and the env-isolation canary sequentially. The browser configurations share `127.0.0.1:4173`, disable `reuseExistingServer`, and use `--strictPort`; concurrent runs collide and the second server fails instead of selecting another port.

The two synthetic scenarios exercise the authorized Basic preview and suppression when report facts disagree with the issued claim. Both check locked availability and reject the unprovenanced prose canary. The isolated server sets `--freemium` after clearing inherited `VITE_*` variables. See [engineering tooling](../../docs/engineering-tooling/README.md).
