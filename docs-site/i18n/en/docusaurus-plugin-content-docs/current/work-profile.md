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
| `maximum_hours` | saved + proposed shifts in the week > `maximumHours` | `maximumMinutes`, `totalMinutes` |
| `daily_maximum_hours` | work on a single day > `maxHoursPerDay` | `date`, `maximumMinutes`, `totalMinutes` |
| `existing_work_exceeds_maximum` | already saved shifts alone exceed `maximumHours` | `maximumMinutes`, `existingWorkMinutes` |

All `details` values are in minutes.

### Rest between shifts

`minimumRestMinutes` is the minimum gap between two work shifts. Between shifts the required gap is `max(commuteBufferMinutes, minimumRestMinutes)` – the values are not added. Before and after classes only `commuteBufferMinutes` applies. The value can be overridden for a single proposal with `overrides.minimumRestMinutes`.

| Code | When | `details` |
|---|---|---|
| `shift_overlap_or_rest` | two proposed shifts overlap or the gap between them is too short | empty; shifts in `candidateIds` |
| `commute_gap_too_short` | the gap between a shift and a neighbouring event is too short | `requiredMinutes`, `actualMinutes`, `leftId`, `rightId`, `leftTitle`, `rightTitle` |

## Blocks and compatibility

The **Blokady** tab retains vacations, exam sessions and days off through `/api/v1/blocks`. Reads/deletions are owner-scoped. The API requires ISO instants with offsets; the form converts local input to UTC. Calendar blocks are not copied into editable profile blocks. Creating/deleting blocks locks calendars to serialize against acceptance. Migration `010_calendar_blocks.sql` owns the table definition.

Retired `/api/v1/work-profile/compensation` and `/api/v1/work-profile/schedules...` addresses return **410 workflow_consolidated** with a successor. They neither run another engine nor write data. History by ID remains at `/api/v1/schedules/id/{id}`. There are no unversioned aliases.

The canonical contract is the [generated API reference](./api/openapi-reference), built from Fastify schemas in `apps/api/src/api/v1/` and `apps/api/openapi/openapi.json`.
