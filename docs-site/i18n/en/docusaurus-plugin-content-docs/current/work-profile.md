---
id: work-profile
title: Work profile, availability and pay
sidebar_position: 5
---

## One form and one planner

The **Grafik** tab preserves the form and planning workflow introduced on master: flexible/template modes, weekly minimum and maximum, weekly/monthly targets, commute, rest, shift duration, daily limits, availability and shift templates. The PLN hourly rate and gross/net designation extend the same form. Save, cancel, version conflicts and the unsaved-change warning cover the entire draft.

The complete profile uses `GET/PUT /api/v1/work-profile`. Older clients omitting the financial fields preserve the saved rate and designation. `null` means unconfigured; zero is a valid rate. Gross and net are not converted. An old profile with a rate but no designation remains editable, while new generation requires choosing gross/net.

`targetPeriod: month` preserves the entered monthly target. Generation uses its weekly equivalent (a month is 52/12 weeks). Updating the rate does not change the target period.

## Availability belongs to the draft

Users can add/remove intervals and copy a day to selected days. Hours save only with the profile. The editor merges overlaps before sending; the API rejects unnormalized overlaps. Overnight intervals split at midnight, including Sunday–Monday, preserving `24:00`.

The editor shows saved and draft weekly hours and warns when saved availability falls below the target. Mandatory-class information comes from the existing planner's selected-week context; excluding those hours from the recurring pattern requires explicit acceptance. Generation always applies that week's classes independently of the pattern. Saving availability does not change calendar events.

The separate `GET/PUT /api/v1/work-profile/availability` resource uses **the same repository**. Replacement is atomic, checks ownership/version and accepts an empty list to clear availability. Its integer `version` remains a compatibility token; the full form uses `profileVersion`. Both advance when the same profile changes.

## Planning and pay

Generation and edits retain daily/weekly limits, templates, existing work, blocks and classes. Optional lectures retain the soft rule allowing a skip with a warning. Commute must fit inside availability; between work shifts the gap is `max(commute, rest)`, without addition. The buffer is unpaid and independent of addresses or mapping services.

Each saved shift snapshots its rate, gross/net designation and amount. Calculation uses elapsed minutes between instants, including DST, and integer grosz: `halfUp(rateGrosz * durationMinutes / 60)`. The summary sums individually rounded proposal shifts. It does not guess pay for other events lacking historical rates. After edits, displayed amounts remain the last snapshot until saved. Acceptance revalidates constraints inside the transaction.

**Historia wybranego tygodnia** lists saved schedules, including records from the earlier implementation. History is read-only and never recalculates amounts using the current rate. New proposals use only `/api/v1/schedules`. Previous records and calendar events remain in the database.

### Hour limits

The work profile has two limits: `maximumHours` (weekly) and `maxHoursPerDay` (daily). The generator never exceeds them when proposing shifts, and a manual schedule edit or approval that violates them is rejected with 422 `invalid_schedule`:

| Code | When | `details` |
|---|---|---|
| `maximum_hours` | saved + proposed shifts in the week > `maximumHours` | `period`, `periodRule`, `periodStartLocal`, `periodEndLocal`, `maximumMinutes`, `totalMinutes`, `existingWorkMinutes`, `proposedMinutes`, `exceededByMinutes` |
| `daily_maximum_hours` | work on a single day > `maxHoursPerDay` | `period` (`day`), `date`, `maximumMinutes`, `totalMinutes`, `exceededByMinutes` |
| `existing_work_exceeds_maximum` | already saved shifts alone exceed `maximumHours` | same as `maximum_hours`, with `proposedMinutes = 0` |

All `details` values are in minutes.

#### Accounting period and warning (S23KC2S1P2-301)

- **The weekly period** runs from Monday 00:00 to the following Monday 00:00 in the profile time zone (`periodStartLocal`, `periodEndLocal`).
- **Boundary rule** (`periodRule: shift_start`): a shift belongs entirely to the week in which it starts. This applies to new and already saved shifts, so a Sunday-to-Monday night shift is not counted again in the following week.
- **The daily limit** counts each calendar day separately – a night shift is split at midnight.
- **The comparison is strict**: a total equal to the limit is allowed; the warning appears only above it. Minutes are real elapsed time between instants, including the DST week.
- A previously approved schedule of the same week that is being replaced is not added to “existing work”.

In **Plan pracy** an excess is shown in a separate panel with the limit, the total and the excess (weekly and per day). **Rozumiem** only collapses the warning – it does not bypass the limit, and approval stays blocked. Any change of the totals invalidates the acknowledgement. This warning is about the maximum; exceeding the hour **target** (the “Praca w tym tygodniu względem celu” bar) is allowed.

Open decisions: whether an acknowledged warning may allow saving above the limit (“soft override”) and whether a monthly limit is needed. Until decided, the limit is hard and the period is a week.

### Rest between shifts

`minimumRestMinutes` is the minimum gap between two work shifts. Between shifts the required gap is `max(commuteBufferMinutes, minimumRestMinutes)` – the values are not added. Before and after classes only `commuteBufferMinutes` applies. The value can be overridden for a single proposal with `overrides.minimumRestMinutes`.

| Code | When | `details` |
|---|---|---|
| `shift_overlap_or_rest` | two proposed shifts overlap or the gap between them is too short | `kind` (`overlap`/`rest`), `gapMinutes`, `requiredMinutes`, `shifts` (both ranges); shifts also in `candidateIds` |
| `commute_gap_too_short` | the gap between a shift and a neighbouring event is too short | `requiredMinutes`, `actualMinutes`, `leftId`, `rightId`, `leftTitle`, `rightTitle` |

### Collisions with other events (S23KC2S1P2-302)

`hard_conflict` lists **all** events and blocks a shift collides with (previously only the first ID). `details.conflicts` holds `id`, `title`, the real `startLocal`/`endLocal`, `bufferMinutes` and the shared part `overlapStartLocal`/`overlapEndLocal` for every item. The `optional_lecture_conflict` warning carries the same details. A collision with mandatory classes still uses the separate `class_collision` code.

## Blocks and compatibility

The **Blokady** tab retains vacations, exam sessions and days off through `/api/v1/blocks`. Reads/deletions are owner-scoped. The API requires ISO instants with offsets; the form converts local input to UTC. Calendar blocks are not copied into editable profile blocks. Creating/deleting blocks locks calendars to serialize against acceptance. Migration `010_calendar_blocks.sql` owns the table definition.

Retired `/api/v1/work-profile/compensation` and `/api/v1/work-profile/schedules...` addresses return **410 workflow_consolidated** with a successor. They neither run another engine nor write data. History by ID remains at `/api/v1/schedules/id/{id}`. There are no unversioned aliases.

The canonical contract is the [generated API reference](./api/openapi-reference), built from Fastify schemas in `apps/api/src/api/v1/` and `apps/api/openapi/openapi.json`.
