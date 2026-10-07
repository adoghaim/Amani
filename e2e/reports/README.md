# reports

Implemented: `context-suppression.spec.ts` (V2-03, TASK-044) renders the real report page
from synthetic rows (`synthetic-reports.ts`) behind the network guard and proves, on all
three browsers, that the laboratory range and Amani context band are separate, that no
unreviewed band reads as "Optimal", and that a cycle-dependent hormone with no recorded
phase gets no Amani score while its raw value and lab range stay visible. A second fixture
with a recorded luteal phase proves the phase-specific path.

Still planned: synthetic report upload, list/detail navigation, and deletion against an
isolated disposable backend.

Use synthetic data only; no production credentials, PHI, destructive production requests, or
arbitrary sleeps. Extend the test selection deliberately when adding a suite. See
[engineering tooling](../../docs/engineering-tooling/README.md).
