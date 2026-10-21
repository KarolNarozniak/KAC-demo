import type { CalendarEvent, DemoState, NotificationPreferences, PlannerPreferences } from '../domain/model';
import { generatePlan } from '../domain/planner.ts';
import { watTimetableEvents, watTimetableStart } from './watTimetable.ts';
export const INITIAL_WEEK = watTimetableStart;
export const initialEvents: CalendarEvent[] = [
  { id: 'E001', title: 'Wykład z kryptologii', start: '2026-10-12T08:00', end: '2026-10-12T10:00', category: 'Class', mandatory: true, repeatWeekly: false, source: 'demo' },
  { id: 'E002', title: 'Praca', start: '2026-10-12T11:00', end: '2026-10-12T15:00', category: 'Work', mandatory: false, repeatWeekly: false, source: 'demo' },
  { id: 'E003', title: 'Siłownia', start: '2026-10-12T17:00', end: '2026-10-12T18:30', category: 'Personal', mandatory: false, repeatWeekly: false, source: 'demo' },
  { id: 'E004', title: 'Laboratorium bezpieczeństwa sieci', start: '2026-10-13T10:00', end: '2026-10-13T12:00', category: 'Class', mandatory: true, repeatWeekly: false, source: 'demo' },
  { id: 'E005', title: 'Spotkanie projektowe', start: '2026-10-13T11:30', end: '2026-10-13T13:00', category: 'Personal', mandatory: false, repeatWeekly: false, source: 'demo' },
  { id: 'E006', title: 'Praca', start: '2026-10-14T08:00', end: '2026-10-14T12:00', category: 'Work', mandatory: false, repeatWeekly: false, source: 'demo' },
  { id: 'E007', title: 'Projekt zespołowy', start: '2026-10-15T14:00', end: '2026-10-15T16:00', category: 'Class', mandatory: false, repeatWeekly: false, source: 'demo' },
  { id: 'E008', title: 'Obiad ze znajomymi', start: '2026-10-17T12:00', end: '2026-10-17T14:00', category: 'Personal', mandatory: false, repeatWeekly: false, source: 'demo' },
];
export const initialPreferences: PlannerPreferences = { weeklyGoal: 16, maxHoursPerWeek: 20, hourlyRate: 18, availableDays: [1, 2, 3, 4, 5, 6], availableFrom: '08:00', availableTo: '19:00', preferredFrom: '10:00', preferredTo: '16:00', commuteMinutes: 20, breakMinutes: 30, unavailableDays: [0], period: 'week' };
export const initialNotifications: NotificationPreferences = { enabled: true, quietEnabled: true, quietFrom: '22:00', quietTo: '07:00', classReminderMinutes: 30, workReminderMinutes: 60, changeAlerts: true, goalAlerts: true };
export function createDemoState(): DemoState {
  const events = structuredClone([...initialEvents, ...watTimetableEvents]);
  const proposal = generatePlan(initialPreferences, events, INITIAL_WEEK).shifts;
  return { events, preferences: structuredClone(initialPreferences), notifications: structuredClone(initialNotifications), profile: { name: 'Andrzej Stasiak', email: 'u123456@student.wat.edu.pl', studyProgram: 'Kryptologia i Cyberbezpieczeństwo', timezone: 'Europe/Warsaw' }, proposal, accepted: false, published: [] };
}
