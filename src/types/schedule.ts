export type TaskStatus = 'O' | 'C' | 'NA';

export type ProjectStage = 'PROTO' | 'EVT' | 'DVT' | 'MVT' | 'MP' | 'OTHER';

export type TaskCategory = 'dfm' | 'pilot' | 'other';

export type DailyOverrideType = 'work' | 'delay' | 'pilot' | 'pause';

export type PcbDisplayMode = 'qty' | 'note';

export interface ScheduleTask {
  id: string;
  taskName: string;
  stage: ProjectStage;
  stageIteration?: number | null;
  taskCategory?: TaskCategory;
  pcbMode: PcbDisplayMode;
  plannedQty: number | null;
  actualQty: number | null;
  pilotNote: string;
  completed: boolean;
  plannedStart: string; // YYYY-MM-DD or ''
  plannedEnd: string;   // YYYY-MM-DD or ''
  actualStart: string;  // YYYY-MM-DD or ''
  actualEnd: string;    // YYYY-MM-DD or ''
  manualPlannedDays?: number | null;
  manualActualDays?: number | null;
  status: TaskStatus;
  owner?: string;
  remark?: string;
  dailyOverrides?: Record<string, DailyOverrideType>;
}

export interface ProjectModel {
  id: string;
  seqNo: number;
  modelName: string;
  modelSubtitle?: string;
  customer?: string;
  ee?: string;
  me?: string;
  tasks: ScheduleTask[];
}

export type CalendarDayEntryType =
  | 'holiday'
  | 'factory_off'
  | 'makeup_workday'
  | 'event';

export interface HolidayItem {
  date: string; // YYYY-MM-DD
  name: string;
  type: CalendarDayEntryType;
}

export type ExcelThemeMode = 'classic_npi' | 'modern_corp';

export interface ExportOptions {
  filename: string;
  startDate: string;
  endDate: string;
  theme: ExcelThemeMode;
  includeSummarySheet: boolean;
  includeWeeklyDfmSheet: boolean;
  onlyFilteredRows: boolean;
}
