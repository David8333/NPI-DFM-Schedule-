import React, { useMemo, useState } from 'react';
import { X, Trash2, RotateCcw, Plus } from 'lucide-react';
import {
  DailyOverrideType,
  HolidayItem,
  ProjectModel,
  ProjectStage,
  ScheduleTask,
  TaskCategory,
  TaskStatus,
} from '../types/schedule';
import {
  NPI_STAGES_ORDER,
  NPI_STANDARD_TASK_CATALOG,
  formatStageTaskName,
} from '../data/npiCatalog';
import {
  buildHolidayMap,
  computeActualWorkingDays,
  computePlannedWorkingDays,
  getEffectiveActualDates,
  getTaskCategory,
} from '../utils/dateUtils';

interface TaskEditModalProps {
  project: ProjectModel;
  task: ScheduleTask;
  holidays: HolidayItem[];
  onClose: () => void;
  onSave: (projectId: string, updatedTask: ScheduleTask) => void;
  onDeleteTask: (projectId: string, taskId: string) => void;
}

export const TaskEditModal: React.FC<TaskEditModalProps> = ({
  project,
  task,
  holidays,
  onClose,
  onSave,
  onDeleteTask,
}) => {
  const [draft, setDraft] = useState<ScheduleTask>(() => ({
    ...task,
    taskCategory: getTaskCategory(task),
  }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [singleActualDate, setSingleActualDate] = useState('');
  const [singleActualPaintType, setSingleActualPaintType] = useState<DailyOverrideType>(() =>
    getTaskCategory(task) === 'pilot' ? 'pilot' : 'work'
  );

  const holidayMap = useMemo(() => buildHolidayMap(holidays), [holidays]);
  const previewPlannedDays = computePlannedWorkingDays(draft, holidayMap);
  const previewActualDays = computeActualWorkingDays(draft, holidayMap);
  const effectiveActualDateList = useMemo(
    () => Array.from(getEffectiveActualDates(draft, holidayMap)).sort(),
    [draft, holidayMap]
  );

  const taskCat = getTaskCategory(draft);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(project.id, draft);
    onClose();
  };

  const handleSelectCatalogTask = (tplKey: string) => {
    const tpl = NPI_STANDARD_TASK_CATALOG.find((c) => c.key === tplKey);
    if (!tpl) return;
    const iter = draft.stageIteration ?? null;
    const nextName =
      iter && iter > 0
        ? formatStageTaskName(
            tpl.stage,
            tpl.taskCategory === 'pilot' ? 'pilot' : 'dfm',
            iter
          )
        : tpl.taskName;
    setDraft((prev) => ({
      ...prev,
      taskName: nextName,
      stage: tpl.stage,
      taskCategory: tpl.taskCategory,
      pcbMode: tpl.pcbMode,
    }));
    setSingleActualPaintType(tpl.taskCategory === 'pilot' ? 'pilot' : 'work');
  };

  const handleIterationChange = (nextIter: number | null) => {
    setDraft((prev) => {
      const cat = getTaskCategory(prev);
      let nextName = prev.taskName;
      if (prev.stage !== 'OTHER' && (cat === 'dfm' || cat === 'pilot')) {
        nextName = formatStageTaskName(prev.stage, cat, nextIter);
      }
      return {
        ...prev,
        stageIteration: nextIter,
        taskName: nextName,
      };
    });
  };

  const handleStageChange = (nextStage: ProjectStage) => {
    setDraft((prev) => {
      const cat = getTaskCategory(prev);
      let nextName = prev.taskName;
      if (nextStage !== 'OTHER' && (cat === 'dfm' || cat === 'pilot')) {
        nextName = formatStageTaskName(nextStage, cat, prev.stageIteration);
      }
      return {
        ...prev,
        stage: nextStage,
        taskName: nextName,
      };
    });
  };

  const handleAddSingleActualDay = () => {
    if (!singleActualDate) return;
    setDraft((prev) => ({
      ...prev,
      dailyOverrides: {
        ...(prev.dailyOverrides || {}),
        [singleActualDate]: singleActualPaintType,
      },
    }));
  };

  const handleRemoveActualDay = (dateStr: string) => {
    setDraft((prev) => {
      const nextOverrides = { ...(prev.dailyOverrides || {}) };
      if (
        prev.actualStart &&
        prev.actualEnd &&
        dateStr >= prev.actualStart &&
        dateStr <= prev.actualEnd
      ) {
        nextOverrides[dateStr] = 'pause';
      } else {
        delete nextOverrides[dateStr];
      }
      return {
        ...prev,
        dailyOverrides: nextOverrides,
      };
    });
  };

  const handleCopyPlannedToActual = () => {
    if (!draft.plannedStart || !draft.plannedEnd) return;
    setDraft((prev) => ({
      ...prev,
      actualStart: prev.plannedStart,
      actualEnd: prev.plannedEnd,
    }));
  };

  const handleClearAllActual = () => {
    setDraft((prev) => ({
      ...prev,
      actualStart: '',
      actualEnd: '',
      manualActualDays: 0,
      dailyOverrides: {},
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              編輯任務排程 — <span className="font-mono text-blue-700">{project.modelName}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              設定階段與輪次（如 EVT1 / EVT2）、預計與實際工作天記錄
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="關閉視窗"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* Task Name, Stage, Iteration, Category */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-5">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                任務名稱
              </label>
              <input
                type="text"
                value={draft.taskName}
                onChange={(e) => setDraft({ ...draft, taskName: e.target.value })}
                placeholder="例如：EVT1 DFM REVIEW 或 EVT2試產"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                NPI 階段
              </label>
              <select
                value={draft.stage}
                onChange={(e) => handleStageChange(e.target.value as ProjectStage)}
                className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="PROTO">PROTO</option>
                <option value="EVT">EVT</option>
                <option value="DVT">DVT</option>
                <option value="MVT">MVT</option>
                <option value="MP">MP</option>
                <option value="OTHER">其他</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                輪次標示
              </label>
              <select
                value={draft.stageIteration ?? ''}
                onChange={(e) =>
                  handleIterationChange(
                    e.target.value === '' ? null : Number(e.target.value)
                  )
                }
                className="w-full px-2.5 py-2 text-sm font-mono border border-slate-300 rounded-lg bg-white"
              >
                <option value="">無編號</option>
                <option value="1">1 (如EVT1)</option>
                <option value="2">2 (如EVT2)</option>
                <option value="3">3 (如EVT3)</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </select>
            </div>

            <div className="sm:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                任務類型
              </label>
              <select
                value={taskCat}
                onChange={(e) => {
                  const nextCat = e.target.value as TaskCategory;
                  setDraft({ ...draft, taskCategory: nextCat });
                  setSingleActualPaintType(nextCat === 'pilot' ? 'pilot' : 'work');
                }}
                className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="dfm">DFM REVIEW（納入週統計）</option>
                <option value="pilot">試產任務</option>
                <option value="other">其他追控任務</option>
              </select>
            </div>
          </div>

          {/* Structured Stage Task List Quick Picker */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-[11px] font-semibold text-slate-600 mb-2">
              階段任務列表快速套用：
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {NPI_STAGES_ORDER.map((stage) => {
                const items = NPI_STANDARD_TASK_CATALOG.filter((c) => c.stage === stage);
                return (
                  <div key={stage} className="space-y-1">
                    <div className="text-[10px] font-mono font-bold text-slate-500">
                      {stage}
                    </div>
                    {items.map((tpl) => {
                      const active =
                        draft.stage === tpl.stage &&
                        getTaskCategory(draft) === tpl.taskCategory;
                      return (
                        <button
                          key={tpl.key}
                          type="button"
                          onClick={() => handleSelectCatalogTask(tpl.key)}
                          className={`w-full px-2 py-1 text-[11px] rounded border text-left transition-colors ${
                            active
                              ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {tpl.taskCategory === 'pilot' ? `${stage}試產` : `${stage} DFM`}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* PCB Mode & Quantities / Note */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                「PCB數量」欄位顯示模式
              </span>
              <div className="flex items-center gap-1 p-0.5 bg-slate-200/80 rounded-md">
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, pcbMode: 'qty' })}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                    draft.pcbMode === 'qty'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  預計/實際板數
                </button>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, pcbMode: 'note' })}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                    draft.pcbMode === 'note'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  試產套數 / 備註文字
                </button>
              </div>
            </div>

            {draft.pcbMode === 'qty' ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-600 mb-1">
                    預計 PCB 數量
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.plannedQty ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        plannedQty: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    placeholder="例如：7"
                    className="w-full px-3 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 mb-1">
                    實際完成 PCB 數量
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.actualQty ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        actualQty: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    placeholder="例如：7"
                    className="w-full px-3 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-slate-600 mb-1">
                  試產規格 / 套數說明（合併顯示於欄位中）
                </label>
                <input
                  type="text"
                  value={draft.pilotNote}
                  onChange={(e) => setDraft({ ...draft, pilotNote: e.target.value })}
                  placeholder="例如：EVT試產 40pcs、20套 試做班、無MPM 試產計畫"
                  className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                />
              </div>
            )}
          </div>

          {/* Dual Schedule Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div
              className={`p-4 border rounded-lg space-y-3 ${
                taskCat === 'pilot'
                  ? 'border-purple-300 bg-purple-50/40'
                  : 'border-amber-200 bg-amber-50/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-bold ${
                    taskCat === 'pilot' ? 'text-purple-900' : 'text-amber-900'
                  }`}
                >
                  預計排程 ({taskCat === 'pilot' ? '試產預計' : 'DFM 預計'})
                </span>
                <span
                  className={`text-xs font-mono font-semibold tabular-nums ${
                    taskCat === 'pilot' ? 'text-purple-800' : 'text-amber-800'
                  }`}
                >
                  預計工作天：{previewPlannedDays} 天
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">預計開始日</label>
                  <input
                    type="date"
                    value={draft.plannedStart}
                    onChange={(e) => setDraft({ ...draft, plannedStart: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">預計結束日</label>
                  <input
                    type="date"
                    value={draft.plannedEnd}
                    onChange={(e) => setDraft({ ...draft, plannedEnd: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>
              </div>
              {!draft.plannedStart && !draft.plannedEnd && (
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">
                    未定日期時之預估工作天（選填）
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.manualPlannedDays ?? 0}
                    onChange={(e) =>
                      setDraft({ ...draft, manualPlannedDays: Number(e.target.value) || 0 })
                    }
                    className="w-24 px-2.5 py-1 text-xs font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>
              )}
            </div>

            <div
              className={`p-4 border rounded-lg space-y-3 ${
                taskCat === 'pilot'
                  ? 'border-sky-300 bg-sky-50/40'
                  : 'border-emerald-200 bg-emerald-50/30'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-bold ${
                    taskCat === 'pilot' ? 'text-sky-900' : 'text-emerald-900'
                  }`}
                >
                  實際執行 ({taskCat === 'pilot' ? '試產確認' : '實際進度'})
                </span>
                <span
                  className={`text-xs font-mono font-semibold tabular-nums ${
                    taskCat === 'pilot' ? 'text-sky-800' : 'text-emerald-800'
                  }`}
                >
                  實際工作天：{previewActualDays} 天
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">實際區間起</label>
                  <input
                    type="date"
                    value={draft.actualStart}
                    onChange={(e) => setDraft({ ...draft, actualStart: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">實際區間迄</label>
                  <input
                    type="date"
                    value={draft.actualEnd}
                    onChange={(e) => setDraft({ ...draft, actualEnd: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {draft.plannedStart && draft.plannedEnd && (
                  <button
                    type="button"
                    onClick={handleCopyPlannedToActual}
                    className="px-2 py-1 text-[11px] font-medium bg-white border border-slate-300 hover:bg-slate-100 rounded text-slate-700"
                  >
                    依預計區間帶入
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClearAllActual}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-white border border-slate-200 hover:bg-rose-50 text-rose-700 rounded"
                >
                  <RotateCcw className="w-3 h-3" />
                  清除全部實際日
                </button>
              </div>
            </div>
          </div>

          {/* Single-day Actual Working Day Recorder */}
          <div className="p-4 border border-slate-200 rounded-lg space-y-3 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs font-bold text-slate-800">
                  實際工作天單日記錄明細（亦可在排程總表甘特圖直接點擊/拖曳塗色）
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  目前共記錄 {effectiveActualDateList.length} 個實際工作日；點擊日期下方「×」可剔除該日工時
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={singleActualDate}
                  onChange={(e) => setSingleActualDate(e.target.value)}
                  className="px-2 py-1 text-xs font-mono border border-slate-300 rounded-md"
                />
                <select
                  value={singleActualPaintType}
                  onChange={(e) =>
                    setSingleActualPaintType(e.target.value as DailyOverrideType)
                  }
                  className="px-2 py-1 text-xs border border-slate-300 rounded-md bg-white"
                >
                  <option value="work">正常綠</option>
                  <option value="delay">超期紅</option>
                  <option value="pilot">試產確認</option>
                  <option value="pause">停工不計</option>
                </select>
                <button
                  type="button"
                  onClick={handleAddSingleActualDay}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md"
                >
                  <Plus className="w-3.5 h-3.5" />
                  加入日期
                </button>
              </div>
            </div>

            {effectiveActualDateList.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pt-1">
                {effectiveActualDateList.map((d) => {
                  const ov = draft.dailyOverrides?.[d];
                  let colorCls = 'bg-emerald-50 border-emerald-300 text-emerald-900';
                  if (ov === 'pilot' || (!ov && taskCat === 'pilot')) {
                    colorCls = 'bg-sky-100 border-sky-400 text-sky-900';
                  } else if (
                    ov === 'delay' ||
                    (!ov && draft.plannedEnd && d > draft.plannedEnd)
                  ) {
                    colorCls = 'bg-rose-50 border-rose-300 text-rose-900';
                  }
                  return (
                    <span
                      key={d}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono border rounded ${colorCls}`}
                    >
                      <span>{d}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveActualDay(d)}
                        className="hover:text-rose-700 font-bold ml-0.5"
                        title="剔除此實際工作日"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                尚未登錄任何實際工作日（可在上方填入區間，或直接在甘特圖「實際 ▶」列點擊塗色）
              </p>
            )}
          </div>

          {/* Status, Completion, Owner */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                追控狀態 (Status)
              </label>
              <select
                value={draft.status}
                onChange={(e) =>
                  setDraft({ ...draft, status: e.target.value as TaskStatus })
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="O">O — 待結案 / 追控中</option>
                <option value="C">C — 已正式結案</option>
                <option value="NA">NA — 免評 / 無須追控</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                任務擔當 / 工程師
              </label>
              <input
                type="text"
                value={draft.owner || ''}
                onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
                placeholder="例如：林志遠"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex items-end pb-1.5">
              <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={draft.completed}
                  onChange={(e) => setDraft({ ...draft, completed: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <span className="text-sm font-medium text-slate-800">
                  勾選「完成」(綠色高亮)
                </span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              追控備註說明（匯出至統計摘要表）
            </label>
            <input
              type="text"
              value={draft.remark || ''}
              onChange={(e) => setDraft({ ...draft, remark: e.target.value })}
              placeholder="記錄待料原因、ECN變更單號或試產異常摘要..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <div>
              {project.tasks.length > 1 && (
                confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteTask(project.id, task.id);
                        onClose();
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700"
                    >
                      確認刪除此任務
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    刪除此任務
                  </button>
                )
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
              >
                儲存排程變更
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
