# WAT timetable fixtures

These JSON fixtures retain the PDF text runs and coordinates used by the local
reader. They omit the student banner and full instructor names; grid instructor
abbreviations remain because they delimit the room lines. Source PDFs remain
local, untracked files. The tests also process each actual PDF when present.

| Fixture | Printed semester | Populated cells | First–last class |
| --- | --- | ---: | --- |
| `wat-grid.json` | Summer 2025/2026 | 166 | 2026-03-02–2026-07-02 |
| `wat-plan-zima-2025.json` | Winter 2025/2026 | 212 | 2025-10-01–2026-02-20 |
| `wat-plan-lato-2026.json` | **Winter 2026/2027** | 37 | 2026-10-05–2026-11-26 |

The last filename does not match its printed semester. The parser uses document
content, never the filename or export timestamp, to assign calendar years.

Regression expectations are independent of the parser: the 37-event grid was
transcribed by date, block, subject and room; winter counts were checked against
the printed two-academic-hour totals per subject/form. Additional assertions
cover the December/January year boundary, page continuation, organizational
meetings, resit exams and the two rooms listed in the UNIX resit cells.
