import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Edit3,
  Plus,
  Square,
  Trash2,
  AlertTriangle,
  Lock,
  Unlock,
  Maximize2,
  Minimize2,
  Undo2,
} from 'lucide-react';
import {
  DailyOverrideType,
  HolidayItem,
  ProjectModel,
  ScheduleTask,
  TaskStatus,
} from '../types/schedule';
import {
  CalendarDay,
  buildHolidayMap,
  computeActualWorkingDays,
  computePlannedWorkingDays,
  formatChineseShortDate,
  generateCalendarDays,
  getActualCellState,
  getEffectiveActualRangeDisplay,
  getPlannedCellState,
  getTaskCategory,
  groupDaysByMonth,
  isTaskDelayedOrWarning,
} from '../utils/dateUtils';

export type GanttClickMode =
  | 'auto_paint'
  | 'paint_pilot'
  | 'paint_work'
  | 'paint_delay'
  | 'paint_pause'
  | 'paint_erase'
  | 'set_planned'
  | 'inspect';

interface ScheduleGridProps {
  projects: ProjectModel[];
  holidays: HolidayItem[];
  startDate: string;
  endDate: string;
  referenceToday: string;
  ganttClickMode: GanttClickMode;
  compactSticky: boolean;
  classicColors: boolean;
  isEditable: boolean;
  isFullscreen: boolean;
  canUndo: boolean;
  onToggleEditable: () => void;
  onToggleFullscreen: () => void;
  onChangeClickMode: (mode: GanttClickMode) => void;
  onUndo: () => void;
  onProtectedNotice?: (msg: string) => void;
  onToggleTaskCompleted: (projectId: string, taskId: string) => void;
  onCycleTaskStatus: (projectId: string, taskId: string) => void;
  onEditProject: (project: ProjectModel) => void;
  onAddTaskToProject: (project: ProjectModel) => void;
  onDeleteProject: (projectId: string) => void;
  onEditTask: (project: ProjectModel, task: ScheduleTask) => void;
  onUpdateTaskDates: (
    projectId: string,
    taskId: string,
    field: 'planned' | 'actual',
    start: string,
    end: string
  ) => void;
  onApplyDailyPaint: (
    projectId: string,
    taskId: string,
    dateStr: string,
    value: DailyOverrideType | 'clear'
  ) => void;
  onToggleHolidayDate: (dateStr: string) => void;
}

interface PendingRangeSelection {
  projectId: string;
  taskId: string;
  rowType: 'planned' | 'actual';
  anchorDate: string;
}

interface DragPaintSession {
  projectId: string;
  taskId: string;
  rowType: 'planned' | 'actual';
  paintValue: DailyOverrideType | 'clear';
  onlyEmpty: boolean;
}

const COMPACT_BRUSHES: { id: GanttClickMode; label: string; dot: string | null }[] = [
  { id: 'inspect', label: '安全點選', dot: null },
  { id: 'auto_paint', label: '智慧塗色', dot: null },
  { id: 'paint_work', label: '正常綠', dot: 'bg-[#16e016]' },
  { id: 'paint_delay', label: '超期紅', dot: 'bg-[#f40058]' },
  { id: 'paint_pilot', label: '試產確認', dot: 'bg-[#38bdf8]' },
  { id: 'paint_pause', label: '停工灰', dot: 'bg-slate-400' },
  { id: 'paint_erase', label: '清除格', dot: 'bg-white border border-slate-400' },
  { id: 'set_planned', label: '設預計區間', dot: null },
];

export const ScheduleGrid: React.FC<ScheduleGridProps> = ({
  projects,
  holidays,
  startDate,
  endDate,
  referenceToday,
  ganttClickMode,
  compactSticky,
  classicColors,
  isEditable,
  isFullscreen,
  canUndo,
  onToggleEditable,
  onToggleFullscreen,
  onChangeClickMode,
  onUndo,
  onProtectedNotice,
  onToggleTaskCompleted,
  onCycleTaskStatus,
  onEditProject,
  onAddTaskToProject,
  onDeleteProject,
  onEditTask,
  onUpdateTaskDates,
  onApplyDailyPaint,
  onToggleHolidayDate,
}) => {
  const [pendingRange, setPendingRange] = useState<PendingRangeSelection | null>(null);
  const [dragSession, setDragSession] = useState<DragPaintSession | null>(null);
  const [hoverDateInfo, setHoverDateInfo] = useState<string | null>(null);
  const [confirmDeleteProjId, setConfirmDeleteProjId] = useState<string | null>(null);

  const holidayMap = useMemo(() => buildHolidayMap(holidays), [holidays]);
  const calendarDays = useMemo(
    () => generateCalendarDays(startDate, endDate),
    [startDate, endDate]
  );
  const monthSpans = useMemo(() => groupDaysByMonth(calendarDays), [calendarDays]);

  useEffect(() => {
    const handleWindowMouseUp = () => {
      setDragSession(null);
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, []);

  useEffect(() => {
    if (!isEditable) {
      setPendingRange(null);
      setDragSession(null);
      setConfirmDeleteProjId(null);
    }
  }, [isEditable]);

  useEffect(() => {
    if (ganttClickMode !== 'set_planned') {
      setPendingRange(null);
    }
  }, [ganttClickMode]);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onToggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isFullscreen, onToggleFullscreen]);

  const resolveActualPaintTarget = (
    task: ScheduleTask,
    day: CalendarDay
  ): DailyOverrideType | 'clear' | null => {
    const currentState = getActualCellState(day, task, holidayMap);
    const hasExistingData =
      currentState === 'on_time' ||
      currentState === 'delay' ||
      currentState === 'pilot_blue' ||
      currentState === 'pause';

    if (ganttClickMode === 'paint_erase') {
      return 'clear';
    }
    if (ganttClickMode === 'paint_pilot') {
      return 'pilot';
    }
    if (ganttClickMode === 'paint_work') {
      return 'work';
    }
    if (ganttClickMode === 'paint_delay') {
      return 'delay';
    }
    if (ganttClickMode === 'paint_pause') {
      return 'pause';
    }

    // auto_paint: protect existing painted cells from accidental overwrite/wipe
    if (hasExistingData) {
      return null;
    }

    const cat = getTaskCategory(task);
    if (cat === 'pilot') return 'pilot';

    const hasValidPlanned = Boolean(
      task.plannedStart && task.plannedEnd && task.plannedStart <= task.plannedEnd
    );

    // DFM Review without planned dates -> overdue red ('delay')
    if (cat === 'dfm' && !hasValidPlanned) {
      return 'delay';
    }

    if (
      hasValidPlanned &&
      (day.dateStr < task.plannedStart || day.dateStr > task.plannedEnd)
    ) {
      return 'delay';
    }

    return 'work';
  };

  const handleGanttMouseDown = (
    project: ProjectModel,
    task: ScheduleTask,
    rowType: 'planned' | 'actual',
    day: CalendarDay
  ) => {
    if (!isEditable) {
      onProtectedNotice?.('目前為「唯讀鎖定 (不可編輯)」狀態，請先切換為「可編輯狀態」後再調整排程');
      return;
    }

    if (ganttClickMode === 'inspect') {
      onEditTask(project, task);
      return;
    }

    if (ganttClickMode === 'set_planned') {
      if (rowType !== 'planned') {
        onProtectedNotice?.('「兩點設預計區間」僅能點擊上方的「預計 ▶」列起訖日期');
        return;
      }
      if (
        pendingRange &&
        pendingRange.projectId === project.id &&
        pendingRange.taskId === task.id &&
        pendingRange.rowType === 'planned'
      ) {
        const d1 = pendingRange.anchorDate;
        const d2 = day.dateStr;
        const [s, e] = d1 <= d2 ? [d1, d2] : [d2, d1];
        onUpdateTaskDates(project.id, task.id, 'planned', s, e);
        setPendingRange(null);
      } else {
        setPendingRange({
          projectId: project.id,
          taskId: task.id,
          rowType: 'planned',
          anchorDate: day.dateStr,
        });
      }
      return;
    }

    if (rowType === 'planned') {
      // Protect planned schedule from stray clicks in auto_paint or color brushes:
      // open task editor safely instead of overwriting planned range.
      onEditTask(project, task);
      return;
    }

    const paintVal = resolveActualPaintTarget(task, day);
    if (paintVal === null) {
      onProtectedNotice?.('此格已有排程資料（防誤觸鎖定不覆蓋）。若需清除請切換「清除格」筆刷');
      return;
    }

    onApplyDailyPaint(project.id, task.id, day.dateStr, paintVal);
    setDragSession({
      projectId: project.id,
      taskId: task.id,
      rowType: 'actual',
      paintValue: paintVal,
      onlyEmpty: ganttClickMode === 'auto_paint',
    });
  };

  const handleGanttMouseEnter = (
    project: ProjectModel,
    task: ScheduleTask,
    rowType: 'planned' | 'actual',
    day: CalendarDay
  ) => {
    if (
      isEditable &&
      dragSession &&
      dragSession.projectId === project.id &&
      dragSession.taskId === task.id &&
      dragSession.rowType === rowType &&
      rowType === 'actual'
    ) {
      const currentState = getActualCellState(day, task, holidayMap);
      const hasExistingData =
        currentState === 'on_time' ||
        currentState === 'delay' ||
        currentState === 'pilot_blue' ||
        currentState === 'pause';
      if (!dragSession.onlyEmpty || !hasExistingData) {
        onApplyDailyPaint(project.id, task.id, day.dateStr, dragSession.paintValue);
      }
    }

    if (rowType === 'planned') {
      const catLabel = getTaskCategory(task) === 'pilot' ? '試產預計' : '預計排程';
      setHoverDateInfo(
        `${day.dateStr} · ${project.modelName} (${task.taskName}) · ${catLabel}${
          task.plannedStart && task.plannedEnd
            ? `：${task.plannedStart} ~ ${task.plannedEnd}`
            : '：未排定'
        }`
      );
    } else {
      const override = task.dailyOverrides?.[day.dateStr];
      const ovText = getOverrideLabel(override);
      setHoverDateInfo(
        `${day.dateStr} · ${project.modelName} (${task.taskName}) · 實際工作日記錄${
          ovText ? ` [${ovText}]` : ''
        }`
      );
    }
  };

  const getStatusStyle = (status: TaskStatus) => {
    if (status === 'C') {
      return classicColors
        ? 'bg-emerald-200/90 text-emerald-950'
        : 'bg-emerald-50 text-emerald-800';
    }
    if (status === 'O') {
      return classicColors
        ? 'bg-orange-100 text-rose-700'
        : 'bg-amber-50 text-rose-700';
    }
    return 'bg-slate-50 text-slate-700';
  };

  const getOverrideLabel = (ov?: DailyOverrideType) => {
    if (ov === 'work') return '正常出勤';
    if (ov === 'delay') return '超期/異常';
    if (ov === 'pilot') return '試產確認';
    if (ov === 'pause') return '停工不計工時';
    return '';
  };

  if (projects.length === 0) {
    return (
      <div className="border border-slate-200 bg-white rounded-lg p-12 text-center">
        <p className="text-base font-semibold text-slate-900">目前尚無符合條件或已建立的專案排程</p>
        <p className="mt-1 text-sm text-slate-500">
          請調整上方篩選條件，或點擊「匯入 Excel」、「新增機種專案」建立您的排程資料。
        </p>
      </div>
    );
  }

  const stickyBase = 'sticky z-20';
  const headerStickyBase = 'sticky z-40';

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 bg-white flex flex-col w-screen h-screen overflow-hidden'
          : 'border border-slate-300 bg-white rounded-lg overflow-hidden'
      }
    >
      {/* Top Bar: Legend + Edit Lock + Undo + Fullscreen Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-600 shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-slate-700">圖例：</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-5 h-2.5 bg-amber-400/50 border-y-2 border-amber-500 border-x-4 border-x-amber-400" />
            <span>DFM 預計</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-5 h-2.5 bg-[#a855f7]/50 border-y-2 border-[#9333ea] border-x-4 border-x-[#a855f7]" />
            <span>試產預計</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-3.5 h-2.5 ${classicColors ? 'bg-[#16e016]' : 'bg-emerald-500'}`} />
            <span>實際正常</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-3.5 h-2.5 ${classicColors ? 'bg-[#f40058]' : 'bg-rose-500'}`} />
            <span>超期異常</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-3.5 h-2.5 ${classicColors ? 'bg-[#38bdf8]' : 'bg-sky-400'}`} />
            <span>試產確認</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-2.5 bg-slate-300" />
            <span>週末 / 停工</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-3.5 h-2.5 border border-slate-300 ${classicColors ? 'bg-[#ffff00]' : 'bg-amber-200'}`} />
            <span>國定假日</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-2.5 border border-orange-400 bg-orange-300" />
            <span>廠休 / 盤點</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-2.5 border border-teal-500 bg-teal-300" />
            <span>調班工作天</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3.5 h-2.5 border border-indigo-400 bg-indigo-300" />
            <span>展覽 / 活動</span>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canUndo && isEditable && (
            <button
              type="button"
              onClick={onUndo}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap"
              title="復原上一步排程異動 (Ctrl+Z)"
            >
              <Undo2 className="w-3.5 h-3.5" />
              復原上一步
            </button>
          )}

          <button
            type="button"
            onClick={onToggleEditable}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold border rounded-md transition-colors whitespace-nowrap ${
              isEditable
                ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
            }`}
            title={
              isEditable
                ? '目前可編輯排程；點擊切換為唯讀鎖定以防止誤觸'
                : '目前為唯讀鎖定（不可編輯）；點擊解鎖編輯'
            }
          >
            {isEditable ? (
              <>
                <Unlock className="w-3.5 h-3.5" />
                可編輯狀態
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5" />
                唯讀鎖定 (不可編輯)
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onToggleFullscreen}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold border rounded-md transition-colors whitespace-nowrap ${
              isFullscreen
                ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-100'
            }`}
            title={isFullscreen ? '退出滿版顯示 (Esc)' : '滿版顯示排程圖表'}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                退出滿版
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                滿版顯示
              </>
            )}
          </button>
        </div>
      </div>

      {/* Fullscreen Compact Brush Strip (shown only in Fullscreen + Editable mode) */}
      {isFullscreen && isEditable && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-1.5 bg-slate-100/80 border-b border-slate-200 text-xs shrink-0">
          <span className="font-semibold text-slate-700 mr-1 whitespace-nowrap">
            滿版筆刷：
          </span>
          {COMPACT_BRUSHES.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onChangeClickMode(b.id)}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
                ganttClickMode === b.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {b.dot && <span className={`inline-block w-2.5 h-2.5 rounded-xs ${b.dot}`} />}
              {b.label}
            </button>
          ))}
        </div>
      )}

      {/* Fixed-height single-line hover/status bar (prevents scrollbar jump when moving across cell borders) */}
      <div className="h-7 px-4 bg-white border-b border-slate-200 flex items-center justify-between gap-3 text-xs overflow-hidden shrink-0">
        {pendingRange ? (
          <div className="flex items-center gap-2 text-amber-800 font-medium truncate">
            <span className="truncate">
              已選擇起點 {pendingRange.anchorDate}，請點擊同一任務「預計 ▶」列的結束日期完成設定
            </span>
            <button
              type="button"
              onClick={() => setPendingRange(null)}
              className="underline text-slate-600 hover:text-slate-900 shrink-0"
            >
              取消
            </button>
          </div>
        ) : hoverDateInfo ? (
          <span className="text-slate-700 truncate">{hoverDateInfo}</span>
        ) : !isEditable ? (
          <span className="text-amber-700 font-medium truncate">
            目前為「唯讀鎖定」檢視狀態 — 所有甘特圖格子與欄位皆已鎖定不可編輯（點擊右上角可解除鎖定）
          </span>
        ) : ganttClickMode === 'inspect' ? (
          <span className="text-slate-500 truncate">
            安全點選模式（防誤觸）：點擊格子開啟明細視窗；若要直接在甘特圖塗色，請選擇「智慧塗色」或各色筆刷
          </span>
        ) : (
          <span className="text-slate-500 truncate">
            在「實際 ▶」列點擊或拖曳即可塗色記錄（既有資料已受保護不會被智慧塗色誤蓋，清除請改用「清除格」筆刷）
          </span>
        )}
      </div>

      {/* Unified Sticky Table + Gantt Scroll Viewport */}
      <div
        className={`overflow-auto schedule-scroll ${
          isFullscreen ? 'flex-1 min-h-0' : 'max-h-[calc(100vh-285px)] min-h-[440px]'
        }`}
      >
        <table
          onMouseLeave={() => setHoverDateInfo(null)}
          className="border-separate border-spacing-0 text-xs select-none w-max min-w-full"
        >
          <thead>
            {/* Header Row 1: Fixed Column Headers (rowSpan=2) + Month Headers */}
            <tr className="h-8">
              <th
                rowSpan={2}
                style={{ left: 0 }}
                className={`${headerStickyBase} top-0 w-[44px] min-w-[44px] max-w-[44px] bg-slate-100 text-slate-800 font-semibold border-b border-r border-slate-300 text-center`}
              >
                序號
              </th>
              <th
                rowSpan={2}
                style={{ left: 44 }}
                className={`${headerStickyBase} top-0 w-[144px] min-w-[144px] max-w-[144px] bg-slate-100 text-slate-800 font-semibold border-b border-r border-slate-300 text-center`}
              >
                機種名稱
              </th>
              <th
                rowSpan={2}
                style={{ left: 188 }}
                className={`${headerStickyBase} top-0 w-[132px] min-w-[132px] max-w-[132px] bg-slate-100 text-slate-800 font-semibold border-b border-r border-slate-300 text-center ${
                  compactSticky ? 'shadow-[2px_0_5px_-2px_rgba(15,23,42,0.18)]' : ''
                }`}
              >
                任務名稱
              </th>
              <th
                rowSpan={2}
                style={!compactSticky ? { left: 320 } : undefined}
                className={`${
                  !compactSticky ? headerStickyBase : 'sticky z-30'
                } top-0 w-[92px] min-w-[92px] max-w-[92px] bg-slate-100 text-slate-800 font-semibold border-b border-r border-slate-300 text-center`}
              >
                PCB數量
              </th>
              <th
                rowSpan={2}
                style={!compactSticky ? { left: 412 } : undefined}
                className={`${
                  !compactSticky ? headerStickyBase : 'sticky z-30'
                } top-0 w-[44px] min-w-[44px] max-w-[44px] bg-slate-100 text-slate-800 font-semibold border-b border-r border-slate-300 text-center`}
              >
                完成
              </th>
              <th
                rowSpan={2}
                style={!compactSticky ? { left: 456 } : undefined}
                className={`${
                  !compactSticky ? headerStickyBase : 'sticky z-30'
                } top-0 w-[70px] min-w-[70px] max-w-[70px] bg-slate-100 text-slate-800 font-semibold border-b border-r border-slate-300 text-center`}
              >
                開始
              </th>
              <th
                rowSpan={2}
                style={!compactSticky ? { left: 526 } : undefined}
                className={`${
                  !compactSticky ? headerStickyBase : 'sticky z-30'
                } top-0 w-[70px] min-w-[70px] max-w-[70px] bg-slate-100 text-slate-800 font-semibold border-b border-r border-slate-300 text-center`}
              >
                結束
              </th>
              <th
                rowSpan={2}
                style={!compactSticky ? { left: 596 } : undefined}
                className={`${
                  !compactSticky ? headerStickyBase : 'sticky z-30'
                } top-0 w-[52px] min-w-[52px] max-w-[52px] bg-slate-100 text-slate-800 font-semibold border-b border-r border-slate-300 text-center`}
              >
                工作天
              </th>
              <th
                rowSpan={2}
                style={!compactSticky ? { left: 648 } : undefined}
                className={`${
                  !compactSticky ? headerStickyBase : 'sticky z-30'
                } top-0 w-[48px] min-w-[48px] max-w-[48px] bg-slate-100 text-slate-800 font-semibold border-b border-r border-slate-300 text-center`}
              >
                狀態
              </th>
              <th
                rowSpan={2}
                style={!compactSticky ? { left: 696 } : undefined}
                className={`${
                  !compactSticky
                    ? `${headerStickyBase} shadow-[2px_0_5px_-2px_rgba(15,23,42,0.18)]`
                    : 'sticky z-30'
                } top-0 w-[66px] min-w-[66px] max-w-[66px] bg-slate-100 text-slate-800 font-semibold border-b border-r border-slate-400 text-center`}
              >
                排程
              </th>

              {/* Month Spans */}
              {monthSpans.map((mSpan) => (
                <th
                  key={mSpan.key}
                  colSpan={mSpan.daysCount}
                  className="sticky top-0 z-30 h-8 bg-slate-100 text-blue-800 font-bold text-sm border-b border-r border-slate-300 text-center px-2 tabular-nums"
                >
                  {mSpan.month}月{' '}
                  <span className="text-[11px] font-normal text-slate-500 ml-1">
                    Q{mSpan.quarter}
                  </span>
                </th>
              ))}
            </tr>

            {/* Header Row 2: Individual Calendar Day Numbers */}
            <tr className="h-7">
              {calendarDays.map((day, idx) => {
                const holiday = holidayMap.get(day.dateStr);
                const isToday = day.dateStr === referenceToday;
                const isMonthEnd =
                  idx === calendarDays.length - 1 ||
                  calendarDays[idx + 1].month !== day.month;

                let dayBg = 'bg-white text-slate-700 hover:bg-slate-100';
                let typeLabel = '';
                if (holiday?.type === 'makeup_workday') {
                  dayBg = 'bg-teal-300 text-teal-950 font-bold';
                  typeLabel = '調班工作天';
                } else if (holiday?.type === 'event') {
                  dayBg = 'bg-indigo-300 text-indigo-950 font-bold';
                  typeLabel = '展覽/活動';
                } else if (holiday?.type === 'factory_off') {
                  dayBg = 'bg-orange-300 text-orange-950 font-bold';
                  typeLabel = '廠休/盤點';
                } else if (holiday?.type === 'holiday') {
                  dayBg = classicColors
                    ? 'bg-[#ffff00] text-slate-950 font-bold'
                    : 'bg-amber-200 text-amber-950 font-bold';
                  typeLabel = '國定假日';
                } else if (day.isWeekend) {
                  dayBg = classicColors
                    ? 'bg-[#e9b8ff] text-purple-950 font-medium'
                    : 'bg-slate-200/80 text-slate-600';
                }

                return (
                  <th
                    key={day.dateStr}
                    onClick={() => {
                      if (!isEditable) {
                        onProtectedNotice?.('目前為唯讀鎖定狀態，無法修改行事曆標記');
                        return;
                      }
                      onToggleHolidayDate(day.dateStr);
                    }}
                    onMouseEnter={() =>
                      setHoverDateInfo(
                        `${day.dateStr} (週${['日', '一', '二', '三', '四', '五', '六'][day.dayOfWeek]})${
                          holiday ? ` · [${typeLabel}] ${holiday.name}` : ''
                        }${isEditable ? ' — 點擊標題可快速切換廠休/調班' : '（唯讀鎖定）'}`
                      )
                    }
                    title={
                      holiday
                        ? `${day.dateStr} [${typeLabel}] ${holiday.name}${isEditable ? '（點擊切換/移除）' : '（唯讀）'}`
                        : `${day.dateStr}${isEditable ? '（點擊切換為廠休或調班工作天）' : '（唯讀）'}`
                    }
                    className={`sticky top-8 z-30 w-[26px] min-w-[26px] max-w-[26px] border-b ${
                      isMonthEnd ? 'border-r-slate-400' : 'border-r-slate-200'
                    } border-r text-center font-mono text-[11px] tabular-nums ${
                      isEditable ? 'cursor-pointer' : 'cursor-default'
                    } transition-colors ${dayBg} ${
                      isToday ? 'ring-2 ring-inset ring-blue-600' : ''
                    }`}
                  >
                    {day.day}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {projects.map((project) => {
              const totalSubRows = Math.max(project.tasks.length * 2, 2);

              return project.tasks.map((task, taskIdx) => {
                const isFirstTask = taskIdx === 0;
                const isLastTask = taskIdx === project.tasks.length - 1;
                const isPilotTask = getTaskCategory(task) === 'pilot';
                const plannedDays = computePlannedWorkingDays(task, holidayMap);
                const actualDays = computeActualWorkingDays(task, holidayMap);
                const effectiveActualRange = getEffectiveActualRangeDisplay(task);
                const warningInfo = isTaskDelayedOrWarning(
                  task,
                  referenceToday,
                  holidayMap
                );

                const isOverdueStart =
                  !task.completed &&
                  Boolean(task.plannedStart) &&
                  !effectiveActualRange.start &&
                  task.plannedStart <= referenceToday;

                const hasActualActivity = Boolean(
                  effectiveActualRange.start || actualDays > 0
                );
                const bottomProjectBorder = isLastTask
                  ? 'border-b-slate-400'
                  : 'border-b-slate-300';

                return (
                  <React.Fragment key={task.id}>
                    {/* SUB-ROW 1: 預計 (PLANNED) */}
                    <tr className="h-[26px] group">
                      {isFirstTask && (
                        <>
                          {/* Col 1: 序號 */}
                          <td
                            rowSpan={totalSubRows}
                            style={{ left: 0 }}
                            className={`${stickyBase} bg-white group-hover:bg-slate-50/90 border-b border-b-slate-400 border-r border-slate-300 text-center font-mono text-xs font-semibold text-slate-700 tabular-nums align-middle`}
                          >
                            {project.seqNo}
                          </td>

                          {/* Col 2: 機種名稱 */}
                          <td
                            rowSpan={totalSubRows}
                            style={{ left: 44 }}
                            className={`${stickyBase} bg-white group-hover:bg-slate-50/90 border-b border-b-slate-400 border-r border-slate-300 px-2 py-1.5 text-center align-middle`}
                          >
                            <div className="flex flex-col items-center justify-center gap-0.5">
                              {isEditable ? (
                                <button
                                  type="button"
                                  onClick={() => onEditProject(project)}
                                  className="font-mono font-bold text-blue-700 hover:text-blue-900 hover:underline leading-tight break-all text-center"
                                  title="點擊編輯機種資訊與階段任務列表"
                                >
                                  {project.modelName}
                                </button>
                              ) : (
                                <span className="font-mono font-bold text-blue-700 leading-tight break-all text-center">
                                  {project.modelName}
                                </span>
                              )}
                              {project.modelSubtitle && (
                                <span className="text-[11px] text-blue-600/90 leading-tight">
                                  {project.modelSubtitle}
                                </span>
                              )}
                              {(project.ee || project.me) && (
                                <div className="text-[10px] text-slate-500 mt-0.5 flex flex-wrap items-center justify-center gap-x-1.5">
                                  {project.ee && <span>EE:{project.ee}</span>}
                                  {project.me && <span>ME:{project.me}</span>}
                                </div>
                              )}

                              {isEditable && (
                                <div className="flex items-center gap-1.5 mt-1 opacity-75 hover:opacity-100">
                                  <button
                                    type="button"
                                    onClick={() => onAddTaskToProject(project)}
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                                    title="在此機種下新增階段任務"
                                  >
                                    <Plus className="w-2.5 h-2.5" />
                                    任務
                                  </button>
                                  {confirmDeleteProjId === project.id ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onDeleteProject(project.id);
                                        setConfirmDeleteProjId(null);
                                      }}
                                      onMouseLeave={() => setConfirmDeleteProjId(null)}
                                      className="px-1.5 py-0.5 text-[10px] font-medium text-white bg-rose-600 rounded"
                                    >
                                      確認刪除
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteProjId(project.id)}
                                      className="p-0.5 text-slate-400 hover:text-rose-600 rounded transition-colors"
                                      title="刪除此機種"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </>
                      )}

                      {/* Col 3: 任務名稱 (rowSpan=2) */}
                      <td
                        rowSpan={2}
                        style={{ left: 188 }}
                        onClick={() => isEditable && onEditTask(project, task)}
                        className={`${stickyBase} ${
                          task.completed
                            ? classicColors
                              ? 'bg-[#00ff00] text-slate-950'
                              : 'bg-emerald-100 text-emerald-950'
                            : isEditable
                            ? 'bg-white text-slate-800 hover:bg-slate-50'
                            : 'bg-white text-slate-800'
                        } border-b ${bottomProjectBorder} border-r border-slate-300 px-2 py-1 text-center font-semibold ${
                          isEditable ? 'cursor-pointer' : 'cursor-default'
                        } align-middle transition-colors ${
                          compactSticky ? 'shadow-[2px_0_5px_-2px_rgba(15,23,42,0.18)]' : ''
                        }`}
                        title={isEditable ? '點擊編輯任務排程與備註' : '唯讀檢視'}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span className="leading-snug">{task.taskName || '未命名任務'}</span>
                          {isEditable && (
                            <Edit3 className="w-3 h-3 opacity-0 group-hover:opacity-60 shrink-0" />
                          )}
                        </div>
                      </td>

                      {/* Col 4: PCB數量 / 試產備註 */}
                      {task.pcbMode === 'note' ? (
                        <td
                          rowSpan={2}
                          style={!compactSticky ? { left: 320 } : undefined}
                          onClick={() => isEditable && onEditTask(project, task)}
                          className={`${
                            !compactSticky ? stickyBase : ''
                          } bg-white ${
                            isEditable ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'
                          } border-b ${bottomProjectBorder} border-r border-slate-300 px-1.5 py-1 text-center font-semibold text-purple-800 leading-tight align-middle`}
                          title={isEditable ? '點擊修改試產規格備註' : '試產規格備註（唯讀）'}
                        >
                          {task.pilotNote || <span className="text-slate-300">—</span>}
                        </td>
                      ) : (
                        <td
                          style={!compactSticky ? { left: 320 } : undefined}
                          onClick={() => isEditable && onEditTask(project, task)}
                          className={`${
                            !compactSticky ? stickyBase : ''
                          } bg-white ${
                            isEditable ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'
                          } border-b border-slate-200 border-r border-slate-300 px-1 text-center font-mono font-semibold text-slate-900 tabular-nums`}
                          title={isEditable ? '預計 PCB 數量（點擊編輯）' : '預計 PCB 數量（唯讀）'}
                        >
                          {task.plannedQty ?? ''}
                        </td>
                      )}

                      {/* Col 5: 完成 Checkbox (rowSpan=2) */}
                      <td
                        rowSpan={2}
                        style={!compactSticky ? { left: 412 } : undefined}
                        className={`${
                          !compactSticky ? stickyBase : ''
                        } bg-white border-b ${bottomProjectBorder} border-r border-slate-300 text-center align-middle`}
                      >
                        <button
                          type="button"
                          disabled={!isEditable}
                          onClick={() => isEditable && onToggleTaskCompleted(project.id, task.id)}
                          className={`inline-flex items-center justify-center p-1 rounded transition-colors ${
                            isEditable
                              ? 'hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-900 cursor-pointer'
                              : 'opacity-80 cursor-default'
                          }`}
                          aria-label={task.completed ? '標記為未完成' : '標記為已完成'}
                        >
                          {task.completed ? (
                            <CheckSquare className="w-4 h-4 text-purple-800 fill-purple-100" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500" />
                          )}
                        </button>
                      </td>

                      {/* Col 6: 預計開始 */}
                      <td
                        style={!compactSticky ? { left: 456 } : undefined}
                        onClick={() => isEditable && onEditTask(project, task)}
                        className={`${!compactSticky ? stickyBase : ''} ${
                          isOverdueStart
                            ? 'bg-rose-100 text-rose-800 font-semibold'
                            : isEditable
                            ? 'bg-white text-slate-600 hover:bg-slate-50'
                            : 'bg-white text-slate-600'
                        } border-b border-slate-200 border-r border-slate-200 px-1 text-center font-mono text-[11px] tabular-nums ${
                          isEditable ? 'cursor-pointer' : 'cursor-default'
                        } whitespace-nowrap`}
                        title={
                          isOverdueStart
                            ? '警示：已達預計開始日但尚未填寫實際開始日'
                            : isEditable
                            ? '點擊設定預計開始日'
                            : '預計開始日（唯讀）'
                        }
                      >
                        {formatChineseShortDate(task.plannedStart)}
                      </td>

                      {/* Col 7: 預計結束 */}
                      <td
                        style={!compactSticky ? { left: 526 } : undefined}
                        onClick={() => isEditable && onEditTask(project, task)}
                        className={`${
                          !compactSticky ? stickyBase : ''
                        } bg-white ${
                          isEditable ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'
                        } text-slate-600 border-b border-slate-200 border-r border-slate-300 px-1 text-center font-mono text-[11px] tabular-nums whitespace-nowrap`}
                        title={isEditable ? '點擊設定預計結束日' : '預計結束日（唯讀）'}
                      >
                        {formatChineseShortDate(task.plannedEnd)}
                      </td>

                      {/* Col 8: 預計工作天 */}
                      <td
                        style={!compactSticky ? { left: 596 } : undefined}
                        onClick={() => isEditable && onEditTask(project, task)}
                        className={`${
                          !compactSticky ? stickyBase : ''
                        } bg-white ${
                          isEditable ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'
                        } text-pink-600 font-mono font-semibold border-b border-slate-200 border-r border-slate-300 text-center tabular-nums`}
                        title="預計工作天（自動扣除週末與廠休假日）"
                      >
                        {plannedDays}
                      </td>

                      {/* Col 9: 狀態 (rowSpan=2) */}
                      <td
                        rowSpan={2}
                        style={!compactSticky ? { left: 648 } : undefined}
                        onClick={() => isEditable && onCycleTaskStatus(project.id, task.id)}
                        className={`${!compactSticky ? stickyBase : ''} ${getStatusStyle(
                          task.status
                        )} border-b ${bottomProjectBorder} border-r border-slate-300 text-center font-mono text-sm font-bold ${
                          isEditable ? 'cursor-pointer hover:brightness-95' : 'cursor-default'
                        } align-middle transition-all`}
                        title={
                          isEditable
                            ? '點擊切換狀態：O (待結案) → C (已結案) → NA (免評)'
                            : '任務狀態（唯讀）'
                        }
                      >
                        <div className="flex flex-col items-center justify-center">
                          <span>{task.status}</span>
                          {warningInfo.isWarning && task.status === 'O' && (
                            <AlertTriangle
                              className="w-3 h-3 text-rose-600 mt-0.5"
                              aria-label={warningInfo.reason}
                            />
                          )}
                        </div>
                      </td>

                      {/* Col 10: 排程 (預計 ▶) */}
                      <td
                        style={!compactSticky ? { left: 696 } : undefined}
                        className={`${
                          !compactSticky
                            ? `${stickyBase} shadow-[2px_0_5px_-2px_rgba(15,23,42,0.18)]`
                            : ''
                        } ${
                          isPilotTask
                            ? 'bg-purple-50 text-purple-800'
                            : task.status === 'O'
                            ? 'bg-orange-50 text-rose-700'
                            : 'bg-slate-50 text-slate-600'
                        } border-b border-slate-200 border-r border-slate-400 px-1.5 text-center font-semibold whitespace-nowrap`}
                      >
                        預計 <span className="text-[9px] opacity-75">▶</span>
                      </td>

                      {/* GANTT CELLS: PLANNED ROW */}
                      {calendarDays.map((day, idx) => {
                        const seg = getPlannedCellState(day.dateStr, task);
                        const calEntry = holidayMap.get(day.dateStr);
                        const isMonthEnd =
                          idx === calendarDays.length - 1 ||
                          calendarDays[idx + 1].month !== day.month;
                        const isAnchor =
                          pendingRange?.projectId === project.id &&
                          pendingRange?.taskId === task.id &&
                          pendingRange?.rowType === 'planned' &&
                          pendingRange?.anchorDate === day.dateStr;

                        let cellClass = isPilotTask
                          ? 'bg-white hover:bg-purple-50/70'
                          : 'bg-white hover:bg-amber-50/60';

                        if (seg === 'single' || seg === 'start' || seg === 'end') {
                          cellClass = isPilotTask
                            ? 'bg-[#a855f7] border-y-2 border-y-[#9333ea]'
                            : 'bg-amber-400 border-y-2 border-y-amber-500';
                        } else if (seg === 'middle') {
                          cellClass = isPilotTask
                            ? 'bg-[#a855f7]/50 border-y-2 border-y-[#9333ea]'
                            : 'bg-amber-400/50 border-y-2 border-y-amber-500';
                        } else if (calEntry?.type === 'makeup_workday') {
                          cellClass = 'bg-teal-50/60 hover:bg-teal-100/50';
                        } else if (calEntry?.type === 'event') {
                          cellClass = 'bg-indigo-50/60 hover:bg-indigo-100/50';
                        } else if (calEntry?.type === 'factory_off') {
                          cellClass = 'bg-orange-50/50 hover:bg-orange-100/50';
                        } else if (calEntry?.type === 'holiday') {
                          cellClass = 'bg-amber-50/35 hover:bg-amber-100/50';
                        } else if (day.isWeekend) {
                          cellClass = 'bg-slate-50/70 hover:bg-slate-100';
                        }

                        return (
                          <td
                            key={day.dateStr}
                            onMouseDown={() =>
                              handleGanttMouseDown(project, task, 'planned', day)
                            }
                            onMouseEnter={() =>
                              handleGanttMouseEnter(project, task, 'planned', day)
                            }
                            className={`w-[26px] min-w-[26px] max-w-[26px] border-b border-b-slate-100 ${
                              isMonthEnd ? 'border-r-slate-400' : 'border-r-slate-100'
                            } border-r ${
                              isEditable ? 'cursor-pointer' : 'cursor-default'
                            } transition-colors ${cellClass} ${
                              isAnchor
                                ? isPilotTask
                                  ? 'ring-2 ring-inset ring-purple-900'
                                  : 'ring-2 ring-inset ring-amber-700'
                                : ''
                            }`}
                          />
                        );
                      })}
                    </tr>

                    {/* SUB-ROW 2: 實際 (ACTUAL) */}
                    <tr className="h-[26px] group">
                      {/* Col 4 (Actual PCB Qty, only rendered when pcbMode === 'qty') */}
                      {task.pcbMode === 'qty' && (
                        <td
                          style={!compactSticky ? { left: 320 } : undefined}
                          onClick={() => isEditable && onEditTask(project, task)}
                          className={`${!compactSticky ? stickyBase : ''} ${
                            classicColors ? 'bg-[#8ef2d4]' : 'bg-teal-50'
                          } ${
                            isEditable ? 'hover:brightness-95 cursor-pointer' : 'cursor-default'
                          } border-b ${bottomProjectBorder} border-r border-slate-300 px-1 text-center font-mono font-semibold text-slate-900 tabular-nums`}
                          title={isEditable ? '實際完成 PCB 數量（點擊編輯）' : '實際完成 PCB 數量（唯讀）'}
                        >
                          {task.actualQty ?? ''}
                        </td>
                      )}

                      {/* Col 6: 實際開始 */}
                      <td
                        style={!compactSticky ? { left: 456 } : undefined}
                        onClick={() => isEditable && onEditTask(project, task)}
                        className={`${!compactSticky ? stickyBase : ''} ${
                          hasActualActivity
                            ? isPilotTask
                              ? 'bg-sky-100 text-sky-900'
                              : classicColors
                              ? 'bg-[#8ef2d4] text-blue-800'
                              : 'bg-teal-50/80 text-blue-800'
                            : 'bg-white text-slate-500'
                        } ${
                          isEditable ? 'hover:brightness-95 cursor-pointer' : 'cursor-default'
                        } border-b ${bottomProjectBorder} border-r border-slate-200 px-1 text-center font-mono text-[11px] font-medium tabular-nums whitespace-nowrap`}
                        title={isEditable ? '點擊設定實際開始日' : '實際開始日（唯讀）'}
                      >
                        {formatChineseShortDate(effectiveActualRange.start)}
                      </td>

                      {/* Col 7: 實際結束 */}
                      <td
                        style={!compactSticky ? { left: 526 } : undefined}
                        onClick={() => isEditable && onEditTask(project, task)}
                        className={`${!compactSticky ? stickyBase : ''} ${
                          hasActualActivity
                            ? isPilotTask
                              ? 'bg-sky-100 text-sky-900'
                              : classicColors
                              ? 'bg-[#8ef2d4] text-blue-800'
                              : 'bg-teal-50/80 text-blue-800'
                            : 'bg-white text-slate-500'
                        } ${
                          isEditable ? 'hover:brightness-95 cursor-pointer' : 'cursor-default'
                        } border-b ${bottomProjectBorder} border-r border-slate-300 px-1 text-center font-mono text-[11px] font-medium tabular-nums whitespace-nowrap`}
                        title={isEditable ? '點擊設定實際結束日' : '實際結束日（唯讀）'}
                      >
                        {formatChineseShortDate(effectiveActualRange.end)}
                      </td>

                      {/* Col 8: 實際工作天 */}
                      <td
                        style={!compactSticky ? { left: 596 } : undefined}
                        onClick={() => isEditable && onEditTask(project, task)}
                        className={`${!compactSticky ? stickyBase : ''} ${
                          hasActualActivity
                            ? isPilotTask
                              ? 'bg-sky-100'
                              : classicColors
                              ? 'bg-[#8ef2d4]'
                              : 'bg-teal-50/80'
                            : 'bg-pink-50/60'
                        } ${
                          isEditable ? 'cursor-pointer' : 'cursor-default'
                        } text-pink-700 font-mono font-semibold border-b ${bottomProjectBorder} border-r border-slate-300 text-center tabular-nums`}
                        title="實際累計工作天"
                      >
                        {actualDays}
                      </td>

                      {/* Col 10: 排程 (實際 ▶) */}
                      <td
                        style={!compactSticky ? { left: 696 } : undefined}
                        className={`${
                          !compactSticky
                            ? `${stickyBase} shadow-[2px_0_5px_-2px_rgba(15,23,42,0.18)]`
                            : ''
                        } ${
                          hasActualActivity
                            ? isPilotTask
                              ? 'bg-sky-200 text-sky-950'
                              : classicColors
                              ? 'bg-[#8ef2d4] text-slate-950'
                              : 'bg-emerald-100/80 text-slate-900'
                            : 'bg-slate-100 text-slate-800'
                        } border-b ${bottomProjectBorder} border-r border-slate-400 px-1.5 text-center font-bold whitespace-nowrap`}
                      >
                        實際 <span className="text-[9px]">▶</span>
                      </td>

                      {/* GANTT CELLS: ACTUAL ROW */}
                      {calendarDays.map((day, idx) => {
                        const aState = getActualCellState(day, task, holidayMap);
                        const calEntry = holidayMap.get(day.dateStr);
                        const isMonthEnd =
                          idx === calendarDays.length - 1 ||
                          calendarDays[idx + 1].month !== day.month;
                        const override = task.dailyOverrides?.[day.dateStr];
                        const isAnchor =
                          pendingRange?.projectId === project.id &&
                          pendingRange?.taskId === task.id &&
                          pendingRange?.rowType === 'actual' &&
                          pendingRange?.anchorDate === day.dateStr;

                        let cellBg = isPilotTask
                          ? 'bg-white hover:bg-sky-100/70'
                          : 'bg-white hover:bg-emerald-50/60';

                        if (aState === 'pilot_blue') {
                          cellBg = classicColors
                            ? 'bg-[#38bdf8] hover:brightness-95'
                            : 'bg-sky-400 hover:bg-sky-500';
                        } else if (aState === 'on_time') {
                          cellBg = classicColors
                            ? 'bg-[#16e016] hover:brightness-95'
                            : 'bg-emerald-500 hover:bg-emerald-600';
                        } else if (aState === 'delay') {
                          cellBg = classicColors
                            ? 'bg-[#f40058] hover:brightness-95'
                            : 'bg-rose-500 hover:bg-rose-600';
                        } else if (aState === 'non_working_span') {
                          cellBg = 'bg-slate-300/90';
                        } else if (aState === 'pause') {
                          cellBg = 'bg-slate-100';
                        } else if (calEntry?.type === 'makeup_workday') {
                          cellBg = 'bg-teal-50/60 hover:bg-teal-100/50';
                        } else if (calEntry?.type === 'event') {
                          cellBg = 'bg-indigo-50/60 hover:bg-indigo-100/50';
                        } else if (calEntry?.type === 'factory_off') {
                          cellBg = 'bg-orange-50/50 hover:bg-orange-100/50';
                        } else if (calEntry?.type === 'holiday') {
                          cellBg = 'bg-amber-50/35 hover:bg-sky-50';
                        } else if (day.isWeekend) {
                          cellBg = 'bg-slate-50/70 hover:bg-sky-50';
                        }

                        return (
                          <td
                            key={day.dateStr}
                            onMouseDown={() =>
                              handleGanttMouseDown(project, task, 'actual', day)
                            }
                            onMouseEnter={() =>
                              handleGanttMouseEnter(project, task, 'actual', day)
                            }
                            className={`w-[26px] min-w-[26px] max-w-[26px] border-b ${bottomProjectBorder} ${
                              isMonthEnd ? 'border-r-slate-400' : 'border-r-slate-100'
                            } border-r ${
                              isEditable ? 'cursor-pointer' : 'cursor-default'
                            } transition-colors ${cellBg} ${
                              isAnchor ? 'ring-2 ring-inset ring-emerald-900' : ''
                            }`}
                          />
                        );
                      })}
                    </tr>
                  </React.Fragment>
                );
              });
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
