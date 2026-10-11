export type Category = 'Class' | 'Work' | 'Personal';

export type CalendarEvent = {
  id: string;
  title: string;
  location?: string;
  courseCode?: string;
  courseForm?: string;
  instructor?: string;
  semesterHours?: number;
  start: string;
  end: string;
  category: Category;
  mandatory: boolean;
  repeatWeekly: boolean;
  source?: 'demo' | 'import' | 'planner';
};

export type Occurrence = CalendarEvent & {
  occurrenceStart: Date;
  occurrenceEnd: Date;
};

export type TimeRange = { start: Date; end: Date };

export type PlannerPreferences = {
  weeklyGoal: number;
  maxHoursPerWeek: number;
  hourlyRate: number;
  availableDays: number[];
  availableFrom: string;
  availableTo: string;
  preferredFrom: string;
  preferredTo: string;
  commuteMinutes: number;
  breakMinutes: number;
  unavailableDays: number[];
  period: 'week' | 'month';
};

export type Shift = {
  id: string;
  title: string;
  start: string;
  end: string;
  status?: 'proposed' | 'accepted' | 'published';
};

export type NotificationPreferences = {
  enabled: boolean;
  quietEnabled: boolean;
  quietFrom: string;
  quietTo: string;
  classReminderMinutes: number;
  workReminderMinutes: number;
  changeAlerts: boolean;
  goalAlerts: boolean;
};

export type DemoProfile = {
  name: string;
  email: string;
  studyProgram: string;
  timezone: string;
  studentId?: string;
  academicYear?: string;
};

export type DemoState = {
  events: CalendarEvent[];
  preferences: PlannerPreferences;
  notifications: NotificationPreferences;
  profile: DemoProfile;
  proposal: Shift[];
  accepted: boolean;
  published: Shift[];
};
