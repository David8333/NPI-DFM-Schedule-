import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CalendarRange } from 'lucide-react';
import { HolidayItem, ProjectModel } from '../types/schedule';
import { buildHolidayMap, computeWeeklyDfmStats } from '../utils/dateUtils';

interface WeeklyDfmStatsPanelProps {
  allProjects: ProjectModel[];
  filteredProjects: ProjectModel[];
  holidays: HolidayItem[];
  rangeStart: string;
  rangeEnd: string;
  compactHeader?: boolean;
}

export const WeeklyDfmStatsPanel: React.FC<WeeklyDfmStatsPanelProps> = ({
  allProjects,
  filteredProjects,
  holidays,
  rangeStart,
  rangeEnd,
  compactHeader = false,
}) => {
  const [scopeMode, setScopeMode] = useState<'filtered' | 'all'>('all');
  const [dateScope, setDateScope] = useState<'current_range' | 'all_dates'>('current_range');
  const [expandedWeekKey, setExpandedWeekKey] = useState<string | null>(null);

  const holidayMap = useMemo(() => buildHolidayMap(holidays), [holidays]);

  const targetProjects = scopeMode === 'all' ? allProjects : filteredProjects;

  const weeklyStats = useMemo(() => {
    return computeWeeklyDfmStats(
      targetProjects,
      holidayMap,
      dateScope === 'current_range' ? rangeStart : undefined,
      dateScope === 'current_range' ? rangeEnd : undefined
    );
  }, [targetProjects, holidayMap, dateScope, rangeStart, rangeEnd]);

  const totals = useMemo(() => {
    let planned = 0;
    let actual = 0;
    let activeWeeks = 0;
    let maxDays = 1;
    for (const w of weeklyStats) {
      planned += w.plannedDays;
      actual += w.actualDays;
      if (w.plannedDays > 0 || w.actualDays > 0) activeWeeks++;
      maxDays = Math.max(maxDays, w.plannedDays, w.actualDays);
    }
    return { planned, actual, diff: actual - planned, activeWeeks, maxDays };
  }, [weeklyStats]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-slate-200">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-slate-700" />
            每週 DFM REVIEW 預計與實際工作天統計
          </h3>
          {!compactHeader && (
            <p className="text-xs text-slate-500 mt-0.5">
              依週一至週日統計所有「DFM REVIEW」任務於各週之預計工作天與實際工時天數（已自動扣除週末與廠休假日）
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => setDateScope('current_range')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                dateScope === 'current_range'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              目前日曆區間 ({rangeStart} ~ {rangeEnd})
            </button>
            <button
              type="button"
              onClick={() => setDateScope('all_dates')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                dateScope === 'all_dates'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              全部排程期間
            </button>
          </div>

          <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => setScopeMode('all')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                scopeMode === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              全部機種 ({allProjects.length})
            </button>
            <button
              type="button"
              onClick={() => setScopeMode('filtered')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                scopeMode === 'filtered'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              目前篩選 ({filteredProjects.length})
            </button>
          </div>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-slate-200 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50/60">
        <div className="px-5 py-3">
          <span className="text-[11px] font-medium text-slate-500">統計週數（有排程週次）</span>
          <p className="mt-1 text-lg font-bold font-mono text-slate-900 tabular-nums">
            {weeklyStats.length}{' '}
            <span className="text-xs font-normal text-slate-500">
              週（{totals.activeWeeks} 週有 DFM）
            </span>
          </p>
        </div>
        <div className="px-5 py-3">
          <span className="text-[11px] font-medium text-slate-500">DFM REVIEW 預計總天數</span>
          <p className="mt-1 text-lg font-bold font-mono text-amber-700 tabular-nums">
            {totals.planned} <span className="text-xs font-normal text-slate-500">工作天</span>
          </p>
        </div>
        <div className="px-5 py-3">
          <span className="text-[11px] font-medium text-slate-500">DFM REVIEW 實際總天數</span>
          <p className="mt-1 text-lg font-bold font-mono text-emerald-700 tabular-nums">
            {totals.actual} <span className="text-xs font-normal text-slate-500">工作天</span>
          </p>
        </div>
        <div className="px-5 py-3">
          <span className="text-[11px] font-medium text-slate-500">實際 vs 預計工時差異</span>
          <p
            className={`mt-1 text-lg font-bold font-mono tabular-nums ${
              totals.diff > 0 ? 'text-rose-700' : 'text-slate-900'
            }`}
          >
            {totals.diff > 0 ? `+${totals.diff}` : totals.diff}{' '}
            <span className="text-xs font-normal text-slate-500">工作天</span>
          </p>
        </div>
      </div>

      {/* Weekly Breakdown Table */}
      {weeklyStats.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-500">
          所選範圍內目前沒有 DFM REVIEW 的預計或實際排程天數。
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
              <tr>
                <th className="py-2.5 px-4 w-10"></th>
                <th className="py-2.5 px-3">週別 (ISO Week)</th>
                <th className="py-2.5 px-3">週期區間 (週一~週日)</th>
                <th className="py-2.5 px-3 text-right">預計天數</th>
                <th className="py-2.5 px-3 text-right">實際天數</th>
                <th className="py-2.5 px-3 text-right">差異</th>
                <th className="py-2.5 px-4 min-w-[200px]">每週工時對比條（橘:預計 / 綠紅:實際）</th>
                <th className="py-2.5 px-4 text-right">涉及機種</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {weeklyStats.map((wk) => {
                const isExpanded = expandedWeekKey === wk.weekKey;
                const hasBreakdown = wk.breakdown.length > 0;
                const pPct = Math.round((wk.plannedDays / totals.maxDays) * 100);
                const aPct = Math.round((wk.actualDays / totals.maxDays) * 100);

                return (
                  <React.Fragment key={wk.weekKey}>
                    <tr
                      onClick={() =>
                        hasBreakdown &&
                        setExpandedWeekKey(isExpanded ? null : wk.weekKey)
                      }
                      className={`${
                        hasBreakdown ? 'cursor-pointer hover:bg-slate-50' : 'bg-white'
                      } transition-colors`}
                    >
                      <td className="py-2.5 px-4 text-slate-400">
                        {hasBreakdown &&
                          (isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-700" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          ))}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {wk.weekKey}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                        {wk.weekStart} ~ {wk.weekEnd}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-700 tabular-nums">
                        {wk.plannedDays} 天
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700 tabular-nums">
                        {wk.actualDays} 天
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums ${
                          wk.diffDays > 0
                            ? 'text-rose-700'
                            : wk.diffDays < 0
                            ? 'text-emerald-700'
                            : 'text-slate-400'
                        }`}
                      >
                        {wk.diffDays > 0 ? `+${wk.diffDays}` : wk.diffDays}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="space-y-1">
                          <div className="h-1.5 bg-slate-100 rounded-xs overflow-hidden">
                            <div
                              style={{
                                width: `${wk.plannedDays > 0 ? Math.max(pPct, 4) : 0}%`,
                              }}
                              className="h-full bg-amber-400"
                            />
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-xs overflow-hidden">
                            <div
                              style={{
                                width: `${wk.actualDays > 0 ? Math.max(aPct, 4) : 0}%`,
                              }}
                              className={`h-full ${
                                wk.actualDays > wk.plannedDays && wk.plannedDays > 0
                                  ? 'bg-rose-500'
                                  : 'bg-emerald-500'
                              }`}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-slate-600 tabular-nums">
                        {wk.activeModelsCount > 0 ? `${wk.activeModelsCount} 款` : '—'}
                      </td>
                    </tr>

                    {isExpanded && hasBreakdown && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={8} className="px-10 py-3">
                          <div className="border border-slate-200 bg-white rounded-md overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                                  <th className="py-1.5 px-3 text-left">序號 · 機種名稱</th>
                                  <th className="py-1.5 px-3 text-left">DFM REVIEW 任務</th>
                                  <th className="py-1.5 px-3 text-right">該週預計天數</th>
                                  <th className="py-1.5 px-3 text-right">該週實際天數</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {wk.breakdown.map((b) => (
                                  <tr key={b.taskId}>
                                    <td className="py-1.5 px-3 font-mono font-semibold text-slate-800">
                                      #{b.seqNo} ·{' '}
                                      <span className="text-blue-700">{b.modelName}</span>
                                    </td>
                                    <td className="py-1.5 px-3 text-slate-700">{b.taskName}</td>
                                    <td className="py-1.5 px-3 text-right font-mono font-semibold text-amber-700 tabular-nums">
                                      {b.plannedDays} 天
                                    </td>
                                    <td className="py-1.5 px-3 text-right font-mono font-semibold text-emerald-700 tabular-nums">
                                      {b.actualDays} 天
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
