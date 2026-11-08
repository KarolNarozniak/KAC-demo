# WAT timetable fixtures

`./timetables/` contains paired source PDFs and extracted text-position JSON
fixtures. Names reflect the printed semester and full academic year. Source PDFs
are retained as provided; JSON fixtures omit the student banner and full instructor
names, while retaining grid abbreviations that delimit room lines.

| Basename (both `.pdf` and `.json`) | Printed semester | Cells | First–last class |
| --- | --- | ---: | --- |
| `wat-plan-lato-2025-2026` | Summer 2025/2026 | 166 | 2026-03-02–2026-07-02 |
| `wat-plan-zima-2025-2026` | Winter 2025/2026 | 212 | 2025-10-01–2026-02-20 |
| `wat-plan-zima-2026-2027` | Winter 2026/2027 | 37 | 2026-10-05–2026-11-26 |

Original upload names, respectively: `Wojskowa Akademia Techniczna, e-Dziekanat.pdf`,
`wat-plan-zima-2025.pdf`, and `wat-plan-lato-2026.pdf`. The last filename was
misleading; the parser correctly reads the printed winter semester.

Actual-PDF tests are mandatory and do not silently skip missing fixtures. JSON
fixtures allow isolated layout tests; PDFs exercise the real worker and upload
preview. Database integration also uses the stored summer PDF without a fallback.

Regression expectations are independent of the parser: all 37 events were
transcribed by date, block, subject and room; winter counts were checked against
the printed two-academic-hour totals per subject/form. Assertions also cover
calendar-year rollover, page continuation, organizational meetings, resit exams,
multiple rooms and DST. These pairs are also the source corpus for the proposed
[OCR implementation](../../../../docs/ocr-implementation-plan.md).
