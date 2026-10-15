// Fabricated Quest Diagnostics-style hormone panel. Not real patient data.
//
// Every interval below is an arbitrary placeholder, chosen only to be distinct
// per marker so that an interval bound to the wrong marker is detectable. They
// are NOT clinical reference ranges: never copy them into the catalog, the
// scoring tables or any user-facing copy.
//
// Exercises PK-FIX-05 (bind each printed interval to its own marker):
//   1. FSH, LH, ESTRADIOL and PROGESTERONE print a "Reference Range:" heading
//      followed by one cycle-phase interval per line. None may be bound
//      silently (the old parser took the first, Follicular); every one is
//      captured with its label and the row needs review.
//   2. PROLACTIN, TESTOSTERONE and TSH print their own interval on their own
//      row and keep binding it exactly as before.
//   3. SHBG prints no interval. The next row, ANDROSTENEDIONE, is an analyte the
//      parser does not recognise, so it sits inside SHBG's lookahead window:
//      its 33-333 must never become SHBG's interval, nor its 88 SHBG's result.

export const questHormoneFixture = `
Quest Diagnostics
Specimen ID: QD00000917
Reporting Physician: Dr. Synthetic

Test Name                         Result      Units       Reference Range
FSH                               6.1         mIU/mL
    Reference Range:
    Follicular Phase              2.1-11.1
    Mid-Cycle Peak                5.2-22.2
    Luteal Phase                  1.3-8.8
    Postmenopausal                22.2-133.3
LH                                5.6         mIU/mL
    Reference Range:
    Follicular Phase              1.6-11.6
    Mid-Cycle Peak                6.6-66.6
    Luteal Phase                  0.6-12.6
    Postmenopausal                12.6-56.6
ESTRADIOL                         145         pg/mL
    Reference Range:
    Follicular Phase              21-121
    Mid-Cycle Phase               61-361
    Luteal Phase                  51-251
    Postmenopausal                <=31
PROGESTERONE                      8.2         ng/mL
    Reference Range:
    Follicular Phase              <=1.1
    Luteal Phase                  2.2-22.2
    Postmenopausal                <=0.4
PROLACTIN                         11.4        ng/mL       3.3-33.3
SHBG                              62          nmol/L
ANDROSTENEDIONE                   88          ng/dL       33-333
TESTOSTERONE, TOTAL, MS           31          ng/dL       2-45
TSH                               1.9         mIU/L       0.44-4.44
`;
