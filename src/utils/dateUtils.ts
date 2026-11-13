import { HolidayItem, ProjectModel, ScheduleTask, TaskCategory } from '../types/schedule';

export interface CalendarDay {
  dateStr: string; // YYYY-MM-DD
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  dayOfWeek: number; // 0 (Sun) - 6 (Sat)
  isWeekend: boolean;
  quarter: number; // 1-4
}

export interface MonthSpan {
  key: string;
  year: number;
  month: number;
  quarter: number;
  daysCount: number;
}

export interface WeeklyDfmTaskBreakdown {
  projectId: string;
  seqNo: number;
  modelName: string;
  taskId: string;
  taskName: string;
  plannedDays: number;
  actualDays: number;
}

export interface WeeklyDfmStat {
  weekKey: string;
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  plannedDays: number;
  actualDays: number;
  diffDays: number;
  activeModelsCount: number;
  breakdown: WeeklyDfmTaskBreakdown[];
}

export function getTaskCategory(
  task: Pick<ScheduleTask, 'taskName' | 'taskCategory'>
): TaskCategory {
  if (task.taskCategory) return task.taskCategory;
  const upper = task.taskName.toUpperCase();
  if (upper.includes('DFM')) return 'dfm';
  if (task.taskName.includes('試產') || upper.includes('PILOT')) return 'pilot';
  return 'other';
}

export function parseLocalDate(dateStr: string): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatChineseShortDate(dateStr: string): string {
  const parsed = parseLocalDate(dateStr);
  if (!parsed) return '';
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
}

export function formatMonthDaySlash(dateStr: string): string {
  const parsed = parseLocalDate(dateStr);
  if (!parsed) return '';
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

export function isWeekendDate(dateStr: string): boolean {
  const d = parseLocalDate(dateStr);
  if (!d) return false;
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

export function generateCalendarDays(startDateStr: string, endDateStr: string): CalendarDay[] {
  const start = parseLocalDate(startDateStr);
  const end = parseLocalDate(endDateStr);
  if (!start || !end || start > end) return [];

  const result: CalendarDay[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let safety = 0;
  while (cursor <= end && safety < 500) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1;
    const day = cursor.getDate();
    const dayOfWeek = cursor.getDay();
    result.push({
      dateStr: formatDateISO(cursor),
      year,
      month,
      day,
      dayOfWeek,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      quarter: Math.ceil(month / 3),
    });
    cursor.setDate(cursor.getDate() + 1);
    safety++;
  }
  return result;
}

export function groupDaysByMonth(days: CalendarDay[]): MonthSpan[] {
  const spans: MonthSpan[] = [];
  for (const d of days) {
    const key = `${d.year}-${String(d.month).padStart(2, '0')}`;
    const last = spans[spans.length - 1];
    if (last && last.key === key) {
      last.daysCount += 1;
    } else {
      spans.push({
        key,
        year: d.year,
        month: d.month,
        quarter: d.quarter,
        daysCount: 1,
      });
    }
  }
  return spans;
}

export function buildHolidayMap(holidays: HolidayItem[]): Map<string, HolidayItem> {
  const map = new Map<string, HolidayItem>();
  for (const h of holidays) {
    map.set(h.date, h);
  }
  return map;
}

export function getEffectivePlannedDates(
  task: ScheduleTask,
  holidayMap: Map<string, HolidayItem>
): Set<string> {
  const dates = new Set<string>();
  if (!task.plannedStart || !task.plannedEnd || task.plannedStart > task.plannedEnd) {
    return dates;
  }
  const days = generateCalendarDays(task.plannedStart, task.plannedEnd);
  for (const d of days) {
    if (!d.isWeekend && !holidayMap.has(d.dateStr)) {
      dates.add(d.dateStr);
    }
  }
  return dates;
}

export function getEffectiveActualDates(
  task: ScheduleTask,
  holidayMap: Map<string, HolidayItem>
): Set<string> {
  const overrides = task.dailyOverrides || {};
  const hasRange = Boolean(
    task.actualStart && task.actualEnd && task.actualStart <= task.actualEnd
  );
  const countedDates = new Set<string>();

  if (hasRange) {
    const days = generateCalendarDays(task.actualStart, task.actualEnd);
    for (const d of days) {
      const ov = overrides[d.dateStr];
      if (ov === 'pause') continue;
      if (ov === 'work' || ov === 'delay' || ov === 'pilot') {
        countedDates.add(d.dateStr);
      } else if (!d.isWeekend && !holidayMap.has(d.dateStr)) {
        countedDates.add(d.dateStr);
      }
    }
  }

  for (const [dateStr, ov] of Object.entries(overrides)) {
    if (ov === 'work' || ov === 'delay' || ov === 'pilot') {
      countedDates.add(dateStr);
    } else if (ov === 'pause') {
      countedDates.delete(dateStr);
    }
  }

  return countedDates;
}

export function getEffectiveActualRangeDisplay(
  task: ScheduleTask
): { start: string; end: string } {
  if (task.actualStart && task.actualEnd) {
    return { start: task.actualStart, end: task.actualEnd };
  }
  const activeDates = Object.entries(task.dailyOverrides || {})
    .filter(([, ov]) => ov === 'work' || ov === 'delay' || ov === 'pilot')
    .map(([dateStr]) => dateStr)
    .sort();
  if (activeDates.length > 0) {
    return {
      start: task.actualStart || activeDates[0],
      end: task.actualEnd || activeDates[activeDates.length - 1],
    };
  }
  return { start: task.actualStart, end: task.actualEnd };
}

export function computePlannedWorkingDays(
  task: ScheduleTask,
  holidayMap: Map<string, HolidayItem>
): number {
  if (!task.plannedStart || !task.plannedEnd) {
    return task.manualPlannedDays ?? 0;
  }
  const dates = getEffectivePlannedDates(task, holidayMap);
  if (dates.size === 0 && task.plannedStart > task.plannedEnd) {
    return task.manualPlannedDays ?? 0;
  }
  return dates.size;
}

export function computeActualWorkingDays(
  task: ScheduleTask,
  holidayMap: Map<string, HolidayItem>
): number {
  const overrides = task.dailyOverrides || {};
  const hasRange = Boolean(task.actualStart && task.actualEnd);
  if (!hasRange && Object.keys(overrides).length === 0) {
    return task.manualActualDays ?? 0;
  }
  return getEffectiveActualDates(task, holidayMap).size;
}

export type PlannedBarSegment = 'none' | 'single' | 'start' | 'middle' | 'end';

export function getPlannedCellState(dateStr: string, task: ScheduleTask): PlannedBarSegment {
  if (!task.plannedStart || !task.plannedEnd) return 'none';
  if (task.plannedStart > task.plannedEnd) return 'none';
  if (dateStr < task.plannedStart || dateStr > task.plannedEnd) return 'none';
  if (task.plannedStart === task.plannedEnd) return 'single';
  if (dateStr === task.plannedStart) return 'start';
  if (dateStr === task.plannedEnd) return 'end';
  return 'middle';
}

export type ActualCellState =
  | 'empty'
  | 'on_time'
  | 'delay'
  | 'pilot_blue'
  | 'non_working_span'
  | 'pause';

export function getActualCellState(
  day: CalendarDay,
  task: ScheduleTask,
  holidayMap: Map<string, HolidayItem>
): ActualCellState {
  const override = task.dailyOverrides?.[day.dateStr];
  if (override === 'pause') return 'pause';
  if (override === 'pilot') return 'pilot_blue';
  if (override === 'work') return 'on_time';
  if (override === 'delay') return 'delay';

  if (!task.actualStart || !task.actualEnd) return 'empty';
  if (task.actualStart > task.actualEnd) return 'empty';
  if (day.dateStr < task.actualStart || day.dateStr > task.actualEnd) return 'empty';

  if (day.isWeekend || holidayMap.has(day.dateStr)) {
    return 'non_working_span';
  }

  if (getTaskCategory(task) === 'pilot') {
    return 'pilot_blue';
  }

  if (task.plannedStart && task.plannedEnd && task.plannedStart <= task.plannedEnd) {
    if (day.dateStr >= task.plannedStart && day.dateStr <= task.plannedEnd) {
      return 'on_time';
    }
    return 'delay';
  }

  return 'on_time';
}

export function isTaskDelayedOrWarning(
  task: ScheduleTask,
  referenceToday: string,
  holidayMap: Map<string, HolidayItem>
): { isWarning: boolean; reason: string } {
  const actualRange = getEffectiveActualRangeDisplay(task);

  if (task.completed || task.status === 'C' || task.status === 'NA') {
    const pDays = computePlannedWorkingDays(task, holidayMap);
    const aDays = computeActualWorkingDays(task, holidayMap);
    if (pDays > 0 && aDays > pDays) {
      return { isWarning: true, reason: `實際工時超支 (+${aDays - pDays} 工作天)` };
    }
    return { isWarning: false, reason: '' };
  }

  if (task.plannedStart && !actualRange.start && task.plannedStart <= referenceToday) {
    return { isWarning: true, reason: '已達預計開始日但尚未啟動' };
  }

  if (task.plannedEnd && actualRange.end && actualRange.end > task.plannedEnd) {
    return { isWarning: true, reason: '實際結束日晚於預計結束日' };
  }

  if (task.plannedEnd && !task.completed && task.plannedEnd < referenceToday) {
    return { isWarning: true, reason: '已逾預計完成日仍未結案' };
  }

  return { isWarning: false, reason: '' };
}

export function getMondayOfWeek(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  if (!d) return '';
  const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMon);
  return formatDateISO(mon);
}

export function getSundayOfWeek(mondayStr: string): string {
  const d = parseLocalDate(mondayStr);
  if (!d) return '';
  const sun = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6);
  return formatDateISO(sun);
}

export function getISOWeekCode(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  if (!d) return '';
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNr = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  const weekNo = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return `${target.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function computeWeeklyDfmStats(
  projects: ProjectModel[],
  holidayMap: Map<string, HolidayItem>,
  rangeStart?: string,
  rangeEnd?: string
): WeeklyDfmStat[] {
  const weekMap = new Map<
    string,
    {
      weekStart: string;
      weekEnd: string;
      weekCode: string;
      plannedDays: number;
      actualDays: number;
      modelSet: Set<string>;
      taskMap: Map<string, WeeklyDfmTaskBreakdown>;
    }
  >();

  const ensureWeek = (dateStr: string) => {
    const mon = getMondayOfWeek(dateStr);
    if (!mon) return null;
    let entry = weekMap.get(mon);
    if (!entry) {
      entry = {
        weekStart: mon,
        weekEnd: getSundayOfWeek(mon),
        weekCode: getISOWeekCode(mon),
        plannedDays: 0,
        actualDays: 0,
        modelSet: new Set<string>(),
        taskMap: new Map<string, WeeklyDfmTaskBreakdown>(),
      };
      weekMap.set(mon, entry);
    }
    return entry;
  };

  // Pre-seed weeks within the requested display range if provided
  if (rangeStart && rangeEnd && rangeStart <= rangeEnd) {
    const rangeDays = generateCalendarDays(rangeStart, rangeEnd);
    for (const d of rangeDays) {
      ensureWeek(d.dateStr);
    }
  }

  for (const project of projects) {
    for (const task of project.tasks) {
      if (getTaskCategory(task) !== 'dfm') continue;

      const plannedDates = getEffectivePlannedDates(task, holidayMap);
      const actualDates = getEffectiveActualDates(task, holidayMap);

      for (const dateStr of plannedDates) {
        if (rangeStart && dateStr < rangeStart) continue;
        if (rangeEnd && dateStr > rangeEnd) continue;
        const wk = ensureWeek(dateStr);
        if (!wk) continue;
        wk.plannedDays += 1;
        wk.modelSet.add(project.id);
        let tb = wk.taskMap.get(task.id);
        if (!tb) {
          tb = {
            projectId: project.id,
            seqNo: project.seqNo,
            modelName: project.modelName,
            taskId: task.id,
            taskName: task.taskName,
            plannedDays: 0,
            actualDays: 0,
          };
          wk.taskMap.set(task.id, tb);
        }
        tb.plannedDays += 1;
      }

      for (const dateStr of actualDates) {
        if (rangeStart && dateStr < rangeStart) continue;
        if (rangeEnd && dateStr > rangeEnd) continue;
        const wk = ensureWeek(dateStr);
        if (!wk) continue;
        wk.actualDays += 1;
        wk.modelSet.add(project.id);
        let tb = wk.taskMap.get(task.id);
        if (!tb) {
          tb = {
            projectId: project.id,
            seqNo: project.seqNo,
            modelName: project.modelName,
            taskId: task.id,
            taskName: task.taskName,
            plannedDays: 0,
            actualDays: 0,
          };
          wk.taskMap.set(task.id, tb);
        }
        tb.actualDays += 1;
      }
    }
  }

  return Array.from(weekMap.values())
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((w) => {
      const shortWeek = w.weekCode.split('-')[1] || w.weekCode;
      return {
        weekKey: w.weekCode,
        weekLabel: `${shortWeek} (${formatMonthDaySlash(w.weekStart)}~${formatMonthDaySlash(w.weekEnd)})`,
        weekStart: w.weekStart,
        weekEnd: w.weekEnd,
        plannedDays: w.plannedDays,
        actualDays: w.actualDays,
        diffDays: w.actualDays - w.plannedDays,
        activeModelsCount: w.modelSet.size,
        breakdown: Array.from(w.taskMap.values()).sort((a, b) => a.seqNo - b.seqNo),
      };
    });
}
