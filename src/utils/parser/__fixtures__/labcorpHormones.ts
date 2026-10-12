// Fabricated LabCorp-style hormone panel. Not real patient data.
//
// Every interval below is an arbitrary placeholder, chosen only to be distinct
// per marker so that an interval bound to the wrong marker is detectable. They
// are NOT clinical reference ranges: never copy them into the catalog, the
// scoring tables or any user-facing copy.
//
// Exercises PK-FIX-05 (bind each printed interval to its own marker), in the
// LabCorp layout ("Ref. Interval" column, en-dash intervals):
//   1. Estradiol and FSH print an "Adult Female:" heading, then one cycle-phase
//      interval per line: captured with labels, none bound, row needs review.
//   2. Progesterone prints its first phase interval on the result row itself
//      and the others below it: the old parser bound that first one silently.
//   3. DHEA-Sulfate prints a single, population-labelled interval under its row:
//      exactly one interval, so it is bound as before.
//   4. Prolactin and Testosterone print their own interval on their own row.
//   5. SHBG prints no interval; the next row, Estrone, is an analyte the parser
//      does not recognise, so it sits inside SHBG's lookahead window: its
//      33 – 333 must never become SHBG's interval, nor its 88 SHBG's result.

export const labcorpHormoneFixture = `
LabCorp
Laboratory Corporation of America
Accession Number: 0000000917
Laboratory Director: Dr. Synthetic

Test                          Result    Units     Ref. Interval
Estradiol                     145       pg/mL
    Adult Female:
    Follicular phase          21.1 – 121.1
    Ovulation phase           61.1 – 361.1
    Luteal phase              51.1 – 251.1
    Postmenopausal            <31.1
Progesterone                  8.2       ng/mL     Follicular phase 0.1 – 1.1
    Luteal phase              2.2 – 22.2
    Ovulation phase           0.2 – 12.2
FSH                           6.1       mIU/mL
    Adult Female:
    Follicular phase          2.5 – 10.5
    Ovulation phase           3.5 – 20.5
    Luteal phase              1.5 – 9.5
    Postmenopausal            25.5 – 135.5
DHEA-Sulfate                  210       ug/dL
    Adult Female:             111.1 – 333.3
Prolactin                     11.4      ng/mL     4.4 – 44.4
SHBG                          62        nmol/L
Estrone                       88        pg/mL     33 – 333
Testosterone, Total           31        ng/dL     3 – 41
`;
