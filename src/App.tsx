import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Plus,
  Search,
  Columns3,
  Palette,
  Check,
  CalendarRange,
  Undo2,
  FileSpreadsheet,
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
  INITIAL_HOLIDAYS,
  INITIAL_PROJECTS,
} from './data/initialData';
import {
  mergeTaiwanHolidays2023To2033,
  TAIWAN_HOLIDAY_YEARS,
} from './data/taiwanHolidays';
import {
  applySingleActualDateChange,
  buildDefaultExportFilename,
  buildHolidayMap,
  computeActualWorkingDaysInRange,
  computePlannedWorkingDaysInRange,
  computeTaskPcbQtyInRange,
  getLastWeekRange,
  getThisMonthRange,
  getThisWeekRange,
  getTodayISO,
  isTaskDelayedOrWarning,
} from './utils/dateUtils';
import {
  loadPersistedHolidays,
  loadPersistedProjects,
  requestPersistentStorage,
  savePersistedHolidays,
  savePersistedProjects,
  STORAGE_KEY_FACTORY_CLEANUP,
  STORAGE_KEY_HOLIDAYS,
  STORAGE_KEY_PROJECTS,
  STORAGE_KEY_SAMPLE_PROJECTS_CLEANUP,
  STORAGE_KEY_TW_SEED,
} from './utils/storage';
import { exportScheduleToExcel } from './utils/excelExport';
import {
  ExcelParseResult,
  parseScheduleFromExcelBuffer,
} from './utils/excelImport';
import { GanttClickMode, ScheduleGrid } from './components/ScheduleGrid';
import { TaskEditModal } from './components/TaskEditModal';
import { ProjectFormModal } from './components/ProjectFormModal';
import { ExcelImportModal, ExcelImportMode } from './components/ExcelImportModal';
import { AnalyticsView } from './components/AnalyticsView';
import { HolidayCalendarView } from './components/HolidayCalendarView';
import { ExportBackupView } from './components/ExportBackupView';
import { WeeklyDfmStatsPanel } from './components/WeeklyDfmStatsPanel';

type ActiveTab = 'schedule' | 'analytics' | 'holidays' | 'export';

const LEGACY_SAMPLE_FACTORY_OFF = new Set([
  '2026-08-07|廠區盤點調整日',
  '2026-08-10|產線歲修保養(一)',
  '2026-08-11|產線歲修保養(二)',
]);

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

const isUntouchedSampleProjects = (list: ProjectModel[]): boolean => {
  if (list.length !== INITIAL_PROJECTS.length) return false;
  return list.every((proj, idx) => {
    const sample = INITIAL_PROJECTS[idx];
    return (
      proj.id === sample.id &&
      proj.modelName === sample.modelName &&
      proj.tasks.length === sample.tasks.length &&
      proj.tasks.every(
        (t, tIdx) =>
          t.id === sample.tasks[tIdx].id && t.taskName === sample.tasks[tIdx].taskName
      )
    );
  });
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('schedule');

  const hasHydratedIdbRef = useRef(false);
  const hasUserMutatedProjectsRef = useRef(false);
  const hasUserMutatedHolidaysRef = useRef(false);
  const lastDragUndoRef = useRef(0);
  const shouldClearUntouchedSamplesOnIdbRef = useRef(false);

  const [projects, setProjects] = useState<ProjectModel[]>(() => {
    try {
      const cleanedDefaultSamples =
        localStorage.getItem(STORAGE_KEY_SAMPLE_PROJECTS_CLEANUP) === '1';
      if (!cleanedDefaultSamples) {
        shouldClearUntouchedSamplesOnIdbRef.current = true;
        localStorage.setItem(STORAGE_KEY_SAMPLE_PROJECTS_CLEANUP, '1');
      }
      const saved = localStorage.getItem(STORAGE_KEY_PROJECTS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const normalized = normalizeProjects(parsed);
          if (!cleanedDefaultSamples && isUntouchedSampleProjects(normalized)) {
            return [];
          }
          return normalized;
        }
      }
    } catch {
      // ignore storage errors; IndexedDB hydration runs on mount
    }
    return [];
  });

  const [holidays, setHolidays] = useState<HolidayItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_HOLIDAYS);
      const alreadySeeded = localStorage.getItem(STORAGE_KEY_TW_SEED) === '1';
      const cleanedSample = localStorage.getItem(STORAGE_KEY_FACTORY_CLEANUP) === '1';
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          let list: HolidayItem[] = parsed;
          if (!alreadySeeded) {
            localStorage.setItem(STORAGE_KEY_TW_SEED, '1');
            list = mergeTaiwanHolidays2023To2033(list);
          }
          if (!cleanedSample) {
            localStorage.setItem(STORAGE_KEY_FACTORY_CLEANUP, '1');
            list = list.filter(
              (h) => !LEGACY_SAMPLE_FACTORY_OFF.has(`${h.date}|${h.name}`)
            );
          }
          return list;
        }
      }
      localStorage.setItem(STORAGE_KEY_TW_SEED, '1');
      localStorage.setItem(STORAGE_KEY_FACTORY_CLEANUP, '1');
    } catch {
      // ignore storage errors; IndexedDB hydration runs on mount
    }
    return INITIAL_HOLIDAYS;
  });

  const [undoStack, setUndoStack] = useState<ProjectModel[][]>([]);

  // Hydrate from high-capacity IndexedDB & request persistent storage protection
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await requestPersistentStorage();
      const [idbProjects, idbHolidays] = await Promise.all([
        loadPersistedProjects(),
        loadPersistedHolidays(),
      ]);
      if (cancelled) return;

      if (!hasUserMutatedProjectsRef.current && Array.isArray(idbProjects)) {
        const normalized = normalizeProjects(idbProjects);
        if (
          shouldClearUntouchedSamplesOnIdbRef.current &&
          isUntouchedSampleProjects(normalized)
        ) {
          setProjects([]);
          savePersistedProjects([]);
        } else {
          setProjects(normalized);
        }
      }
      if (!hasUserMutatedHolidaysRef.current && Array.isArray(idbHolidays) && idbHolidays.length > 0) {
        const alreadySeeded = localStorage.getItem(STORAGE_KEY_TW_SEED) === '1';
        let list = idbHolidays;
        if (!alreadySeeded) {
          try {
            localStorage.setItem(STORAGE_KEY_TW_SEED, '1');
          } catch {
            // ignore
          }
          list = mergeTaiwanHolidays2023To2033(list);
        }
        setHolidays(list);
      }

      hasHydratedIdbRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filters & View Controls (defaults: current year full-year overview, all stages, all statuses, inspect safe mode)
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<'ALL' | ProjectStage>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | TaskStatus>('ALL');
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [startDate, setStartDate] = useState(
    () => `${new Date().getFullYear()}-01-01`
  );
  const [endDate, setEndDate] = useState(
    () => `${new Date().getFullYear()}-12-31`
  );
  const isAutoReferenceTodayRef = useRef(true);
  const [referenceToday, setReferenceToday] = useState(() => getTodayISO());
  const [ganttClickMode, setGanttClickMode] = useState<GanttClickMode>('inspect');
  const [isScheduleEditable, setIsScheduleEditable] = useState(true);
  const [isFullscreenSchedule, setIsFullscreenSchedule] = useState(false);
  const [compactSticky, setCompactSticky] = useState(false);
  const [classicColors, setClassicColors] = useState(true);
  const [showInlineWeeklyDfm, setShowInlineWeeklyDfm] = useState(false);

  // Keep 追控基準日 synchronized with the real current calendar date unless manually overridden
  useEffect(() => {
    const syncToday = () => {
      if (!isAutoReferenceTodayRef.current) return;
      const today = getTodayISO();
      setReferenceToday((prev) => (prev === today ? prev : today));
    };
    syncToday();
    window.addEventListener('focus', syncToday);
    document.addEventListener('visibilitychange', syncToday);
    const timer = window.setInterval(syncToday, 60_000);
    return () => {
      window.removeEventListener('focus', syncToday);
      document.removeEventListener('visibilitychange', syncToday);
      window.clearInterval(timer);
    };
  }, []);

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
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [isParsingExcel, setIsParsingExcel] = useState(false);
  const [excelImportModalState, setExcelImportModalState] = useState<{
    result: ExcelParseResult;
    buffer: ArrayBuffer;
    filename: string;
  } | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3400);
  }, []);

  // Save projects to IndexedDB (primary large-capacity store) + localStorage (fast cache)
  useEffect(() => {
    if (!hasHydratedIdbRef.current && !hasUserMutatedProjectsRef.current) return;
    let active = true;
    savePersistedProjects(projects).then(({ idbSaved, localSaved }) => {
      if (active && !idbSaved && !localSaved) {
        showToast('警告：瀏覽器本機儲存空間已滿或遭阻擋，請立即匯出 JSON 備份！');
      }
    });
    return () => {
      active = false;
    };
  }, [projects, showToast]);

  // Save holidays to IndexedDB + localStorage
  useEffect(() => {
    if (!hasHydratedIdbRef.current && !hasUserMutatedHolidaysRef.current) return;
    let active = true;
    savePersistedHolidays(holidays).then(({ idbSaved, localSaved }) => {
      if (active && !idbSaved && !localSaved) {
        showToast('警告：假日資料未能寫入本機儲存空間，請檢查瀏覽器權限');
      }
    });
    return () => {
      active = false;
    };
  }, [holidays, showToast]);

  const mutateProjects = useCallback(
    (
      updater: (prev: ProjectModel[]) => ProjectModel[],
      options?: { recordUndo?: boolean; groupDragUndo?: boolean }
    ) => {
      hasUserMutatedProjectsRef.current = true;
      const shouldRecord = options?.recordUndo !== false;
      setProjects((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        if (shouldRecord) {
          const now = Date.now();
          const shouldPush = options?.groupDragUndo
            ? now - lastDragUndoRef.current > 650
            : true;
          if (shouldPush) {
            if (options?.groupDragUndo) {
              lastDragUndoRef.current = now;
            }
            setUndoStack((stack) => [...stack.slice(-29), prev]);
          }
        }
        return next;
      });
    },
    []
  );

  const mutateHolidays = useCallback(
    (updater: (prev: HolidayItem[]) => HolidayItem[]) => {
      hasUserMutatedHolidaysRef.current = true;
      setHolidays(updater);
    },
    []
  );

  const handleUndo = useCallback(() => {
    if (!isScheduleEditable) {
      showToast('目前為唯讀鎖定狀態，請先解鎖編輯後再復原');
      return;
    }
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const previous = stack[stack.length - 1];
      hasUserMutatedProjectsRef.current = true;
      setProjects(previous);
      showToast('已復原上一步排程異動');
      return stack.slice(0, -1);
    });
  }, [isScheduleEditable, showToast]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT')
        ) {
          return;
        }
        if (undoStack.length > 0 && isScheduleEditable) {
          e.preventDefault();
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, undoStack.length, isScheduleEditable]);

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

  const holidayMap = useMemo(() => buildHolidayMap(holidays), [holidays]);

  const summaryStats = useMemo(() => {
    let totalTasks = 0;
    let openCount = 0;
    let completedCount = 0;
    let warningCount = 0;
    let plannedDaysTotal = 0;
    let actualDaysTotal = 0;
    let plannedPcbTotal = 0;
    let actualPcbTotal = 0;

    for (const p of filteredProjects) {
      for (const t of p.tasks) {
        totalTasks++;
        if (t.status === 'O') openCount++;
        if (t.completed) completedCount++;
        if (isTaskDelayedOrWarning(t, referenceToday, holidayMap).isWarning) {
          warningCount++;
        }
        plannedDaysTotal += computePlannedWorkingDaysInRange(
          t,
          holidayMap,
          startDate,
          endDate
        );
        actualDaysTotal += computeActualWorkingDaysInRange(
          t,
          holidayMap,
          startDate,
          endDate
        );
        const pcb = computeTaskPcbQtyInRange(t, holidayMap, startDate, endDate);
        plannedPcbTotal += pcb.plannedPcb;
        actualPcbTotal += pcb.actualPcb;
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
      plannedPcbTotal,
      actualPcbTotal,
    };
  }, [filteredProjects, holidayMap, referenceToday, startDate, endDate]);

  const handleToggleTaskCompleted = (projectId: string, taskId: string) => {
    mutateProjects((prev) =>
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
    mutateProjects((prev) =>
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
    mutateProjects((prev) =>
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
    mutateProjects((prev) =>
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
    mutateProjects((prev) => {
      if (isNew) {
        return [...prev, project].sort((a, b) => a.seqNo - b.seqNo);
      }
      return prev
        .map((p) => (p.id === project.id ? project : p))
        .sort((a, b) => a.seqNo - b.seqNo);
    });

    // Prevent newly added/saved projects from looking "lost" due to active filters
    let resetFiltersNotice = false;
    if (stageFilter !== 'ALL' && !project.tasks.some((t) => t.stage === stageFilter)) {
      setStageFilter('ALL');
      resetFiltersNotice = true;
    }
    if (statusFilter !== 'ALL' && !project.tasks.some((t) => t.status === statusFilter)) {
      setStatusFilter('ALL');
      resetFiltersNotice = true;
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const matchesProj =
        project.modelName.toLowerCase().includes(q) ||
        (project.modelSubtitle?.toLowerCase().includes(q) ?? false) ||
        (project.customer?.toLowerCase().includes(q) ?? false) ||
        (project.ee?.toLowerCase().includes(q) ?? false) ||
        (project.me?.toLowerCase().includes(q) ?? false) ||
        String(project.seqNo).includes(q) ||
        project.tasks.some(
          (t) =>
            t.taskName.toLowerCase().includes(q) ||
            t.pilotNote.toLowerCase().includes(q) ||
            (t.owner?.toLowerCase().includes(q) ?? false)
        );
      if (!matchesProj) {
        setSearchQuery('');
        resetFiltersNotice = true;
      }
    }

    if (isNew) {
      showToast(
        resetFiltersNotice
          ? `已新增機種「${project.modelName}」（已自動重設篩選條件以立即顯示新機種）`
          : `已新增機種「${project.modelName}」並寫入大容量資料庫`
      );
    } else {
      showToast(`已更新機種「${project.modelName}」與任務清單`);
    }
  };

  const handleDeleteProject = (projectId: string) => {
    mutateProjects((prev) => prev.filter((p) => p.id !== projectId));
    showToast('已刪除機種專案（可按復原上一步還原）');
  };

  const handleUpdateTaskDates = (
    projectId: string,
    taskId: string,
    field: 'planned' | 'actual',
    start: string,
    end: string
  ) => {
    mutateProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          tasks: p.tasks.map((t) => {
            if (t.id !== taskId) return t;
            return field === 'planned'
              ? { ...t, plannedStart: start, plannedEnd: end }
              : {
                  ...t,
                  actualStart: start,
                  actualEnd: end,
                  explicitActualDailyOnly: false,
                };
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
    mutateProjects(
      (prev) =>
        prev.map((p) => {
          if (p.id !== projectId) return p;
          return {
            ...p,
            tasks: p.tasks.map((t) =>
              t.id === taskId
                ? applySingleActualDateChange(t, dateStr, value, holidayMap)
                : t
            ),
          };
        }),
      { recordUndo: true, groupDragUndo: true }
    );
  };

  const handleToggleHolidayDate = (dateStr: string) => {
    const existing = holidays.find((h) => h.date === dateStr);
    const [y, m, d] = dateStr.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const isWeekend = dow === 0 || dow === 6;

    if (!existing) {
      if (isWeekend) {
        mutateHolidays((prev) => [
          ...prev,
          { date: dateStr, name: '調班補上班日', type: 'makeup_workday' },
        ]);
        showToast(`已將週末 ${dateStr} 設為調班工作天（計入工作天）`);
      } else {
        mutateHolidays((prev) => [
          ...prev,
          { date: dateStr, name: '廠休 / 盤點日', type: 'factory_off' },
        ]);
        showToast(`已將 ${dateStr} 標記為廠休 / 盤點日（自動扣除工作天）`);
      }
      return;
    }

    if (existing.type === 'holiday') {
      mutateHolidays((prev) =>
        prev.map((h) =>
          h.date === dateStr
            ? { date: dateStr, name: `${existing.name}調班上班`, type: 'makeup_workday' }
            : h
        )
      );
      showToast(`已將 ${dateStr} 轉為調班工作天（計入工作天）`);
      return;
    }

    mutateHolidays((prev) => prev.filter((h) => h.date !== dateStr));
    showToast(`已移除 ${dateStr}（${existing.name}）標記`);
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
          filename: buildDefaultExportFilename(startDate, endDate),
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

  const handleExcelFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.xls') && !lowerName.endsWith('.xlsx')) {
      showToast('僅支援 .xlsx 格式，若為舊版 .xls 請先於 Excel 另存新檔為 .xlsx 後再匯入');
      return;
    }

    setIsParsingExcel(true);
    try {
      const buffer = await file.arrayBuffer();
      const result = await parseScheduleFromExcelBuffer(buffer, file.name, holidays);
      setExcelImportModalState({ result, buffer, filename: file.name });
    } catch (err) {
      showToast(
        err instanceof Error
          ? `匯入失敗：${err.message}`
          : '匯入 Excel 失敗，請確認檔案為有效的 .xlsx 排程表'
      );
    } finally {
      setIsParsingExcel(false);
    }
  };

  const handleConfirmExcelImport = (
    importedProjects: ProjectModel[],
    mode: ExcelImportMode,
    detectedYear: number
  ) => {
    if (mode === 'replace') {
      const sorted = [...importedProjects].sort((a, b) => a.seqNo - b.seqNo);
      mutateProjects(() => sorted);
    } else {
      mutateProjects((prev) => {
        const byModelKey = new Map<string, ProjectModel>();
        for (const p of prev) {
          const key = p.modelName.trim().toUpperCase();
          byModelKey.set(key, {
            ...p,
            tasks: p.tasks.map((t) => ({ ...t })),
          });
        }

        for (const imp of importedProjects) {
          const key = imp.modelName.trim().toUpperCase();
          const existing = byModelKey.get(key);
          if (!existing) {
            byModelKey.set(key, {
              ...imp,
              tasks: imp.tasks.map((t) => ({ ...t })),
            });
          } else {
            // Unify same model name under one seqNo (smallest seqNo) and merge tasks
            const mergedTasks = [...existing.tasks];
            for (const impTask of imp.tasks) {
              const normName = impTask.taskName.trim().toUpperCase();
              const matchIdx = mergedTasks.findIndex(
                (t) => t.taskName.trim().toUpperCase() === normName
              );
              if (matchIdx >= 0) {
                mergedTasks[matchIdx] = {
                  ...impTask,
                  id: mergedTasks[matchIdx].id,
                };
              } else {
                mergedTasks.push(impTask);
              }
            }

            byModelKey.set(key, {
              ...existing,
              seqNo: Math.min(existing.seqNo, imp.seqNo),
              modelSubtitle: existing.modelSubtitle || imp.modelSubtitle,
              customer: existing.customer || imp.customer,
              ee: existing.ee || imp.ee,
              me: existing.me || imp.me,
              tasks: mergedTasks,
            });
          }
        }

        return Array.from(byModelKey.values()).sort((a, b) => a.seqNo - b.seqNo);
      });
    }

    // Clear restrictive filters so newly imported models are immediately visible
    setStageFilter('ALL');
    setStatusFilter('ALL');
    setSearchQuery('');

    // If none of the imported tasks overlap the active calendar window, switch to the detected year's full overview
    const anyVisibleInCurrentRange = importedProjects.some((p) =>
      p.tasks.some((t) => {
        const dates = [
          t.plannedStart,
          t.plannedEnd,
          t.actualStart,
          t.actualEnd,
          ...Object.keys(t.dailyOverrides || {}),
        ].filter(Boolean);
        return dates.some((d) => d >= startDate && d <= endDate);
      })
    );
    if (!anyVisibleInCurrentRange && detectedYear >= 2000 && detectedYear <= 2100) {
      setCalendarYear(detectedYear);
      setStartDate(`${detectedYear}-01-01`);
      setEndDate(`${detectedYear}-12-31`);
    }

    setExcelImportModalState(null);
    setActiveTab('schedule');
    showToast(
      `已${mode === 'replace' ? '匯入取代' : '依機種合併'} ${importedProjects.length} 款機種（已依序號由小到大排序）`
    );
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
              區間總工時(預/實){' '}
              <strong className="text-slate-900">
                {summaryStats.plannedDaysTotal} / {summaryStats.actualDaysTotal} 天
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>
              DFM PCB(實/預){' '}
              <strong className="text-slate-900">
                {summaryStats.actualPcbTotal} / {summaryStats.plannedPcbTotal} 片
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

            <div
              className="flex items-center gap-1.5"
              title="追控基準日預設自動跟隨當天日期變動：1. 甘特圖日曆加上藍色基準框；2. 預計開始日已過卻未填入實際開始日會以紅底標示警示；3. 計算上方 KPI 與統計報表的延遲/超支預警清單"
            >
              <label htmlFor="ref-today" className="whitespace-nowrap cursor-help">
                追控基準日：
              </label>
              <input
                id="ref-today"
                type="date"
                value={referenceToday}
                onChange={(e) => {
                  const val = e.target.value;
                  isAutoReferenceTodayRef.current = val === getTodayISO();
                  setReferenceToday(val);
                }}
                className="px-2 py-1 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-800"
              />
              {referenceToday !== getTodayISO() && (
                <button
                  type="button"
                  onClick={() => {
                    isAutoReferenceTodayRef.current = true;
                    setReferenceToday(getTodayISO());
                  }}
                  className="px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md whitespace-nowrap"
                  title="重設為自動跟隨系統今日日期"
                >
                  回到今日
                </button>
              )}
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

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isParsingExcel}
                    onClick={() => excelInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0"
                    title="直接匯入 .xlsx 排程表（自動依序號排序並合併同機種）"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    {isParsingExcel ? '讀取中...' : '匯入 Excel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setProjectModalState({ open: true, project: null })}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    新增機種專案
                  </button>
                </div>
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
                    {Array.from(new Set([...TAIWAN_HOLIDAY_YEARS, calendarYear]))
                      .sort((a, b) => a - b)
                      .map((yr) => (
                        <option key={yr} value={yr}>
                          {yr}年
                        </option>
                      ))}
                  </select>
                  <div className="flex flex-wrap items-center gap-1 p-0.5 bg-slate-100 rounded-md">
                    {(() => {
                      const lastWeek = getLastWeekRange();
                      const thisWeek = getThisWeekRange();
                      const thisMonth = getThisMonthRange();
                      return [
                        { label: '上週', s: lastWeek.start, e: lastWeek.end, yearOverride: lastWeek.year },
                        { label: '本週', s: thisWeek.start, e: thisWeek.end, yearOverride: thisWeek.year },
                        { label: '本月', s: thisMonth.start, e: thisMonth.end, yearOverride: thisMonth.year },
                        { label: 'Q1', s: `${calendarYear}-01-01`, e: `${calendarYear}-03-31` },
                        { label: 'Q2', s: `${calendarYear}-04-01`, e: `${calendarYear}-06-30` },
                        { label: 'Q3', s: `${calendarYear}-07-01`, e: `${calendarYear}-09-30` },
                        { label: 'Q4', s: `${calendarYear}-10-01`, e: `${calendarYear}-12-31` },
                        { label: '上半年全覽', s: `${calendarYear}-01-01`, e: `${calendarYear}-06-30` },
                        { label: '下半年全覽', s: `${calendarYear}-07-01`, e: `${calendarYear}-12-31` },
                        { label: '年度全覽', s: `${calendarYear}-01-01`, e: `${calendarYear}-12-31` },
                      ];
                    })().map((preset) => {
                      const active = startDate === preset.s && endDate === preset.e;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            if (preset.yearOverride) {
                              setCalendarYear(preset.yearOverride);
                            }
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
                        id: 'inspect',
                        label: '安全點選 (防誤觸)',
                        dot: null,
                      },
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
                    ] as { id: GanttClickMode; label: string; dot: string | null }[]
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      disabled={!isScheduleEditable}
                      onClick={() => setGanttClickMode(mode.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 ${
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

                {undoStack.length > 0 && isScheduleEditable && (
                  <button
                    type="button"
                    onClick={handleUndo}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                    title="復原上一步排程異動 (Ctrl+Z)"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    復原上一步 ({undoStack.length})
                  </button>
                )}
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
              isEditable={isScheduleEditable}
              isFullscreen={isFullscreenSchedule}
              canUndo={undoStack.length > 0}
              onToggleEditable={() => {
                setIsScheduleEditable((prev) => {
                  const next = !prev;
                  showToast(
                    next
                      ? '已切換為「可編輯狀態」（已啟用防誤覆蓋保護）'
                      : '已切換為「唯讀鎖定 (不可編輯)」狀態'
                  );
                  return next;
                });
              }}
              onToggleFullscreen={() => setIsFullscreenSchedule((prev) => !prev)}
              onChangeClickMode={setGanttClickMode}
              onUndo={handleUndo}
              onProtectedNotice={showToast}
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
              mutateHolidays((prev) => [
                ...prev.filter((h) => h.date !== item.date),
                item,
              ]);
              showToast(`已新增行事曆標記 ${item.date} (${item.name})`);
            }}
            onRemoveHoliday={(dateStr) => {
              mutateHolidays((prev) => prev.filter((h) => h.date !== dateStr));
              showToast(`已移除行事曆項目 ${dateStr}`);
            }}
            onSyncTaiwanHolidays={() => {
              const merged = mergeTaiwanHolidays2023To2033(holidays);
              const addedCount = merged.length - holidays.length;
              mutateHolidays(() => merged);
              showToast(
                addedCount > 0
                  ? `已補齊 ${addedCount} 筆台灣 2023–2033 國定假日（已完整保留所有手動新增與調班項目）`
                  : '台灣 2023–2033 國定假日皆已齊全，未覆蓋任何手動項目'
              );
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
            onTriggerExcelImport={() => excelInputRef.current?.click()}
            onImportBackupData={(importedProjects, importedHolidays) => {
              mutateProjects(() => normalizeProjects(importedProjects));
              if (importedHolidays) mutateHolidays(() => importedHolidays);
            }}
            onResetDefaultData={() => {
              mutateProjects(() => INITIAL_PROJECTS);
              mutateHolidays(() => INITIAL_HOLIDAYS);
            }}
          />
        )}
      </main>

      <input
        ref={excelInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={handleExcelFileChange}
        className="hidden"
      />

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

      {excelImportModalState && (
        <ExcelImportModal
          initialResult={excelImportModalState.result}
          rawBuffer={excelImportModalState.buffer}
          filename={excelImportModalState.filename}
          holidays={holidays}
          existingProjectsCount={projects.length}
          onClose={() => setExcelImportModalState(null)}
          onConfirmImport={handleConfirmExcelImport}
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
