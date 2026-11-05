export type Category = 'Class' | 'Work' | 'Personal';

export type CalendarEvent = {
  id: string;
  title: string;
  location?: string;
  start: string;
  end: string;
  category: Category;
  mandatory: boolean;
  repeatWeekly: boolean;
};

export type Occurrence = CalendarEvent & {
  occurrenceStart: Date;
  occurrenceEnd: Date;
  preview?: boolean;
};

export type TimeRange = { start: Date; end: Date };
