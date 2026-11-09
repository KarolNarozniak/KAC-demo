import type { CalendarOverview, EventInput } from '../database.js';
import type { ExistingEvent } from '../import/rules.js';
import type { AcceptedRow, ConfirmResult, CreateSessionInput } from '../import/session.js';
import type { GoogleImportOptions } from './v1/imports/google-routes.js';
import type { ScheduleRepository } from '../scheduling/repository.js';
import type { ScheduleReader } from '../import/work-schedule/reader.js';
import type { WorkProfileRepository } from '../profile/repository.js';
import type { ScopeResolver } from './scope.js';

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
  
  listBlocks?: () => Promise<Block[]>;
  createBlock?: (input: BlockInput) => Promise<Block>;
  deleteBlock?: (id: string) => Promise<boolean>;
};

export type ApiOptions = {
  scheduleReader?: ScheduleReader;
  google?: GoogleImportOptions;
  scheduleRepository?: ScheduleRepository;
  /** Profil pracy i cel godzin (S23KC2S1P2-15, S23KC2S1P2-39). */
  workProfileRepository?: WorkProfileRepository;
  /** Ustala użytkownika żądania po stronie serwera (S23KC2S1P2-185). Domyślnie użytkownik demonstracyjny. */
  userScope?: ScopeResolver;
};

export type ApiDependencies = {
  repository: CalendarRepository | null;
  scheduleRepository?: ScheduleRepository;
  scheduleReader: ScheduleReader;
  google?: GoogleImportOptions;
};

export type BlockType = 'vacation' | 'exam_session' | 'day_off';

export type Block = {
  id: string;
  userId: string;
  title: string;
  startTime: string;
  endTime: string;
  type: BlockType;
};

export type BlockInput = {
  title: string;
  startTime: string;
  endTime: string;
  type: BlockType;
};