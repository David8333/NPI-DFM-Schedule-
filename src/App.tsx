import React, { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Plus,
  Search,
  Columns3,
  Palette,
  Check,
  CalendarRange,
} from 'lucide-react';
import {
  DailyOverrideType,
  ExportOptions,
  HolidayItem,
  ProjectModel,
  ProjectStage,
  ScheduleTask,
  TaskStatus,
} from './types/schedule';
import {
  DEFAULT_REFERENCE_TODAY,
  INITIAL_HOLIDAYS,
  INITIAL_PROJECTS,
} from './data/initialData';
import {
  buildHolidayMap,
  computeActualWorkingDays,
  computePlannedWorkingDays,
  isTaskDelayedOrWarning,
} from './utils/dateUtils';
import { exportScheduleToExcel } from './utils/excelExport';
import { GanttClickMode, ScheduleGrid } from './components/ScheduleGrid';
import { TaskEditModal } from './components/TaskEditModal';
import { ProjectFormModal } from './components/ProjectFormModal';
import { AnalyticsView } from './components/AnalyticsView';
import { HolidayCalendarView } from './components/HolidayCalendarView';
import { ExportBackupView } from './components/ExportBackupView';
import { WeeklyDfmStatsPanel } from './components/WeeklyDfmStatsPanel';

type ActiveTab = 'schedule' | 'analytics' | 'holidays' | 'export';

const STORAGE_KEY_PROJECTS = 'npi_schedule_projects_v2';
const STORAGE_KEY_HOLIDAYS = 'npi_schedule_holidays_v2';

const normalizeProjects = (list: unknown[]): ProjectModel[] => {
  return list.map((item) => {
    const raw = item as ProjectModel & { pm?: string };
    return {
      ...raw,
      ee: raw.ee ?? raw.pm ?? '',
      me: raw.me ?? '',
      tasks: Array.isArray(raw.tasks)
        ? raw.tasks.map((t) => {
            const rawStage = String(t.stage || 'OTHER');
            const stage: ProjectStage =
              rawStage === 'PVT' ? 'MVT' : (rawStage as ProjectStage);
            const taskName =
              rawStage === 'PVT' && typeof t.taskName === 'string'
                ? t.taskName.replace(/^PVT/i, 'MVT')
                : t.taskName;
            return { ...t, stage, taskName };
          })
        : [],
    };
  });
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('schedule');

  const [projects, setProjects] = useState<ProjectModel[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PROJECTS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return normalizeProjects(parsed);
        }
      }
    } catch {
      // ignore storage errors
    }
    return INITIAL_PROJECTS;
  });

  const [holidays, setHolidays] = useState<HolidayItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_HOLIDAYS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return INITIAL_HOLIDAYS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
    } catch {
      // ignore quota errors
    }
  }, [projects]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_HOLIDAYS, JSON.stringify(holidays));
    } catch {
      // ignore quota errors
    }
  }, [holidays]);

  // Filters & View Controls
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<'ALL' | ProjectStage>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | TaskStatus>('ALL');
  const [startDate, setStartDate] = useState('2026-07-01');
  const [endDate, setEndDate] = useState('2026-09-30');
  const [calendarYear, setCalendarYear] = useState(2026);
  const [referenceToday, setReferenceToday] = useState(DEFAULT_REFERENCE_TODAY);
  const [ganttClickMode, setGanttClickMode] = useState<GanttClickMode>('auto_paint');
  const [compactSticky, setCompactSticky] = useState(false);
  const [classicColors, setClassicColors] = useState(true);
  const [showInlineWeeklyDfm, setShowInlineWeeklyDfm] = useState(false);

  // Modals & Toast
  const [editingTaskTarget, setEditingTaskTarget] = useState<{
    project: ProjectModel;
    task: ScheduleTask;
  } | null>(null);
  const [projectModalState, setProjectModalState] = useState<{
    open: boolean;
    project: ProjectModel | null;
  }>({ open: false, project: null });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isQuickExporting, setIsQuickExporting] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  // Filtered projects & tasks
  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects
      .map((proj) => {
        const matchesProjectText =
          !q ||
          proj.modelName.toLowerCase().includes(q) ||
          (proj.modelSubtitle?.toLowerCase().includes(q) ?? false) ||
          (proj.customer?.toLowerCase().includes(q) ?? false) ||
          (proj.ee?.toLowerCase().includes(q) ?? false) ||
          (proj.me?.toLowerCase().includes(q) ?? false) ||
          String(proj.seqNo).includes(q);

        const matchingTasks = proj.tasks.filter((task) => {
          const matchesTaskText =
            matchesProjectText ||
            task.taskName.toLowerCase().includes(q) ||
            task.pilotNote.toLowerCase().includes(q) ||
            (task.owner?.toLowerCase().includes(q) ?? false);
          const matchesStage = stageFilter === 'ALL' || task.stage === stageFilter;
          const matchesStatus = statusFilter === 'ALL' || task.status === statusFilter;
          return matchesTaskText && matchesStage && matchesStatus;
        });

        if (matchingTasks.length === 0) return null;
        return {
          ...proj,
          tasks: matchingTasks,
        };
      })
      .filter((p): p is ProjectModel => p !== null)
      .sort((a, b) => a.seqNo - b.seqNo);
  }, [projects, searchQuery, stageFilter, statusFilter]);

  const summaryStats = useMemo(() => {
    const holidayMap = buildHolidayMap(holidays);
    let totalTasks = 0;
    let openCount = 0;
    let completedCount = 0;
    let warningCount = 0;
    let plannedDaysTotal = 0;
    let actualDaysTotal = 0;

    for (const p of filteredProjects) {
      for (const t of p.tasks) {
        totalTasks++;
        if (t.status === 'O') openCount++;
        if (t.completed) completedCount++;
        if (isTaskDelayedOrWarning(t, referenceToday, holidayMap).isWarning) {
          warningCount++;
        }
        plannedDaysTotal += computePlannedWorkingDays(t, holidayMap);
        actualDaysTotal += computeActualWorkingDays(t, holidayMap);
      }
    }

    return {
      modelCount: filteredProjects.length,
      totalTasks,
      openCount,
      completedCount,
      warningCount,
      plannedDaysTotal,
      actualDaysTotal,
    };
  }, [filteredProjects, holidays, referenceToday]);

  const handleToggleTaskCompleted = (projectId: string, taskId: string) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          tasks: p.tasks.map((t) =>
            t.id === taskId ? { ...t, completed: !t.completed } : t
          ),
        };
      })
    );
  };

  const handleCycleTaskStatus = (projectId: string, taskId: string) => {
    const order: TaskStatus[] = ['O', 'C', 'NA'];
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          tasks: p.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const nextStatus = order[(order.indexOf(t.status) + 1) % order.length];
            return { ...t, status: nextStatus };
          }),
        };
      })
    );
  };

  const handleSaveTask = (projectId: string, updatedTask: ScheduleTask) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        const exists = p.tasks.some((t) => t.id === updatedTask.id);
        return {
          ...p,
          tasks: exists
            ? p.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t))
            : [...p.tasks, updatedTask],
        };
      })
    );
    showToast(`已更新任務「${updatedTask.taskName}」排程`);
  };

  const handleDeleteTask = (projectId: string, taskId: string) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          tasks: p.tasks.filter((t) => t.id !== taskId),
        };
      })
    );
    showToast('已刪除任務項目');
  };

  const handleAddTaskToProject = (project: ProjectModel) => {
    const newTask: ScheduleTask = {
      id: `task-${Date.now()}`,
      taskName: 'DVT DFM REVIEW',
      stage: 'DVT',
      taskCategory: 'dfm',
      pcbMode: 'qty',
      plannedQty: 4,
      actualQty: 0,
      pilotNote: '',
      completed: false,
      plannedStart: '',
      plannedEnd: '',
      actualStart: '',
      actualEnd: '',
      status: 'O',
    };
    setEditingTaskTarget({ project, task: newTask });
  };

  const handleSaveProject = (project: ProjectModel, isNew: boolean) => {
    setProjects((prev) => {
      if (isNew) {
        return [...prev, project].sort((a, b) => a.seqNo - b.seqNo);
      }
      return prev
        .map((p) => (p.id === project.id ? project : p))
        .sort((a, b) => a.seqNo - b.seqNo);
    });
    showToast(
      isNew
        ? `已新增機種「${project.modelName}」`
        : `已更新機種「${project.modelName}」與任務清單`
    );
  };

  const handleDeleteProject = (projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    showToast('已刪除機種專案');
  };

  const handleUpdateTaskDates = (
    projectId: string,
    taskId: string,
    field: 'planned' | 'actual',
    start: string,
    end: string
  ) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          tasks: p.tasks.map((t) => {
            if (t.id !== taskId) return t;
            return field === 'planned'
              ? { ...t, plannedStart: start, plannedEnd: end }
              : { ...t, actualStart: start, actualEnd: end };
          }),
        };
      })
    );
    showToast(
      `已設定${field === 'planned' ? '預計' : '實際'}區間：${start} ~ ${end}`
    );
  };

  const handleApplyDailyPaint = (
    projectId: string,
    taskId: string,
    dateStr: string,
    value: DailyOverrideType | 'clear'
  ) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          tasks: p.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const nextMap = { ...(t.dailyOverrides || {}) };
            const insideActualRange =
              Boolean(t.actualStart && t.actualEnd) &&
              dateStr >= t.actualStart &&
              dateStr <= t.actualEnd;

            if (value === 'clear') {
              if (insideActualRange) {
                nextMap[dateStr] = 'pause';
              } else {
                delete nextMap[dateStr];
              }
            } else {
              nextMap[dateStr] = value;
            }
            return { ...t, dailyOverrides: nextMap };
          }),
        };
      })
    );
  };

  const handleToggleHolidayDate = (dateStr: string) => {
    const exists = holidays.some((h) => h.date === dateStr);
    if (exists) {
      setHolidays((prev) => prev.filter((h) => h.date !== dateStr));
      showToast(`已取消 ${dateStr} 廠休/假日設定`);
    } else {
      setHolidays((prev) => [
        ...prev,
        { date: dateStr, name: '廠休 / 不計工時日', type: 'factory_off' },
      ]);
      showToast(`已將 ${dateStr} 標記為廠休假日，自動重算工作天`);
    }
  };

  const handleTriggerExcelExport = async (options: ExportOptions) => {
    const targetList = options.onlyFilteredRows ? filteredProjects : projects;
    await exportScheduleToExcel(targetList, holidays, options, referenceToday);
  };

  const handleQuickExcelExport = async () => {
    setIsQuickExporting(true);
    try {
      await exportScheduleToExcel(
        filteredProjects,
        holidays,
        {
          filename: `NPI_專案管理排程追控表_${startDate}_至_${endDate}`,
          startDate,
          endDate,
          theme: classicColors ? 'classic_npi' : 'modern_corp',
          includeSummarySheet: true,
          includeWeeklyDfmSheet: true,
          onlyFilteredRows: true,
        },
        referenceToday
      );
      showToast('已匯出 Excel (.xlsx) 排程追控報表（含每週 DFM 統計）');
    } finally {
      setIsQuickExporting(false);
    }
  };

  const nextSeqNo = useMemo(() => {
    if (projects.length === 0) return 1;
    return Math.max(...projects.map((p) => p.seqNo)) + 1;
  }, [projects]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8">
        <a
          href="#schedule"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('schedule');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          NPI 專案排程追控系統
        </a>

        <nav className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto">
          {(
            [
              { id: 'schedule', label: '排程總表' },
              { id: 'analytics', label: '進度與週報統計' },
              { id: 'holidays', label: '行事曆與假日' },
              { id: 'export', label: '匯出與備份' },
            ] as { id: ActiveTab; label: string }[]
          ).map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-slate-900 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            disabled={isQuickExporting}
            onClick={handleQuickExcelExport}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            {isQuickExporting ? '產生報表中...' : '匯出 Excel (.xlsx)'}
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Clean Unboxed Metadata & KPI Summary Strip */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 font-mono tabular-nums">
            <span>
              機種數 <strong className="text-slate-900">{summaryStats.modelCount}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>
              任務數 <strong className="text-slate-900">{summaryStats.totalTasks}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>
              已完成 <strong className="text-emerald-700">{summaryStats.completedCount}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>
              待結案(O) <strong className="text-rose-700">{summaryStats.openCount}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>
              預計/實際總工時{' '}
              <strong className="text-slate-900">
                {summaryStats.plannedDaysTotal} / {summaryStats.actualDaysTotal} 天
              </strong>
            </span>
            {summaryStats.warningCount > 0 && (
              <>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('analytics')}
                  className="text-rose-700 font-sans font-semibold hover:underline"
                >
                  延遲/超支預警 {summaryStats.warningCount} 項
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500">
            <button
              type="button"
              onClick={() => setShowInlineWeeklyDfm((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium transition-colors whitespace-nowrap ${
                showInlineWeeklyDfm
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              <CalendarRange className="w-3.5 h-3.5" />
              {showInlineWeeklyDfm ? '收合每週 DFM 統計' : '查看每週 DFM 統計'}
            </button>

            <div className="flex items-center gap-1.5">
              <label htmlFor="ref-today" className="whitespace-nowrap">
                追控基準日：
              </label>
              <input
                id="ref-today"
                type="date"
                value={referenceToday}
                onChange={(e) => setReferenceToday(e.target.value)}
                className="px-2 py-1 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-800"
              />
            </div>
          </div>
        </div>

        {/* Tab 1: Master Schedule & Gantt */}
        {activeTab === 'schedule' && (
          <div className="space-y-3">
            {showInlineWeeklyDfm && (
              <WeeklyDfmStatsPanel
                allProjects={projects}
                filteredProjects={filteredProjects}
                holidays={holidays}
                rangeStart={startDate}
                rangeEnd={endDate}
                compactHeader
              />
            )}

            {/* Workspace Toolbar */}
            <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
              {/* Row 1: Search, Stage Filter, Status Filter, Add Model */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
                  <div className="relative w-full sm:w-60">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="搜尋機種、任務、試產備註..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>

                  {/* Stage Segmented Filter */}
                  <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-md">
                    {(
                      [
                        { id: 'ALL', label: '全部階段' },
                        { id: 'PROTO', label: 'PROTO' },
                        { id: 'EVT', label: 'EVT' },
                        { id: 'DVT', label: 'DVT' },
                        { id: 'MVT', label: 'MVT' },
                        { id: 'MP', label: 'MP' },
                      ] as { id: 'ALL' | ProjectStage; label: string }[]
                    ).map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => setStageFilter(st.id)}
                        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                          stageFilter === st.id
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>

                  {/* Status Segmented Filter */}
                  <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-md">
                    {(
                      [
                        { id: 'ALL', label: '全部狀態' },
                        { id: 'O', label: 'O 待結案' },
                        { id: 'C', label: 'C 已結案' },
                        { id: 'NA', label: 'NA 免評' },
                      ] as { id: 'ALL' | TaskStatus; label: string }[]
                    ).map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => setStatusFilter(st.id)}
                        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                          statusFilter === st.id
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setProjectModalState({ open: true, project: null })}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  新增機種專案
                </button>
              </div>

              {/* Row 2: Calendar Window & View Toggles */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
                    日曆區間：
                  </span>
                  <select
                    value={calendarYear}
                    onChange={(e) => {
                      const nextYr = Number(e.target.value);
                      setCalendarYear(nextYr);
                      setStartDate((prev) => `${nextYr}${prev.slice(4)}`);
                      setEndDate((prev) => `${nextYr}${prev.slice(4)}`);
                    }}
                    className="px-2 py-1 text-xs font-mono font-semibold bg-white border border-slate-200 rounded text-slate-800"
                    aria-label="選擇日曆年份"
                  >
                    {[2024, 2025, 2026, 2027, 2028, 2029, 2030].map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}年
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
                    {[
                      { label: 'Q1', s: `${calendarYear}-01-01`, e: `${calendarYear}-03-31` },
                      { label: 'Q2', s: `${calendarYear}-04-01`, e: `${calendarYear}-06-30` },
                      { label: 'Q3', s: `${calendarYear}-07-01`, e: `${calendarYear}-09-30` },
                      { label: 'Q4', s: `${calendarYear}-10-01`, e: `${calendarYear}-12-31` },
                      { label: '上半年全覽', s: `${calendarYear}-01-01`, e: `${calendarYear}-06-30` },
                      { label: '下半年全覽', s: `${calendarYear}-07-01`, e: `${calendarYear}-12-31` },
                    ].map((preset) => {
                      const active = startDate === preset.s && endDate === preset.e;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setStartDate(preset.s);
                            setEndDate(preset.e);
                          }}
                          className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                            active
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-1.5 text-xs font-mono">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        const yr = Number(e.target.value.slice(0, 4));
                        if (Number.isFinite(yr) && yr >= 2000 && yr <= 2100) {
                          setCalendarYear(yr);
                        }
                      }}
                      className="px-2 py-1 border border-slate-200 rounded text-xs"
                    />
                    <span className="text-slate-400">~</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="px-2 py-1 border border-slate-200 rounded text-xs"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCompactSticky((v) => !v)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      compactSticky
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                    title="切換左側凍結欄位寬度"
                  >
                    <Columns3 className="w-3.5 h-3.5" />
                    精簡凍結欄
                  </button>

                  <button
                    type="button"
                    onClick={() => setClassicColors((v) => !v)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      classicColors
                        ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                    title="切換經典 Excel 高對比配色或柔和商務配色"
                  >
                    <Palette className="w-3.5 h-3.5" />
                    {classicColors ? '經典 Excel 配色' : '柔和商務配色'}
                  </button>
                </div>
              </div>

              {/* Row 3: Option B Direct Gantt Painting & Actual Working Day Recording Tools */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-700 mr-1 whitespace-nowrap">
                    甘特圖記錄筆刷：
                  </span>
                  {(
                    [
                      {
                        id: 'auto_paint',
                        label: '智慧塗色 (自動)',
                        dot: null,
                      },
                      {
                        id: 'paint_work',
                        label: '正常綠',
                        dot: 'bg-[#16e016]',
                      },
                      {
                        id: 'paint_delay',
                        label: '超期紅',
                        dot: 'bg-[#f40058]',
                      },
                      {
                        id: 'paint_pilot',
                        label: '試產確認',
                        dot: 'bg-[#38bdf8]',
                      },
                      {
                        id: 'paint_pause',
                        label: '停工灰',
                        dot: 'bg-slate-400',
                      },
                      {
                        id: 'paint_erase',
                        label: '清除格',
                        dot: 'bg-white border border-slate-400',
                      },
                      {
                        id: 'set_planned',
                        label: '兩點設預計區間',
                        dot: null,
                      },
                      {
                        id: 'inspect',
                        label: '點格開編輯視窗',
                        dot: null,
                      },
                    ] as { id: GanttClickMode; label: string; dot: string | null }[]
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setGanttClickMode(mode.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                        ganttClickMode === mode.id
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {mode.dot && (
                        <span className={`inline-block w-2.5 h-2.5 rounded-xs ${mode.dot}`} />
                      )}
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Main Schedule Grid */}
            <ScheduleGrid
              projects={filteredProjects}
              holidays={holidays}
              startDate={startDate}
              endDate={endDate}
              referenceToday={referenceToday}
              ganttClickMode={ganttClickMode}
              compactSticky={compactSticky}
              classicColors={classicColors}
              onToggleTaskCompleted={handleToggleTaskCompleted}
              onCycleTaskStatus={handleCycleTaskStatus}
              onEditProject={(proj) => setProjectModalState({ open: true, project: proj })}
              onAddTaskToProject={handleAddTaskToProject}
              onDeleteProject={handleDeleteProject}
              onEditTask={(project, task) => setEditingTaskTarget({ project, task })}
              onUpdateTaskDates={handleUpdateTaskDates}
              onApplyDailyPaint={handleApplyDailyPaint}
              onToggleHolidayDate={handleToggleHolidayDate}
            />
          </div>
        )}

        {/* Tab 2: Analytics & Weekly DFM Review Statistics */}
        {activeTab === 'analytics' && (
          <AnalyticsView
            allProjects={projects}
            projects={filteredProjects}
            holidays={holidays}
            startDate={startDate}
            endDate={endDate}
            referenceToday={referenceToday}
            onEditTask={(project, task) => setEditingTaskTarget({ project, task })}
          />
        )}

        {/* Tab 3: Working Calendar & Holidays */}
        {activeTab === 'holidays' && (
          <HolidayCalendarView
            holidays={holidays}
            onAddHoliday={(item) => {
              setHolidays((prev) => [
                ...prev.filter((h) => h.date !== item.date),
                item,
              ]);
              showToast(`已新增假日 ${item.date} (${item.name})`);
            }}
            onRemoveHoliday={(dateStr) => {
              setHolidays((prev) => prev.filter((h) => h.date !== dateStr));
              showToast(`已移除假日 ${dateStr}`);
            }}
          />
        )}

        {/* Tab 4: Excel Export Options & Backup */}
        {activeTab === 'export' && (
          <ExportBackupView
            allProjects={projects}
            filteredProjects={filteredProjects}
            holidays={holidays}
            defaultStartDate={startDate}
            defaultEndDate={endDate}
            onTriggerExcelExport={handleTriggerExcelExport}
            onImportBackupData={(importedProjects, importedHolidays) => {
              setProjects(normalizeProjects(importedProjects));
              if (importedHolidays) setHolidays(importedHolidays);
            }}
            onResetDefaultData={() => {
              setProjects(INITIAL_PROJECTS);
              setHolidays(INITIAL_HOLIDAYS);
            }}
          />
        )}
      </main>

      {/* Modals */}
      {editingTaskTarget && (
        <TaskEditModal
          project={editingTaskTarget.project}
          task={editingTaskTarget.task}
          holidays={holidays}
          onClose={() => setEditingTaskTarget(null)}
          onSave={handleSaveTask}
          onDeleteTask={handleDeleteTask}
        />
      )}

      {projectModalState.open && (
        <ProjectFormModal
          initialProject={projectModalState.project}
          nextSeqNo={nextSeqNo}
          onClose={() => setProjectModalState({ open: false, project: null })}
          onSaveProject={handleSaveProject}
        />
      )}

      {/* Subtle Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-xs font-medium rounded-lg shadow-lg">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
