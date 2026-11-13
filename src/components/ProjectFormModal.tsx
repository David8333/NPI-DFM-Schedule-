import React, { useState } from 'react';
import { X, Plus, Trash2, ArrowUp, ArrowDown, Check } from 'lucide-react';
import { ProjectModel, ProjectStage, ScheduleTask } from '../types/schedule';
import {
  NPI_STAGES_ORDER,
  NPI_STANDARD_TASK_CATALOG,
  createTaskFromTemplate,
  formatStageTaskName,
} from '../data/npiCatalog';

interface ProjectFormModalProps {
  initialProject?: ProjectModel | null;
  nextSeqNo: number;
  onClose: () => void;
  onSaveProject: (project: ProjectModel, isNew: boolean) => void;
}

export const ProjectFormModal: React.FC<ProjectFormModalProps> = ({
  initialProject,
  nextSeqNo,
  onClose,
  onSaveProject,
}) => {
  const isEditing = Boolean(initialProject);
  const [seqNo, setSeqNo] = useState<number>(initialProject?.seqNo ?? nextSeqNo);
  const [modelName, setModelName] = useState<string>(initialProject?.modelName ?? '');
  const [modelSubtitle, setModelSubtitle] = useState<string>(
    initialProject?.modelSubtitle ?? ''
  );
  const [customer, setCustomer] = useState<string>(initialProject?.customer ?? '');
  const [ee, setEe] = useState<string>(initialProject?.ee ?? '');
  const [me, setMe] = useState<string>(initialProject?.me ?? '');

  const [tasks, setTasks] = useState<ScheduleTask[]>(() => {
    if (initialProject) {
      return initialProject.tasks.map((t) => ({ ...t }));
    }
    const defaultTpl = NPI_STANDARD_TASK_CATALOG.filter((t) => t.stage === 'EVT');
    return defaultTpl.map((tpl) => createTaskFromTemplate(tpl));
  });

  const [customTaskName, setCustomTaskName] = useState('');

  const hasCatalogTask = (taskName: string) =>
    tasks.some((t) => t.taskName.trim().toUpperCase() === taskName.toUpperCase());

  const handleToggleCatalogTask = (tplKey: string) => {
    const tpl = NPI_STANDARD_TASK_CATALOG.find((c) => c.key === tplKey);
    if (!tpl) return;
    const exists = hasCatalogTask(tpl.taskName);
    if (exists) {
      if (tasks.length <= 1) return;
      setTasks((prev) =>
        prev.filter(
          (t) => t.taskName.trim().toUpperCase() !== tpl.taskName.toUpperCase()
        )
      );
    } else {
      setTasks((prev) => [...prev, createTaskFromTemplate(tpl)]);
    }
  };

  const handleAddStageRound = (stage: ProjectStage) => {
    // Compute next iteration number for this stage (e.g. if EVT or EVT1 exists -> add EVT2)
    const stageTasks = tasks.filter((t) => t.stage === stage);
    let maxRound = 0;
    for (const st of stageTasks) {
      if (st.stageIteration && st.stageIteration > maxRound) {
        maxRound = st.stageIteration;
      } else {
        const match = st.taskName.toUpperCase().match(new RegExp(`^${stage}(\\d+)`));
        if (match) {
          maxRound = Math.max(maxRound, Number(match[1]));
        } else {
          maxRound = Math.max(maxRound, 1);
        }
      }
    }
    const nextRound = maxRound + 1;
    const stageTemplates = NPI_STANDARD_TASK_CATALOG.filter((c) => c.stage === stage);
    const newRoundTasks = stageTemplates.map((tpl) =>
      createTaskFromTemplate(tpl, nextRound)
    );
    setTasks((prev) => [...prev, ...newRoundTasks]);
  };

  const handleApplyStagePreset = (
    preset: 'PROTO_ONLY' | 'EVT_ONLY' | 'DVT_ONLY' | 'FULL_NPI'
  ) => {
    const stageSet =
      preset === 'PROTO_ONLY'
        ? ['PROTO']
        : preset === 'EVT_ONLY'
        ? ['EVT']
        : preset === 'DVT_ONLY'
        ? ['DVT']
        : ['PROTO', 'EVT', 'DVT', 'MVT', 'MP'];
    const selected = NPI_STANDARD_TASK_CATALOG.filter((t) =>
      stageSet.includes(t.stage)
    );
    setTasks(selected.map((tpl) => createTaskFromTemplate(tpl)));
  };

  const handleAddCustomTask = () => {
    const name = customTaskName.trim();
    if (!name) return;
    const upper = name.toUpperCase();
    const isPilot = name.includes('試產');
    const isDfm = upper.includes('DFM');
    const matchedStage: ProjectStage = upper.includes('PROTO')
      ? 'PROTO'
      : upper.includes('EVT')
      ? 'EVT'
      : upper.includes('DVT')
      ? 'DVT'
      : upper.includes('MVT')
      ? 'MVT'
      : upper.includes('MP')
      ? 'MP'
      : 'OTHER';

    const iterMatch = upper.match(/^(?:PROTO|EVT|DVT|MVT|MP)(\d+)/);
    const newTask: ScheduleTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      taskName: name,
      stage: matchedStage,
      stageIteration: iterMatch ? Number(iterMatch[1]) : null,
      taskCategory: isDfm ? 'dfm' : isPilot ? 'pilot' : 'other',
      pcbMode: isPilot ? 'note' : 'qty',
      plannedQty: isPilot ? null : 4,
      actualQty: isPilot ? null : 0,
      pilotNote: isPilot ? `${name} 30pcs` : '',
      completed: false,
      plannedStart: '',
      plannedEnd: '',
      actualStart: '',
      actualEnd: '',
      status: 'O',
    };
    setTasks((prev) => [...prev, newTask]);
    setCustomTaskName('');
  };

  const handleTaskIterationChange = (idx: number, nextIter: number | null) => {
    setTasks((prev) =>
      prev.map((t, i) => {
        if (i !== idx) return t;
        const cat = t.taskCategory === 'pilot' || t.taskName.includes('試產') ? 'pilot' : 'dfm';
        const isStandard =
          t.stage !== 'OTHER' &&
          (t.taskName.toUpperCase().includes('DFM') || t.taskName.includes('試產'));
        return {
          ...t,
          stageIteration: nextIter,
          taskName: isStandard
            ? formatStageTaskName(t.stage, cat, nextIter)
            : t.taskName,
        };
      })
    );
  };

  const moveTask = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= tasks.length) return;
    setTasks((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  };

  const removeTaskAt = (idx: number) => {
    if (tasks.length <= 1) return;
    setTasks((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelName.trim() || tasks.length === 0) return;

    const result: ProjectModel = {
      id: initialProject?.id ?? `proj-${Date.now()}`,
      seqNo: Number(seqNo) || nextSeqNo,
      modelName: modelName.trim(),
      modelSubtitle: modelSubtitle.trim() || undefined,
      customer: customer.trim() || undefined,
      ee: ee.trim() || undefined,
      me: me.trim() || undefined,
      tasks,
    };

    onSaveProject(result, !isEditing);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {isEditing ? '編輯機種與階段任務列表' : '新增機種排程專案'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              設定機種基本資料（EE / ME），並勾選或新增多輪次 PROTO / EVT / DVT / MVT / MP 任務清單
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
          {/* Basic Model Info */}
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
            <div className="sm:col-span-1">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                序號
              </label>
              <input
                type="number"
                min={1}
                value={seqNo}
                onChange={(e) => setSeqNo(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-lg"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                機種名稱 (Model Code)
              </label>
              <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="例如：NWS008-5A0G"
                className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-lg"
                required
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                機種規格副標 / 原機種備註
              </label>
              <input
                type="text"
                value={modelSubtitle}
                onChange={(e) => setModelSubtitle(e.target.value)}
                placeholder="例如：(原G14 800W CRPS 伺服器電源)"
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                客戶名稱（選填）
              </label>
              <input
                type="text"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder="例如：CloudCore"
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                EE 負責人（選填）
              </label>
              <input
                type="text"
                value={ee}
                onChange={(e) => setEe(e.target.value)}
                placeholder="例如：陳建宏"
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ME 負責人（選填）
              </label>
              <input
                type="text"
                value={me}
                onChange={(e) => setMe(e.target.value)}
                placeholder="例如：林冠宇"
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {/* Stage Task List Catalog Selector */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">
                標準 NPI 階段任務列表（支援 PROTO / EVT / DVT 多輪次如 EVT1、EVT2）
              </span>
              {!isEditing && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleApplyStagePreset('PROTO_ONLY')}
                    className="px-2 py-0.5 text-[11px] bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                  >
                    僅 PROTO
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyStagePreset('EVT_ONLY')}
                    className="px-2 py-0.5 text-[11px] bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                  >
                    僅 EVT
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyStagePreset('DVT_ONLY')}
                    className="px-2 py-0.5 text-[11px] bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                  >
                    僅 DVT
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyStagePreset('FULL_NPI')}
                    className="px-2 py-0.5 text-[11px] bg-slate-900 text-white rounded hover:bg-slate-800"
                  >
                    全套 PROTO→MP (10項)
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              {NPI_STAGES_ORDER.map((stage) => {
                const stageItems = NPI_STANDARD_TASK_CATALOG.filter(
                  (c) => c.stage === stage
                );
                const allowMultiRound =
                  stage === 'PROTO' || stage === 'EVT' || stage === 'DVT' || stage === 'MVT';
                return (
                  <div
                    key={stage}
                    className="bg-white border border-slate-200 rounded-md p-2 space-y-1.5 flex flex-col justify-between"
                  >
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-mono font-bold text-slate-700 border-b border-slate-100 pb-1">
                        {stage}
                      </div>
                      {stageItems.map((tpl) => {
                        const active = hasCatalogTask(tpl.taskName);
                        const isPilot = tpl.taskCategory === 'pilot';
                        return (
                          <button
                            key={tpl.key}
                            type="button"
                            onClick={() => handleToggleCatalogTask(tpl.key)}
                            className={`w-full flex items-center justify-between gap-1 px-2 py-1 text-[11px] rounded border text-left transition-colors ${
                              active
                                ? isPilot
                                  ? 'bg-purple-50 border-purple-400 text-purple-900 font-semibold'
                                  : 'bg-amber-50 border-amber-400 text-amber-950 font-semibold'
                                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            <span className="truncate">
                              {isPilot ? '試產' : 'DFM REVIEW'}
                            </span>
                            {active && <Check className="w-3 h-3 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>

                    {allowMultiRound && (
                      <button
                        type="button"
                        onClick={() => handleAddStageRound(stage)}
                        className="w-full mt-1 inline-flex items-center justify-center gap-0.5 px-1.5 py-1 text-[10px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                        title={`新增下一輪 ${stage}（例如 ${stage}2）`}
                      >
                        <Plus className="w-2.5 h-2.5" />
                        新增 {stage} 輪次
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Custom Task Input */}
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={customTaskName}
                onChange={(e) => setCustomTaskName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomTask();
                  }
                }}
                placeholder="或輸入自訂階段任務名稱（如：EVT2 DFM REVIEW、MVT試產）"
                className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              />
              <button
                type="button"
                onClick={handleAddCustomTask}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-100 rounded-md text-slate-800 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                加入清單
              </button>
            </div>
          </div>

          {/* Current Project Task Order & Iteration / Inline Spec */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">
                已排入的機種任務清單（共 {tasks.length} 項，可調整輪次編號與順序）
              </span>
            </div>

            <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 max-h-[220px] overflow-y-auto">
              {tasks.map((t, idx) => (
                <div
                  key={t.id}
                  className="px-3 py-2 flex items-center justify-between gap-2 text-xs bg-white"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="font-mono text-slate-400 w-5 text-center tabular-nums">
                      {idx + 1}
                    </span>
                    <span className="font-mono font-semibold text-slate-600 w-12 shrink-0">
                      {t.stage}
                    </span>
                    <select
                      value={t.stageIteration ?? ''}
                      onChange={(e) =>
                        handleTaskIterationChange(
                          idx,
                          e.target.value === '' ? null : Number(e.target.value)
                        )
                      }
                      className="px-1.5 py-1 text-[11px] font-mono border border-slate-200 rounded bg-slate-50 shrink-0"
                      title="標示輪次編號（例如 1 → EVT1，2 → EVT2）"
                    >
                      <option value="">無次別</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                    </select>
                    <input
                      type="text"
                      value={t.taskName}
                      onChange={(e) =>
                        setTasks((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, taskName: e.target.value } : item
                          )
                        )
                      }
                      className="font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded px-2 py-1 flex-1 min-w-[130px]"
                    />
                    {t.pcbMode === 'qty' ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-slate-500">板數:</span>
                        <input
                          type="number"
                          min={0}
                          value={t.plannedQty ?? ''}
                          onChange={(e) =>
                            setTasks((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? {
                                      ...item,
                                      plannedQty:
                                        e.target.value === ''
                                          ? null
                                          : Number(e.target.value),
                                    }
                                  : item
                              )
                            )
                          }
                          className="w-12 font-mono border border-slate-200 rounded px-1.5 py-1 text-center"
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={t.pilotNote}
                        onChange={(e) =>
                          setTasks((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, pilotNote: e.target.value } : item
                            )
                          )
                        }
                        placeholder="試產套數說明..."
                        className="w-32 border border-slate-200 rounded px-2 py-1 text-purple-800"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveTask(idx, -1)}
                      className="p-1 text-slate-400 hover:text-slate-800 disabled:opacity-30"
                      title="上移"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === tasks.length - 1}
                      onClick={() => moveTask(idx, 1)}
                      className="p-1 text-slate-400 hover:text-slate-800 disabled:opacity-30"
                      title="下移"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={tasks.length <= 1}
                      onClick={() => removeTaskAt(idx)}
                      className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30"
                      title="移除此任務"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
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
              {isEditing ? '儲存機種與任務清單' : '建立機種專案'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
