import type { CalendarOverview, EventInput } from '../database.js';
import type { ExistingEvent } from '../import/rules.js';
import type { AcceptedRow, ConfirmResult, CreateSessionInput } from '../import/session.js';
import type { GoogleImportOptions } from './v1/imports/google-routes.js';
import type { ScheduleRepository } from '../scheduling/repository.js';
import type { ScheduleReader } from '../import/work-schedule/reader.js';
import type { WorkProfileRepository } from '../profile/repository.js';
import type { PostgresNotificationRepository } from '../notifications/repository.js';
import type { ScopeResolver } from './scope.js';
import type { AiService } from '../ai/service.js';
import type { AiRepository } from '../ai/repository.js';

export type AiServiceContract = Pick<AiService, 'extractSchedule' | 'sendAssistantMessage'>;
export type AiRepositoryContract = Pick<AiRepository,
  'createConversation' | 'getConversation' | 'listConversations' | 'appendMessage' | 'listMessages' | 'listPendingActions' |
  'closeConversation' | 'logUsage' | 'createAction' | 'getAction' | 'claimAction' | 'completeAction' | 'releaseAction' | 'cancelAction' | 'cancelPendingActions'>;

export type CalendarRepository = {
  deleteEvent?: (eventId: string, userId?: string, calendarId?: string) => Promise<string[] | null>;
  updateEvent?: (id: string, input: EventInput, userId?: string, calendarId?: string) => Promise<EventInput & { id: string }>;
  createEvent?: (input: EventInput, userId?: string, calendarId?: string, aiActionId?: string) => Promise<EventInput & { id: string }>;
  checkConnection: () => Promise<void>;
  getOverview: (userId?: string, calendarId?: string) => Promise<CalendarOverview | null>;
  createImportSession?: (input: CreateSessionInput, userId?: string) => Promise<{ id: string; expiresAt: Date }>;
  touchImportSession?: (sessionId: string, userId?: string) => Promise<void>;
  confirmImportSession?: (sessionId: string, rows: AcceptedRow[], userId?: string, calendarId?: string) => Promise<ConfirmResult>;
  cancelImportSession?: (sessionId: string, userId?: string) => Promise<boolean>;
  listEventsForImport?: (calendarId?: string, userId?: string) => Promise<ExistingEvent[]>;
  getImportUserName?: (userId?: string) => Promise<string>;

  listBlocks?: (userId?:string) => Promise<Block[]>;
  createBlock?: (input: BlockInput,userId?:string) => Promise<Block>;
  deleteBlock?: (id: string,userId?:string) => Promise<boolean>;
};

export type ApiOptions = {
  scheduleReader?: ScheduleReader;
  google?: GoogleImportOptions;
  scheduleRepository?: ScheduleRepository;
  /** Profil pracy i cel godzin (S23KC2S1P2-15, S23KC2S1P2-39). */
  workProfileRepository?: WorkProfileRepository;
  /** Ustala użytkownika żądania po stronie serwera (S23KC2S1P2-185). Domyślnie użytkownik demonstracyjny. */
  userScope?: ScopeResolver;
  aiService?: AiServiceContract;
  aiRepository?: AiRepositoryContract;
  notificationRepository?: PostgresNotificationRepository;
};

export type ApiDependencies = {
  repository: CalendarRepository | null;
  scheduleRepository?: ScheduleRepository;
  workProfileRepository?: WorkProfileRepository;
  scheduleReader: ScheduleReader;
  google?: GoogleImportOptions;
  scope: ScopeResolver;
  aiService?: AiServiceContract;
  aiRepository?: AiRepositoryContract;
  notificationRepository?: PostgresNotificationRepository;
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
