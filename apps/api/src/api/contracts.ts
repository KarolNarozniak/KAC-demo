import type { CalendarOverview, EventInput } from '../database.js';
import type { ExistingEvent } from '../import/rules.js';
import type { AcceptedRow, ConfirmResult, CreateSessionInput } from '../import/session.js';
import type { GoogleImportOptions } from './v1/imports/google-routes.js';
import type { ScheduleRepository } from '../scheduling/repository.js';
import type { ScheduleReader } from '../import/work-schedule/reader.js';

export type CalendarRepository = {
  deleteEvent?: (eventId: string) => Promise<string[] | null>;
  updateEvent?: (id: string, input: EventInput) => Promise<EventInput & { id: string }>;
  createEvent?: (input: EventInput) => Promise<EventInput & { id: string }>;
  checkConnection: () => Promise<void>;
  getOverview: () => Promise<CalendarOverview | null>;
  createImportSession?: (input: CreateSessionInput) => Promise<{ id: string; expiresAt: Date }>;
  touchImportSession?: (sessionId: string) => Promise<void>;
  confirmImportSession?: (sessionId: string, rows: AcceptedRow[]) => Promise<ConfirmResult>;
  cancelImportSession?: (sessionId: string) => Promise<boolean>;
  listEventsForImport?: () => Promise<ExistingEvent[]>;
  getImportUserName?: () => Promise<string>;
};

export type ApiOptions = {
  scheduleReader?: ScheduleReader;
  google?: GoogleImportOptions;
  scheduleRepository?: ScheduleRepository;
};

export type ApiDependencies = {
  repository: CalendarRepository | null;
  scheduleRepository?: ScheduleRepository;
  scheduleReader: ScheduleReader;
  google?: GoogleImportOptions;
};
