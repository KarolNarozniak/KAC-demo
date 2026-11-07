---
id: work-profile
title: Work profile, availability and pay
sidebar_position: 5
---

The work profile in **Settings** stores weekly availability, an hourly PLN rate, gross/net designation, commute time and weekly hour limits. An empty commute field means unconfigured; explicit zero is valid. A zero hourly rate is also valid. Gross and net amounts are never converted into each other.

Availability edits remain local until saved. Cancel restores the saved copy. The editor merges overlaps and asks users to accept exclusions for mandatory recurring classes. The API rejects unnormalized overlaps. End-of-day `24:00` and overnight intervals, including Sunday–Monday, are supported. Replacing the full list is atomic and checks the shared profile version; a failure preserves existing data.

## Both planning workflows are retained

- **Grafik**: master's advanced generator, shift templates, daily limits, calendar preview, confirmation for weeks without classes, and replacement of previously published schedules. API: `/api/v1/schedules` and `/api/v1/scheduling/settings`.
- **Asystent**: the earlier availability planner and access to its saved history. API: `/api/v1/work-profile/schedules`.

Both share availability settings and calendar events. Their proposals have separate lifecycles: accepting or rejecting in one planner does not change the other's proposal records. Shared calendar events still constrain planning. Profile and availability endpoints are `/api/v1/work-profile` and `/api/v1/work-profile/availability`. No unversioned aliases remain.

Commute is an unpaid buffer before and after work and must fit inside availability. Between work shifts the required gap is the larger of commute and rest, without adding them. Event addresses do not affect the fixed MVP buffer. The advanced planner retains master's soft optional-lecture rule, allowing a lecture to be skipped with a warning.

## Pay and history

Each saved shift snapshots its hourly rate, gross/net designation and amount. Calculation uses elapsed minutes between instants, including DST, and integer grosz: `halfUp(rateGrosz * durationMinutes / 60)`. The summary sums individually rounded shift amounts and excludes unpaid commute. It covers shifts in that proposal, not unknown historical rates of other work events. Updating the profile never recalculates saved history. After unsaved time edits, displayed amounts remain the previous snapshot until saved again.

The canonical contract is the [generated API reference](./api/openapi-reference). Source schemas live in `apps/api/src/api/v1/`. For existing databases, `007_work_profile_workflow.sql` and `009_work_profile_workflow_restore.sql` preserve earlier proposal states across master's workflow normalization.
