---
id: notifications
title: Work reminders
sidebar_label: Reminders
description: Work reminder settings, scheduling, delivery and navigation.
---

# Work reminders

## Settings

Notification settings let users enable or disable reminders and set a positive lead time from 1 to 1440 minutes. Edits remain a draft until “Save settings” is selected; “Cancel edit” restores the last saved values. Enabling reminders requires browser permission. The UI shows permission state and the number of scheduled reminders; zero means there are currently no upcoming approved shifts.

Saving or changing settings atomically cancels prior pending reminders and schedules replacements for existing approved events in the “Work” category. Later event creation, approval, rescheduling or deletion is handled through the outbox. Changing reminder preferences never changes the work schedule.

## Delivery and navigation

A reminder includes the title and the current shift date, start time and end time in the user's time zone. If the reminder time has passed but the shift has not started, the reminder becomes due immediately. Reminders are not scheduled for shifts that have already started.

The API claims a due reminder with a two-minute lease. The browser acknowledges it only after creating a system notification; an unacknowledged lease expires and is retried. Delivery is not a read receipt. Clicking the notification opens the week view and the shift details. If the shift was deleted, the app reports that and opens the calendar.

Web Push is optional and requires VAPID. The user registers a subscription for the current scope; the public key is exposed to the browser while the private key remains in API worker configuration. The API accepts push-service hosts used by Chrome, Firefox, Safari and Windows, not arbitrary HTTPS endpoints. The worker sends due reminders to subscriptions, retries transient failures and removes expired endpoints. If VAPID is not configured, the client still polls the API and shows system notifications while the app is running and permission is granted; closed-app delivery is not guaranteed.

Generate a key pair once:

```powershell
npx web-push generate-vapid-keys
```

Set `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` and `WEB_PUSH_VAPID_SUBJECT` in API/worker configuration. The private key is a secret and must never be set in the frontend.

## API

- `GET /api/v1/notifications/settings` returns saved preferences and the pending reminder count.
- `PUT /api/v1/notifications/settings` saves enablement and lead time, then reschedules pending reminders.
- `GET /api/v1/notifications/due` atomically claims due reminders for a limited time.
- `POST /api/v1/notifications/{id}/ack` marks a reminder as displayed after client acknowledgement; it does not mark it as read.
- `GET /api/v1/notifications/push-config` returns configuration state and only the public VAPID key.
- `POST /api/v1/notifications/subscriptions` stores a subscription for the current scope; `DELETE` removes only that scope's subscription.
