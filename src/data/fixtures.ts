import type { CalendarEvent, DemoState, NotificationPreferences, PlannerPreferences, Shift } from '../domain/model';
export const INITIAL_WEEK = new Date(2026, 9, 12);
export const initialEvents: CalendarEvent[] = [
  { id: 'E001', title: 'Cryptography lecture', start: '2026-10-12T08:00', end: '2026-10-12T10:00', category: 'Class', mandatory: true, repeatWeekly: true, source: 'demo' },
  { id: 'E002', title: 'Campus studio shift', start: '2026-10-12T11:00', end: '2026-10-12T15:00', category: 'Work', mandatory: false, repeatWeekly: true, source: 'demo' },
  { id: 'E003', title: 'Gym', start: '2026-10-12T17:00', end: '2026-10-12T18:30', category: 'Personal', mandatory: false, repeatWeekly: false, source: 'demo' },
  { id: 'E004', title: 'Network security lab', start: '2026-10-13T10:00', end: '2026-10-13T12:00', category: 'Class', mandatory: true, repeatWeekly: true, source: 'demo' },
  { id: 'E005', title: 'Project sync', start: '2026-10-13T11:30', end: '2026-10-13T13:00', category: 'Personal', mandatory: false, repeatWeekly: false, source: 'demo' },
  { id: 'E006', title: 'Campus studio shift', start: '2026-10-14T08:00', end: '2026-10-14T12:00', category: 'Work', mandatory: false, repeatWeekly: true, source: 'demo' },
  { id: 'E007', title: 'Team project', start: '2026-10-15T14:00', end: '2026-10-15T16:00', category: 'Class', mandatory: false, repeatWeekly: false, source: 'demo' },
  { id: 'E008', title: 'Lunch with friends', start: '2026-10-17T12:00', end: '2026-10-17T14:00', category: 'Personal', mandatory: false, repeatWeekly: false, source: 'demo' },
];
export const initialPreferences: PlannerPreferences = { weeklyGoal: 16, maxHoursPerWeek: 20, hourlyRate: 18, availableDays: [1, 2, 3, 4, 5, 6], availableFrom: '08:00', availableTo: '19:00', preferredFrom: '10:00', preferredTo: '16:00', commuteMinutes: 20, breakMinutes: 30, unavailableDays: [0], period: 'week' };
export const initialNotifications: NotificationPreferences = { enabled: true, quietEnabled: true, quietFrom: '22:00', quietTo: '07:00', classReminderMinutes: 30, workReminderMinutes: 60, changeAlerts: true, goalAlerts: true };
export const initialProposal: Shift[] = [
  { id: 'shift-mon', title: 'Campus studio shift', start: '2026-10-12T10:00', end: '2026-10-12T14:00', status: 'proposed' },
  { id: 'shift-wed', title: 'Campus studio shift', start: '2026-10-14T13:00', end: '2026-10-14T17:00', status: 'proposed' },
  { id: 'shift-fri', title: 'Campus studio shift', start: '2026-10-16T10:00', end: '2026-10-16T14:00', status: 'proposed' },
  { id: 'shift-sat', title: 'Campus studio shift', start: '2026-10-17T10:00', end: '2026-10-17T14:00', status: 'proposed' },
];
export function createDemoState(): DemoState { return { events: structuredClone(initialEvents), preferences: structuredClone(initialPreferences), notifications: structuredClone(initialNotifications), profile: { name: 'Alex Morgan', email: 'alex.demo@example.test', studyProgram: 'Computer Science · Year 3', timezone: 'Europe/Warsaw' }, proposal: structuredClone(initialProposal), accepted: false, published: [] }; }
