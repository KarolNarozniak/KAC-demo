# WAT miniature OCR fixtures

Original user screenshots, moved without altering their pixels:

| Original name | Fixture | Occupied cells |
| --- | --- | --- |
| png-test1.png | wat-mini-zima-2026-2027.png | 37 |
| png-test2.png | wat-mini-lato-2025-2026.png | 166 |
| png-test3.png | wat-mini-zima-2025-2026.png | 212 |

These are the compact **Miniatura** browser view. Each occupied cell provides a
subject abbreviation; dates and times are in the grid headers. Rooms and class
forms are absent from individual cells. They must not be inferred from the PDFs.
The screenshots include browser-page account information; do not publish them as
public demo assets. The production reader never accesses this fixture directory.

`tests/ocr.test.ts` runs the actual offline OCR worker on all three original files.
It compares every date/start/end tuple against the corresponding independently
parsed PDF/JSON fixtures in `../timetables`, whose detailed contents already have
regression tests. All 37 subject codes in the first screenshot are checked exactly.
The denser fixtures currently have imperfect subject codes; the tests require at
least 90% nonempty titles, not 90% correct recognition. Every OCR row requires
manual review, including rows with high recognition confidence.

Run from the repository root: `npm run test:api`.
