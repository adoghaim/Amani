# Extraction browser coverage

`confirm-markers.spec.ts` uploads the synthetic Quest PDF from the 2026-10-17 smoke test through PDF.js and the real local parser. It checks all 12 values, display names in the confirmation step, and Vitamin D at 24 in the preview. It stops before saving. The shared network guard rejects unexpected requests, including AI refinement and writes; account and catalog reads use synthetic responses only.

Run `npm run test:e2e -- e2e/extraction/confirm-markers.spec.ts` for Chromium, WebKit and Firefox. Each run attaches a full-page confirmation screenshot. The spec is included in the normal CI browser gate.

OCR, extraction failures and editing remain future coverage.
