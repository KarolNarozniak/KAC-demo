import type { ChatImport, ChatImportBinding, ChatImportPatch } from '../import/chat.js';
import type { UserScope } from './scope.js';
import type { CalendarOverview, EventInput } from '../database.js';
import type { CollisionCheck } from '../collisions.js';
import type { ExistingEvent } from '../import/rules.js';
import type { AcceptedRow, ConfirmResult, CreateSessionInput } from '../import/session.js';
import type { GoogleImportOptions } from './v1/imports/google-routes.js';
import type { ScheduleRepository } from '../scheduling/repository.js';
import type { ScheduleReader } from '../import/work-schedule/reader.js';
import type { WorkProfileRepository } from '../profile/repository.js';
import type { PostgresNotificationRepository } from '../notifications/repository.js';
import type { GoogleIntegrationService } from '../integrations/google/service.js';
import type { ScopeResolver } from './scope.js';
import type { AuthService } from '../auth/service.js';
import type { AuthRateLimits } from './v1/auth/routes.js';
import type { AiService } from '../ai/service.js';
import type { AiRepository } from '../ai/repository.js';
import type { PremiumService } from '../premium/service.js';

export type AiServiceContract = Pick<AiService, 'extractSchedule' | 'sendAssistantMessage'>;
export type AiRepositoryContract = Pick<AiRepository,
  'createConversation' | 'getConversation' | 'listConversations' | 'appendMessage' | 'listMessages' | 'listPendingActions' |
  'closeConversation' | 'logUsage' | 'createAction' | 'getAction' | 'claimAction' | 'completeAction' | 'releaseAction' | 'failAction' | 'cancelAction' | 'cancelPendingActions'>
  & Partial<Pick<AiRepository, 'countRecentUsage'>>;

export type CalendarRepository = {
  deleteEvent?: (eventId: string, userId?: string, calendarId?: string, assistantAction?: { actionId: string; expected?: Record<string, unknown> }) => Promise<string[] | null>;
  updateEvent?: (id: string, input: EventInput, userId?: string, calendarId?: string, assistantAction?: { actionId: string; expected?: Record<string, unknown> }) => Promise<EventInput & { id: string }>;
  createEvent?: (input: EventInput, userId?: string, calendarId?: string, aiActionId?: string) => Promise<EventInput & { id: string }>;
  bindChatImport?: (id: string, input: ChatImportBinding, scope: UserScope) => Promise<ChatImport>;
  listChatImports?: (scope: UserScope, conversationId: string) => Promise<ChatImport[]>;
  updateChatImport?: (scope: UserScope, id: string, conversationId: string, revision: number, patches: ChatImportPatch[]) => Promise<ChatImport>;
  checkCollisions?: (input: EventInput, eventId?: string, userId?: string, calendarId?: string) => Promise<CollisionCheck>;
  checkConnection: () => Promise<void>;
  getOverview: (userId?: string, calendarId?: string) => Promise<CalendarOverview | null>;
  createImportSession?: (input: CreateSessionInput, userId?: string) => Promise<{ id: string; expiresAt: Date }>;
  touchImportSession?: (sessionId: string, userId?: string) => Promise<void>;
  confirmImportSession?: (sessionId: string, rows: AcceptedRow[], userId?: string, calendarId?: string, chatRevision?: number) => Promise<ConfirmResult>;
  cancelImportSession?: (sessionId: string, userId?: string) => Promise<boolean>;
  listEventsForImport?: (calendarId?: string, userId?: string) => Promise<ExistingEvent[]>;
  getImportUserName?: (userId?: string) => Promise<string>;

  listBlocks?: (userId?:string) => Promise<Block[]>;
  createBlock?: (input: BlockInput,userId?:string) => Promise<Block>;
  deleteBlock?: (id: string,userId?:string) => Promise<boolean>;
};

export type ApiOptions = {
  /** Static Expo web export served by the same App Service origin, when packaged for unified hosting. */
  webRoot?: string;
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
  /** Trwałe połączenie z Google Calendar (S23KC2S1P2-12, G01). Bez bazy danych – null (API zwraca integration_not_configured). */
  googleIntegration?: GoogleIntegrationService | null;
  /** Logowanie do KAC (sesje w bazie). Podane – każda trasa poza publicznymi wymaga sesji, a zakres użytkownika pochodzi z sesji. */
  auth?: AuthService | null;
  /** Premium code and campaign service. Without it, Premium activation is disabled. */
  premiumService?: PremiumService;
  /** Limity żądań tras logowania na adres IP (domyślnie: logowanie 10/min, rejestracja 5/h, zmiana hasła i usunięcie konta 10/15 min). */
  authRateLimits?: Partial<AuthRateLimits>;
  /** Zaufani pośrednicy przed API (domyślnie TRUST_PROXY z konfiguracji) – adres klienta dla limitów logowania. */
  trustProxy?: boolean | number;
  /** Dzienny limit wywołań AI na użytkownika (domyślnie AI_DAILY_LIMIT z konfiguracji; 0 – bez limitu). */
  aiDailyLimit?: number;
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
