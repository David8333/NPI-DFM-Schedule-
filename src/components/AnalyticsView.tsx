import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, ArrowUpRight } from 'lucide-react';
import { HolidayItem, ProjectModel, ProjectStage, ScheduleTask } from '../types/schedule';
import {
  buildHolidayMap,
  computeActualWorkingDays,
  computePlannedWorkingDays,
  getEffectiveActualRangeDisplay,
  isTaskDelayedOrWarning,
} from '../utils/dateUtils';
import { WeeklyDfmStatsPanel } from './WeeklyDfmStatsPanel';

interface AnalyticsViewProps {
  allProjects: ProjectModel[];
  projects: ProjectModel[];
  holidays: HolidayItem[];
  startDate: string;
  endDate: string;
  referenceToday: string;
  onEditTask: (project: ProjectModel, task: ScheduleTask) => void;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  allProjects,
  projects,
  holidays,
  startDate,
  endDate,
  referenceToday,
  onEditTask,
}) => {
  const holidayMap = useMemo(() => buildHolidayMap(holidays), [holidays]);

  const stats = useMemo(() => {
    let totalTasks = 0;
    let completedTasks = 0;
    let openStatusTasks = 0;
    let totalPlannedDays = 0;
    let totalActualDays = 0;
    let totalPlannedPcb = 0;
    let totalActualPcb = 0;

    const warnings: {
      project: ProjectModel;
      task: ScheduleTask;
      plannedDays: number;
      actualDays: number;
      actualStartDisp: string;
      actualEndDisp: string;
      reason: string;
    }[] = [];

    const stageStats: Record<
      ProjectStage,
      { total: number; completed: number; plannedDays: number; actualDays: number }
    > = {
      PROTO: { total: 0, completed: 0, plannedDays: 0, actualDays: 0 },
      EVT: { total: 0, completed: 0, plannedDays: 0, actualDays: 0 },
      DVT: { total: 0, completed: 0, plannedDays: 0, actualDays: 0 },
      MVT: { total: 0, completed: 0, plannedDays: 0, actualDays: 0 },
      MP: { total: 0, completed: 0, plannedDays: 0, actualDays: 0 },
      OTHER: { total: 0, completed: 0, plannedDays: 0, actualDays: 0 },
    };

    const modelSummaries = projects.map((proj) => {
      let mPlan = 0;
      let mActual = 0;
      let mDone = 0;
      for (const t of proj.tasks) {
        totalTasks++;
        if (t.completed) {
          completedTasks++;
          mDone++;
        }
        if (t.status === 'O') openStatusTasks++;

        const pDays = computePlannedWorkingDays(t, holidayMap);
        const aDays = computeActualWorkingDays(t, holidayMap);
        const effRange = getEffectiveActualRangeDisplay(t);
        totalPlannedDays += pDays;
        totalActualDays += aDays;
        mPlan += pDays;
        mActual += aDays;

        if (t.pcbMode === 'qty') {
          totalPlannedPcb += t.plannedQty ?? 0;
          totalActualPcb += t.actualQty ?? 0;
        }

        const st = stageStats[t.stage] || stageStats.OTHER;
        st.total++;
        if (t.completed) st.completed++;
        st.plannedDays += pDays;
        st.actualDays += aDays;

        const w = isTaskDelayedOrWarning(t, referenceToday, holidayMap);
        if (w.isWarning) {
          warnings.push({
            project: proj,
            task: t,
            plannedDays: pDays,
            actualDays: aDays,
            actualStartDisp: effRange.start,
            actualEndDisp: effRange.end,
            reason: w.reason,
          });
        }
      }
      return {
        project: proj,
        plannedDays: mPlan,
        actualDays: mActual,
        completedCount: mDone,
        totalCount: proj.tasks.length,
      };
    });

    const maxModelDays = Math.max(
      1,
      ...modelSummaries.map((m) => Math.max(m.plannedDays, m.actualDays))
    );

    return {
      totalTasks,
      completedTasks,
      openStatusTasks,
      totalPlannedDays,
      totalActualDays,
      totalPlannedPcb,
      totalActualPcb,
      warnings,
      stageStats,
      modelSummaries,
      maxModelDays,
    };
  }, [projects, holidayMap, referenceToday]);

  const completionPct =
    stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0;

  return (
    <div className="space-y-8">
      {/* Top KPI Grid (Single-Elevation, Clean Dividers) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-lg divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">追控任務完成率</p>
          <p className="mt-2 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {completionPct}%
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            已完成 {stats.completedTasks} / 共 {stats.totalTasks} 項任務
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">待結案追控項 (狀態 O)</p>
          <p className="mt-2 text-2xl font-bold font-mono text-rose-700 tabular-nums">
            {stats.openStatusTasks}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            涵蓋 {projects.length} 款硬體研發機種
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">總工作天數（預計 / 實際）</p>
          <p className="mt-2 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {stats.totalPlannedDays}{' '}
            <span className="text-sm font-normal text-slate-400">/</span>{' '}
            <span className="text-emerald-700">{stats.totalActualDays}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            差額 {stats.totalActualDays - stats.totalPlannedDays >= 0 ? '+' : ''}
            {stats.totalActualDays - stats.totalPlannedDays} 工作天
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">DFM 審查 PCB 累計板數</p>
          <p className="mt-2 text-2xl font-bold font-mono text-slate-900 tabular-nums">
            {stats.totalActualPcb}{' '}
            <span className="text-sm font-normal text-slate-400">/ {stats.totalPlannedPcb}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">實際審結板數 / 預計送審總板數</p>
        </div>
      </div>

      {/* Weekly DFM REVIEW Statistics Section */}
      <WeeklyDfmStatsPanel
        allProjects={allProjects}
        filteredProjects={projects}
        holidays={holidays}
        rangeStart={startDate}
        rangeEnd={endDate}
      />

      {/* Delay & Schedule Variance Watchlist */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              排程延遲與工時差異預警清單
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              系統依基準日 ({referenceToday}) 自動檢核「逾預計開工日未啟動」與「實際工作天超支」項目
            </p>
          </div>
          <span className="text-xs font-mono text-slate-600 tabular-nums">
            共 {stats.warnings.length} 筆異常紀錄
          </span>
        </div>

        {stats.warnings.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-600 flex flex-col items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
            <span>目前所有專案任務皆符合預計排程，無延遲或工時超支項目。</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-3 px-4">序號 · 機種名稱</th>
                  <th className="py-3 px-4">階段 · 任務名稱</th>
                  <th className="py-3 px-4">預計區間</th>
                  <th className="py-3 px-4">實際區間</th>
                  <th className="py-3 px-4 text-right">預計 / 實際工作天</th>
                  <th className="py-3 px-4">預警原因</th>
                  <th className="py-3 px-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stats.warnings.map(
                  ({
                    project,
                    task,
                    plannedDays,
                    actualDays,
                    actualStartDisp,
                    actualEndDisp,
                    reason,
                  }) => (
                    <tr key={task.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 tabular-nums">
                        #{project.seqNo} · <span className="text-blue-700">{project.modelName}</span>
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-800">
                        {task.stage} · {task.taskName}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 tabular-nums">
                        {task.plannedStart && task.plannedEnd
                          ? `${task.plannedStart} ~ ${task.plannedEnd}`
                          : '未排定'}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 tabular-nums">
                        {actualStartDisp && actualEndDisp
                          ? `${actualStartDisp} ~ ${actualEndDisp}`
                          : '尚未開始'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums">
                        <span className="text-slate-600">{plannedDays}</span>
                        <span className="mx-1 text-slate-400">/</span>
                        <span className="text-rose-700">{actualDays} 天</span>
                      </td>
                      <td className="py-3 px-4 text-rose-700 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          {reason}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onEditTask(project, task)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap"
                        >
                          調整排程
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Model Working Days Load & Stage Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-6">
          <h3 className="text-base font-bold text-slate-900">
            各機種預計與實際工作天對比
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 mb-5">
            比較各機種於所有階段投入之預計工作天（琥珀色）與實際累計工作天（翠綠色）
          </p>

          <div className="space-y-4">
            {stats.modelSummaries.map((item) => {
              const pWidth = Math.round((item.plannedDays / stats.maxModelDays) * 100);
              const aWidth = Math.round((item.actualDays / stats.maxModelDays) * 100);
              return (
                <div key={item.project.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="font-medium text-slate-800">
                      <span className="font-mono font-bold text-blue-700">
                        {item.project.modelName}
                      </span>
                      {item.project.modelSubtitle && (
                        <span className="text-slate-500 ml-1.5">
                          {item.project.modelSubtitle}
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-slate-600 tabular-nums">
                      預計 {item.plannedDays} 天 · 實際 {item.actualDays} 天 · 完成{' '}
                      {item.completedCount}/{item.totalCount}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="h-2 bg-slate-100 rounded-xs overflow-hidden">
                      <div
                        style={{ width: `${Math.max(pWidth, item.plannedDays > 0 ? 3 : 0)}%` }}
                        className="h-full bg-amber-400"
                      />
                    </div>
                    <div className="h-2 bg-slate-100 rounded-xs overflow-hidden">
                      <div
                        style={{ width: `${Math.max(aWidth, item.actualDays > 0 ? 3 : 0)}%` }}
                        className={`h-full ${
                          item.actualDays > item.plannedDays && item.plannedDays > 0
                            ? 'bg-rose-500'
                            : 'bg-emerald-500'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h3 className="text-base font-bold text-slate-900">NPI 研發階段統計</h3>
          <p className="text-xs text-slate-500 mt-0.5 mb-5">
            依 PROTO · EVT · DVT · MVT · MP 統計任務進度
          </p>

          <div className="divide-y divide-slate-200">
            {(['PROTO', 'EVT', 'DVT', 'MVT', 'MP'] as ProjectStage[]).map((stage) => {
              const s = stats.stageStats[stage];
              return (
                <div
                  key={stage}
                  className="py-3 first:pt-0 last:pb-0 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-bold font-mono text-slate-900">{stage}</p>
                    <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                      已完成 {s.completed} / {s.total} 項任務
                    </p>
                  </div>
                  <div className="text-right font-mono text-xs tabular-nums">
                    <p className="text-slate-700">預計 {s.plannedDays} 天</p>
                    <p className="text-emerald-700 font-semibold mt-0.5">
                      實際 {s.actualDays} 天
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
