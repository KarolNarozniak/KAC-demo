import type { FunctionTool } from 'openai/resources/responses/responses.js';
import type { UserScope } from '../api/scope.js';
import type { CalendarRepository } from '../api/contracts.js';
import type { WorkProfileRepository } from '../profile/repository.js';
import { AiRepository } from './repository.js';
import { previewCollisions, type PreviewCollision } from './event-preview.js';
import { EventValidationError } from '../collisions.js';
import { addDays, freeWindowsInRange, isValidDate, isValidTime, localMidnight, occurrencesInRange, totalsInRange } from './calendar-facts.js';

const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object', additionalProperties: false, properties, required,
});
const eventProperties = {
  title: { type: 'string', minLength: 1, maxLength: 200 },
  start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
  end: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
  category: { type: 'string', enum: ['Class', 'Work', 'Personal'] },
  location: { type: 'string', maxLength: 500 }, mandatory: { type: 'boolean' }, repeatWeekly: { type: 'boolean' },
};

export const assistantTools: FunctionTool[] = [
  { type: 'function', name: 'calendar_search_events', strict: true,
    description: 'Search the current user calendar in a bounded date range. Read-only.',
    parameters: objectSchema({ from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' }, query: { type: ['string', 'null'], maxLength: 120 } }, ['from', 'to', 'query']) },
  // S23KC2S1P2-270: wolne okna i sumy liczy backend na rozwiniętych seriach, model tylko je opisuje.
  { type: 'function', name: 'calendar_free_windows', strict: true,
    description: 'Find calendar gaps (no event at all) between dayStart and dayEnd on each day from..to (max 14 days). Read-only. Free time is not work availability.',
    parameters: objectSchema({ from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      dayStart: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, dayEnd: { type: 'string', pattern: '^(([01]\\d|2[0-3]):[0-5]\\d|24:00)$' },
      minMinutes: { type: 'integer', minimum: 5, maximum: 720 } }, ['from', 'to', 'dayStart', 'dayEnd', 'minMinutes']) },
  { type: 'function', name: 'calendar_time_totals', strict: true,
    description: 'Sum event minutes per category (Class, Work, Personal) and total busy minutes for days from..to inclusive (max 93 days), with weekly series and overnight events. Read-only.',
    parameters: objectSchema({ from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, ['from', 'to']) },
  { type: 'function', name: 'work_profile_get', strict: true,
    description: 'Read the current user work profile and planning availability. Read-only.',
    parameters: objectSchema({}, []) },
  { type: 'function', name: 'calendar_prepare_event_create', strict: true,
    description: 'Create a pending event proposal. This does not change the calendar; the user must confirm it separately.',
    parameters: objectSchema(eventProperties, ['title', 'start', 'end', 'category', 'location', 'mandatory', 'repeatWeekly']) },
  { type: 'function', name: 'calendar_prepare_event_update', strict: true,
    description: 'Prepare a complete event replacement proposal. This does not update the calendar; the user must confirm it separately.',
    parameters: objectSchema({ id: { type: 'string', minLength: 1, maxLength: 200 }, ...eventProperties }, ['id', 'title', 'start', 'end', 'category', 'location', 'mandatory', 'repeatWeekly']) },
  { type: 'function', name: 'calendar_prepare_event_delete', strict: true,
    description: 'Prepare an event deletion proposal. This does not delete the event; the user must confirm it separately.',
    parameters: objectSchema({ id: { type: 'string', minLength: 1, maxLength: 200 } }, ['id']) },
];

export type AssistantToolContext = {
  scope: UserScope;
  conversationId: string;
  calendar: CalendarRepository;
  workProfile?: WorkProfileRepository;
  ai: Pick<AiRepository, 'createAction'> & Partial<Pick<AiRepository, 'cancelPendingActionsOfKind'>>;
  actionTtlMinutes: number;
};

const onlyKeys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));
const isLocalDateTime = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value) &&
  Number.isFinite(Date.parse(`${value}:00Z`)) && new Date(`${value}:00Z`).toISOString().slice(0, 16) === value;
const validEventArguments = (value: Record<string, unknown>, includeId: boolean) => {
  const allowed = includeId ? ['id', 'title', 'start', 'end', 'category', 'location', 'mandatory', 'repeatWeekly'] : ['title', 'start', 'end', 'category', 'location', 'mandatory', 'repeatWeekly'];
  return onlyKeys(value, allowed) &&
    (!includeId || typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200) &&
    typeof value.title === 'string' && value.title.trim().length > 0 && value.title.length <= 200 &&
    isLocalDateTime(value.start) && isLocalDateTime(value.end) && String(value.end) > String(value.start) &&
    ['Class', 'Work', 'Personal'].includes(String(value.category)) &&
    typeof value.location === 'string' && value.location.length <= 500 &&
    typeof value.mandatory === 'boolean' && typeof value.repeatWeekly === 'boolean';
};

const eventSnapshot = (event: { title: string; start: string; end: string; category: string; location?: string; mandatory?: boolean; repeatWeekly?: boolean; eventVersion?: number }) => ({
  title: event.title, start: event.start, end: event.end, category: event.category, location: event.location ?? '',
  mandatory: event.mandatory ?? false, repeatWeekly: event.repeatWeekly ?? false,
  ...(typeof event.eventVersion === 'number' ? { eventVersion: event.eventVersion } : {}),
});

export async function executeAssistantTool(name: string, rawArguments: string, context: AssistantToolContext): Promise<Record<string, unknown>> {
  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'invalid_tool_arguments' };
    args = parsed as Record<string, unknown>;
  } catch { return { error: 'invalid_tool_arguments' }; }

  if (name === 'calendar_search_events') {
    if (!onlyKeys(args, ['from', 'to', 'query'])) return { error: 'invalid_tool_arguments' };
    const from = typeof args.from === 'string' ? args.from : '';
    const to = typeof args.to === 'string' ? args.to : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(Date.parse(`${from}T00:00:00Z`)) || !Number.isFinite(Date.parse(`${to}T00:00:00Z`)) || from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 93 * 86_400_000 || (args.query !== null && typeof args.query !== 'string')) return { error: 'invalid_or_too_wide_date_range' };
    const overview = await context.calendar.getOverview(context.scope.userId, context.scope.calendarId);
    if (!overview) return { error: 'calendar_not_found' };
    const query = typeof args.query === 'string' ? args.query.trim().toLocaleLowerCase() : '';
    // Serie cotygodniowe rozwijamy na wystąpienia w zakresie (S23KC2S1P2-270), żeby „co mam jutro?” obejmowało zajęcia z serii.
    const zone = overview.user.timezone;
    const byId = new Map(overview.events.map((event) => [event.id, event]));
    const matching = overview.events.filter((event) => !query || `${event.title} ${event.location ?? ''}`.toLocaleLowerCase().includes(query));
    const events = occurrencesInRange(matching, localMidnight(from, zone), localMidnight(addDays(to, 1), zone), zone).slice(0, 100).map((item) => {
      const source = byId.get(item.id)!;
      return { id: item.id, title: item.title, start: item.startLocal, end: item.endLocal, category: source.category,
        // Obowiązkowość dotyczy tylko zajęć – przy pracy i wydarzeniach prywatnych jej nie podajemy.
        ...(item.category === 'Class' ? { mandatory: item.mandatory } : {}),
        repeatWeekly: item.repeatWeekly, location: item.location, ...(item.repeatWeekly ? { seriesStart: source.start, seriesEnd: source.end } : {}) };
    });
    return { timeZone: zone, events };
  }

  if (name === 'calendar_free_windows' || name === 'calendar_time_totals') {
    const keys = name === 'calendar_free_windows' ? ['from', 'to', 'dayStart', 'dayEnd', 'minMinutes'] : ['from', 'to'];
    if (!onlyKeys(args, keys) || keys.some((key) => !(key in args))) return { error: 'invalid_tool_arguments' };
    const from = String(args.from), to = String(args.to);
    const maxDays = name === 'calendar_free_windows' ? 14 : 93;
    if (!isValidDate(from) || !isValidDate(to) || from > to || addDays(from, maxDays - 1) < to) return { error: 'invalid_or_too_wide_date_range' };
    const overview = await context.calendar.getOverview(context.scope.userId, context.scope.calendarId);
    if (!overview) return { error: 'calendar_not_found' };
    const zone = overview.user.timezone;
    if (name === 'calendar_time_totals') return totalsInRange(overview.events, from, to, zone);
    const dayStart = String(args.dayStart), dayEnd = String(args.dayEnd), minMinutes = Number(args.minMinutes);
    if (!isValidTime(dayStart) || dayStart === '24:00' || !isValidTime(dayEnd) || dayEnd <= dayStart || !Number.isInteger(minMinutes) || minMinutes < 5 || minMinutes > 720)
      return { error: 'invalid_tool_arguments' };
    return { timeZone: zone, dayStart, dayEnd, minMinutes, windows: freeWindowsInRange(overview.events, from, to, dayStart, dayEnd, minMinutes, zone).slice(0, 100) };
  }

  if (name === 'work_profile_get') {
    if (Object.keys(args).length) return { error: 'invalid_tool_arguments' };
    if (!context.workProfile) return { error: 'work_profile_unavailable' };
    const profile = await context.workProfile.getProfile(context.scope);
    return profile ? { profile } : { error: 'work_profile_not_found' };
  }

  if (name === 'calendar_prepare_event_create' || name === 'calendar_prepare_event_update' || name === 'calendar_prepare_event_delete') {
    const kind = name.endsWith('_create') ? 'calendar_event_create' : name.endsWith('_update') ? 'calendar_event_update' : 'calendar_event_delete';
    let payload: Record<string, unknown>;
    let collisions: PreviewCollision[] | undefined;
    if (kind === 'calendar_event_delete') {
      if (!onlyKeys(args, ['id']) || typeof args.id !== 'string' || !args.id || args.id.length > 200) return { error: 'invalid_tool_arguments' };
      const id = typeof args.id === 'string' ? args.id : '';
      const overview = await context.calendar.getOverview(context.scope.userId, context.scope.calendarId);
      const event = overview?.events.find((item) => item.id === id);
      if (!event) return { error: 'event_not_found' };
      payload = { id, original: eventSnapshot(event) };
    } else {
      if (!validEventArguments(args, kind === 'calendar_event_update')) return { error: 'invalid_tool_arguments' };
      // Obowiązkowość ma sens tylko dla zajęć; tytuł i miejsce bez zbędnych spacji (S23KC2S1P2-262).
      const event = { title: String(args.title).trim(), start: String(args.start), end: String(args.end), category: String(args.category),
        location: String(args.location).trim(), mandatory: args.category === 'Class' && args.mandatory === true, repeatWeekly: args.repeatWeekly === true };
      const overview = await context.calendar.getOverview(context.scope.userId, context.scope.calendarId);
      if (!overview) return { error: 'calendar_not_found' };
      if (typeof args.id === 'string') {
        const current = overview.events.find((item) => item.id === args.id);
        if (!current) return { error: 'event_not_found' };
        payload = { id: args.id, original: eventSnapshot(current), event };
      } else payload = { event };
      // Wspólna walidacja i kolizje: te same reguły co przy ręcznym dodawaniu. Kolizje nie blokują podglądu,
      // ale model musi je pokazać, a zatwierdzenie i tak zostanie odrzucone, dopóki użytkownik nie poprawi terminu (5a).
      try { collisions = previewCollisions(event, overview.events, overview.user.timezone, typeof args.id === 'string' ? args.id : undefined); }
      catch (error) { return { error: error instanceof EventValidationError ? error.message === 'event_too_long' ? 'event_too_long' : 'invalid_event_time' : 'invalid_event' }; }
      // Nowy podgląd dodania zastępuje poprzedni w tej rozmowie – stary nie może już utworzyć wydarzenia (KA5).
      if (kind === 'calendar_event_create') await context.ai.cancelPendingActionsOfKind?.(context.scope, context.conversationId, kind);
    }
    const action = await context.ai.createAction(context.scope, context.conversationId, kind, payload, context.actionTtlMinutes);
    return { status: 'awaiting_user_confirmation', actionId: action.id, expiresAt: action.expiresAt, preview: payload,
      ...(collisions ? { collisions, collisionNotice: collisions.length ? 'Termin koliduje z wydarzeniami – nie da się go zatwierdzić bez poprawy.' : 'Brak kolizji.' } : {}) };
  }

  return { error: 'tool_not_allowed' };
}
