import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';

/**
 * Zakres użytkownika (S23KC2S1P2-185): czyje dane obsługuje żądanie.
 * Ustala go serwer, nigdy klient – identyfikator użytkownika nie przychodzi w adresie ani w treści żądania.
 */
export type UserScope = { userId: string; calendarId: string };

/** Zwraca zakres dla żądania. Po dodaniu logowania będzie go czytać z sesji, a nie z konfiguracji. */
export type ScopeResolver = (request: FastifyRequest) => UserScope;

/** Do czasu logowania wszystkie żądania należą do użytkownika demonstracyjnego z konfiguracji (DB_DEMO_USER_ID / DB_DEMO_CALENDAR_ID). */
export const demoScope: ScopeResolver = () => ({ userId: config.demoUserId, calendarId: config.demoCalendarId });
