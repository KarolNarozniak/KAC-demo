# Local OCR implementation plan

Status: initial screenshot OCR implemented following the user's request for a simple
first version. The broader plan below remains a roadmap, not a statement of shipped features.

## Implemented first version (2026-10-28)

- Original PNG screenshots renamed and stored under `apps/api/tests/fixtures/ocr`.
- Node worker uses Sharp and Tesseract.js with a bundled English model. This replaces
  the proposed Python/OpenCV service for this increment: the screenshots have straight
  grid lines and abbreviated labels, so an extra runtime and Polish prose model are
  unnecessary. No runtime downloads, external OCR APIs or LLMs.
- Decode PNG/JPEG, enforce byte/pixel/dimension limits, apply EXIF orientation, detect
  the complete 7-day/7-block miniature grid, OCR headers and occupied cells independently.
  Weekly date reconstruction requires a valid Monday anchor and at least 70% matching
  header dates. Unreadable headers reject the image; unreadable subject codes remain
  editable rows. Grid detection never uses fixture names, hashes or paired PDF data.
- Existing `/api/import/classes/read` accepts images and creates the usual preview
  session. One OCR request runs at a time, with a 60-second timeout and cleanup;
  overload returns 429. There is no background queue or persistent OCR job state.
- Web/Android/iOS file pickers accept images. Every OCR row starts unselected;
  warnings explain corrections and absent rooms/forms. Existing server validation,
  duplicate decisions and atomic confirmation apply. No automatic calendar writes.
- The real fixture tests verify all 415 date/start/end assignments and the 37 codes
  in the smallest screenshot. Dense-grid subject codes remain imperfect. Tests also
  exercise malformed images, decoded pixel limits, JPEG/EXIF and concurrency.
- Still deferred: camera capture, perspective/deskew correction, scanned PDFs,
  legend expansion, source-crop previews, cancellable background jobs, automatic
  confidence-based selection and physical-device validation. These are not required
  to try the initial screenshot demo. Build/run instructions are in the root README.


## Scope and architecture

Extend class timetable import to JPEG/PNG photos and image-only PDFs in the same
WAT mini e-D layout. Keep the existing PDF text reader as the first choice. Keep
all recognition on the API host: no LLM, external recognition service or runtime
model download. “Local” means the application server, not the user's phone.
Authentication remains a later task; use the existing server-selected account
scope consistently for jobs, source previews and import sessions.

Recommended stack: TypeScript API orchestration plus an isolated Python worker
using OpenCV for image geometry and the Tesseract CLI with pinned Polish and
English language data for recognition. This adds Python/native deployment
requirements; package them in a reproducible OCR-enabled API container and provide
explicit local setup and readiness checks. Benchmark the worker before locking
resource limits or recognition thresholds. Do not promise photo accuracy based on
PDF renders alone.

Tesseract provides positional recognition output and language selection, but
its documentation calls out table recognition as requiring layout analysis.
Consequently, detect and segment the WAT grid before interpreting the OCR words:
[Tesseract quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html),
[Tesseract CLI](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html).
OpenCV supplies rotation and perspective transforms for photographed pages:
[OpenCV geometry](https://docs.opencv.org/4.x/da/d6e/tutorial_py_geometric_transformations.html).

## Implementation stages and commit boundaries

1. **Corpus and benchmark harness.** Use the three paired PDF/JSON fixtures under
   `apps/api/tests/fixtures/timetables`. Render clean images and image-only PDFs
   at pinned resolutions; generate deterministic rotation, perspective, blur,
   compression, shadow and cropped-header variants. Store expected rows separately
   from OCR results. Include actual phone photos before claiming camera support.
   Measure cell detection, field accuracy, unflagged errors, latency and peak RAM.
2. **Image decoding and isolated worker.** Validate signatures and decoded content,
   apply EXIF orientation, strip unnecessary metadata, normalize contrast and
   correct skew/perspective. Detect the page/table boundary and reject unreadable
   images with actionable feedback. Keep file paths random and private; invoke
   tools with argument arrays and no shell. Use packaged language models.
3. **Grid recognition.** Detect horizontal/vertical boundaries and identify day
   sections, date headers, time blocks and legend columns. OCR small regions with
   appropriate segmentation settings. Produce tokens with bounding boxes and
   raw confidence, then map them to cells. Distinguish empty cells from occupied
   cells whose text failed; missing recognition must not silently drop a class.
4. **Shared timetable interpretation.** Extract common semester/date, class-form,
   legend, multi-room and validation rules from the current reader. Use separate
   geometry adapters for PDF text and OCR; do not feed noisy OCR directly into
   the fixed-coordinate parser. Preserve page provenance, source cell rectangles,
   recognition warnings and unresolved fields. Treat OCR scores as signals, not
   probabilities. Never silently guess a date, year, room or subject expansion.
5. **Background job API.** Add create/status/cancel endpoints for recognition jobs
   with owner scope, progress, queue limits, expiry and explicit failed/cancelled
   states. Return quickly with a job ID; do not extend the existing synchronous
   30-second request timeout indefinitely. Use a bounded local worker queue and
   persist job metadata so restart marks interrupted jobs failed/retryable. Create
   an import preview session only when recognition finishes. Cancellation must
   prevent late worker results from creating a session.
6. **Review UI on web, Android and iOS.** Add image selection and native camera
   capture with permission requested only when used. Support ordering multiple
   photos of a plan, rotation/cropping and job progress/cancellation. Show the source
   cell beside editable fields and highlight uncertainty per field. Uncertain rows
   start unselected and require correction or explicit review. Allow adding a
   missed row and removing a spurious one, with server-managed session row IDs.
   When headers or a legend are absent, request semester/date context or retain
   an explicitly labelled abbreviation; do not expand it from unrelated fixtures.
7. **Save integration and release checks.** Reuse the current validated preview,
   duplicate decisions, atomic confirmation and summaries. Keep existing manual
   event collision behavior intact. Test retry, cancellation, session expiry,
   source cleanup and database rollback. Commit each coherent increment only
   after its relevant checks pass; keep OCR disabled until its acceptance checks
   and readiness checks pass.

## Resource and security controls

Provisional OCR limits: 10 MB per upload, 25 megapixels per decoded page, 10 pages
or photos and 1,000 rows per job; reject excessive total decoded pixels as well.
Start with one worker, a bounded queue, a 512 MB process/container memory ceiling
and a 120-second job deadline. Tune from measurements on an explicitly recorded
reference machine; lower image dimensions if necessary rather than disabling caps.
Check headers before allocating decoded image buffers. Bound OCR output size,
subprocess count, CPU and temporary disk use. Handle malformed/encrypted PDFs,
image decompression bombs and repeated cancellation without leaving children alive.

No user-supplied remote URLs or command fragments. Store source images/crops only
in private temporary storage for review; serve them through owner-scoped endpoints,
never public static URLs. Delete them on cancellation, confirmation, expiry and
restart recovery. Avoid raw OCR content or images in logs. Existing text-only PDF
imports should retain their current fast path, limits and results. PDF rendering
for scans needs its own bounded worker and packaged assets, with no network fetch.

## Acceptance criteria

- Text-PDF regressions still produce exactly 166, 212 and 37 events, respectively.
- On clean raster fixtures, all populated cells are accounted for as a recognized
  row or an explicitly unresolved cell; no silent omission or duplicate creation.
- Proposed clean-image target: at least 98% exact required-field accuracy before
  correction, and no unflagged date/time errors in the labelled acceptance corpus.
  This is a release target to measure, not a claimed current capability.
- Degraded inputs either yield a reviewable preview with uncertainty or a clear
  refusal/request for a better image; uncertain data never auto-saves.
- Cover Roman months, calendar-year rollover, DST, abbreviations, Polish glyphs,
  Ep/SO forms, multi-room entries, page continuation, duplicate photos and cropped
  dates/legends. User corrections still pass server-side semantic validation.
- Exercise the whole path using image-only input (no hidden PDF text fallback),
  plus mocked worker results for deterministic API/UI error tests.
- Test native gallery and camera flows on Android and iOS devices/emulators, not
  merely web viewports or successful JavaScript bundle exports.
- Published latency and memory measurements remain within configured budgets;
  cancellation, timeout and restart clean up processes and temporary artifacts.

## Boundaries

The first release targets the established WAT grid. Handwritten schedules,
arbitrary university/work-schedule layouts and offline on-device OCR remain
separate work. Very small text in a whole-semester phone photo may be irrecoverable;
the UI should recommend a closer crop or the original PDF instead of fabricating
missing entries. Recognition models run locally; Tesseract still uses a trained
OCR model, even though no LLM or cloud AI service is involved.
