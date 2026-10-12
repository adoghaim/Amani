# Freemium claim projection browser proofs

Run the opt-in suite with:

```sh
npx playwright test --config e2e/freemium/playwright.config.ts
```

Run this suite, the root Playwright suite, and the env-isolation canary sequentially. The browser configurations share `127.0.0.1:4173`, disable `reuseExistingServer`, and use `--strictPort`; concurrent runs collide and the second server fails instead of selecting another port.

The two synthetic scenarios exercise the authorized Basic preview and suppression when report facts disagree with the issued claim. Both check locked availability. The response fixture deliberately adds unprovenanced summary and explanation prose to the issued preview after server projection, while preserving the measured facts. The agreeing case requires the preview to render and rejects that prose in the body, exercising the client render gate. This suite is opt-in and is not wired into CI; it supplies release evidence only when run manually. The isolated server sets `--freemium` after clearing inherited `VITE_*` variables. See [engineering tooling](../../docs/engineering-tooling/README.md).
