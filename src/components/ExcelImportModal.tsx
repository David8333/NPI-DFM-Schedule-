import React, { useMemo, useState } from 'react';
import { X, FileSpreadsheet, Check, AlertTriangle, ArrowUpDown } from 'lucide-react';
import { HolidayItem, ProjectModel } from '../types/schedule';
import {
  buildHolidayMap,
  computeActualWorkingDays,
  computePlannedWorkingDays,
  formatChineseShortDate,
  getEffectiveActualRangeDisplay,
} from '../utils/dateUtils';
import {
  ExcelParseResult,
  parseScheduleFromExcelBuffer,
} from '../utils/excelImport';
import { TAIWAN_HOLIDAY_YEARS } from '../data/taiwanHolidays';

export type ExcelImportMode = 'replace' | 'merge';

interface ExcelImportModalProps {
  initialResult: ExcelParseResult;
  rawBuffer: ArrayBuffer;
  filename: string;
  holidays: HolidayItem[];
  existingProjectsCount: number;
  onClose: () => void;
  onConfirmImport: (
    projects: ProjectModel[],
    mode: ExcelImportMode,
    detectedYear: number
  ) => void;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  initialResult,
  rawBuffer,
  filename,
  holidays,
  existingProjectsCount,
  onClose,
  onConfirmImport,
}) => {
  const [result, setResult] = useState<ExcelParseResult>(initialResult);
  const [selectedSheet, setSelectedSheet] = useState<string>(initialResult.sheetName);
  const [baseYear, setBaseYear] = useState<number>(initialResult.detectedYear);
  const [importMode, setImportMode] = useState<ExcelImportMode>('replace');
  const [isReparsing, setIsReparsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const holidayMap = useMemo(() => buildHolidayMap(holidays), [holidays]);

  const yearOptions = useMemo(() => {
    return Array.from(new Set([...TAIWAN_HOLIDAY_YEARS, baseYear])).sort(
      (a, b) => a - b
    );
  }, [baseYear]);

  const handleReparse = async (nextSheet: string, nextYear: number) => {
    setSelectedSheet(nextSheet);
    setBaseYear(nextYear);
    setIsReparsing(true);
    setParseError(null);
    try {
      const nextResult = await parseScheduleFromExcelBuffer(
        rawBuffer,
        filename,
        holidays,
        {
          targetSheetName: nextSheet,
          baseYearOverride: nextYear,
        }
      );
      setResult(nextResult);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : '解析工作表失敗，請確認格式是否正確'
      );
    } finally {
      setIsReparsing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[1px] p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <FileSpreadsheet className="w-5 h-5 text-emerald-700 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 truncate">
                匯入 Excel 排程預覽
              </h2>
              <p className="text-xs text-slate-500 font-mono truncate">{filename}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
            aria-label="關閉視窗"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Parsing Controls & Stats Strip */}
        <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="excel-sheet-select"
                  className="text-xs font-semibold text-slate-700 whitespace-nowrap"
                >
                  工作表：
                </label>
                <select
                  id="excel-sheet-select"
                  value={selectedSheet}
                  disabled={isReparsing}
                  onChange={(e) => handleReparse(e.target.value, baseYear)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-800 font-medium"
                >
                  {result.availableSheets.map((ws) => (
                    <option key={ws.name} value={ws.name}>
                      {ws.name}
                      {ws.isHidden ? ' [隱藏]' : ''}
                      {ws.hasGanttSchedule
                        ? ` (含甘特排程 · ${ws.estimatedDataRows}列)`
                        : ws.estimatedDataRows > 0
                        ? ` (${ws.estimatedDataRows}列)`
                        : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="excel-year-select"
                  className="text-xs font-semibold text-slate-700 whitespace-nowrap"
                >
                  基準年份：
                </label>
                <select
                  id="excel-year-select"
                  value={baseYear}
                  disabled={isReparsing}
                  onChange={(e) => handleReparse(selectedSheet, Number(e.target.value))}
                  className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-800 font-semibold"
                >
                  {yearOptions.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}年
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
              <span>已自動依序號由小到大排序，並將相同機種名稱整合至同一序號</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 font-mono tabular-nums">
            <span>
              機種數 <strong className="text-slate-900">{result.stats.modelCount}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>
              任務數 <strong className="text-slate-900">{result.stats.taskCount}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>
              同機種合併列數{' '}
              <strong className="text-emerald-700">
                {result.stats.mergedSameModelGroups}
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>
              日曆欄位{' '}
              <strong className="text-slate-900">
                {result.stats.calendarColumnsCount} 天
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>
              預計填充格{' '}
              <strong className="text-amber-700">
                {result.stats.paintedPlannedCells}
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>
              實際填充格{' '}
              <strong className="text-emerald-700">
                {result.stats.paintedActualCells}
              </strong>
            </span>
          </div>

          {/* Import Mode Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => setImportMode('replace')}
              className={`px-3.5 py-2.5 rounded-lg border text-left transition-colors ${
                importMode === 'replace'
                  ? 'border-slate-900 bg-white ring-1 ring-slate-900'
                  : 'border-slate-200 bg-white/60 hover:bg-white'
              }`}
            >
              <div className="text-xs font-bold text-slate-900">
                完整取代目前排程（建議整份匯入）
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                以本次 Excel 解析出的 {result.stats.modelCount} 款機種直接取代現有清單（可按復原還原）
              </div>
            </button>

            <button
              type="button"
              onClick={() => setImportMode('merge')}
              className={`px-3.5 py-2.5 rounded-lg border text-left transition-colors ${
                importMode === 'merge'
                  ? 'border-slate-900 bg-white ring-1 ring-slate-900'
                  : 'border-slate-200 bg-white/60 hover:bg-white'
              }`}
            >
              <div className="text-xs font-bold text-slate-900">
                合併至現有排程（保留既有 {existingProjectsCount} 款機種）
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                相同機種名稱會合併至同一序號內，並統一依序號由小到大排序
              </div>
            </button>
          </div>
        </div>

        {/* Body: Error / Empty / Preview Table */}
        <div className="flex-1 overflow-auto p-6">
          {parseError ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2.5 text-xs text-rose-800">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">此工作表無法解析為 NPI 排程表</p>
                <p className="mt-1">{parseError}</p>
              </div>
            </div>
          ) : result.projects.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              此工作表未偵測到任何有效的機種與任務排程列，請切換上方「工作表」再試一次。
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                    <th className="py-2.5 px-3 text-center w-14 border-r border-slate-200">
                      序號
                    </th>
                    <th className="py-2.5 px-3 text-left w-44 border-r border-slate-200">
                      機種名稱
                    </th>
                    <th className="py-2.5 px-3 text-left border-r border-slate-200">
                      任務名稱
                    </th>
                    <th className="py-2.5 px-2.5 text-center w-24 border-r border-slate-200">
                      PCB數量
                    </th>
                    <th className="py-2.5 px-2 text-center w-12 border-r border-slate-200">
                      完成
                    </th>
                    <th className="py-2.5 px-2.5 text-center w-32 border-r border-slate-200">
                      預計 (起~迄)
                    </th>
                    <th className="py-2.5 px-2.5 text-center w-32 border-r border-slate-200">
                      實際 (起~迄)
                    </th>
                    <th className="py-2.5 px-2 text-center w-20 border-r border-slate-200">
                      工作天
                    </th>
                    <th className="py-2.5 px-2 text-center w-14 border-r border-slate-200">
                      狀態
                    </th>
                    <th className="py-2.5 px-2 text-center w-20">填充格</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {result.projects.map((proj) =>
                    proj.tasks.map((task, tIdx) => {
                      const effActual = getEffectiveActualRangeDisplay(task);
                      const pDays = computePlannedWorkingDays(task, holidayMap);
                      const aDays = computeActualWorkingDays(task, holidayMap);
                      const overrideEntries = Object.values(task.dailyOverrides || {});
                      const workDots = overrideEntries.filter((v) => v === 'work').length;
                      const delayDots = overrideEntries.filter((v) => v === 'delay').length;
                      const pilotDots = overrideEntries.filter((v) => v === 'pilot').length;
                      const pauseDots = overrideEntries.filter((v) => v === 'pause').length;

                      return (
                        <tr key={task.id} className="hover:bg-slate-50/70">
                          {tIdx === 0 && (
                            <>
                              <td
                                rowSpan={proj.tasks.length}
                                className="py-2 px-3 text-center font-mono font-bold text-slate-900 bg-slate-50/50 border-r border-slate-200 align-middle tabular-nums"
                              >
                                {proj.seqNo}
                              </td>
                              <td
                                rowSpan={proj.tasks.length}
                                className="py-2 px-3 font-semibold text-blue-800 bg-slate-50/50 border-r border-slate-200 align-middle"
                              >
                                <div>{proj.modelName}</div>
                                {proj.modelSubtitle && (
                                  <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                                    {proj.modelSubtitle}
                                  </div>
                                )}
                              </td>
                            </>
                          )}
                          <td className="py-2 px-3 font-medium text-slate-800 border-r border-slate-200">
                            {task.taskName}
                          </td>
                          <td className="py-2 px-2.5 text-center font-mono tabular-nums text-slate-700 border-r border-slate-200">
                            {task.pcbMode === 'note'
                              ? task.pilotNote || '-'
                              : `預${task.plannedQty ?? '-'} / 實${task.actualQty ?? '-'}`}
                          </td>
                          <td className="py-2 px-2 text-center border-r border-slate-200">
                            {task.completed ? '☑' : '☐'}
                          </td>
                          <td className="py-2 px-2.5 text-center font-mono tabular-nums text-amber-800 border-r border-slate-200">
                            {task.plannedStart || task.plannedEnd
                              ? `${formatChineseShortDate(task.plannedStart) || '-'} ~ ${
                                  formatChineseShortDate(task.plannedEnd) || '-'
                                }`
                              : '-'}
                          </td>
                          <td className="py-2 px-2.5 text-center font-mono tabular-nums text-blue-800 border-r border-slate-200">
                            {effActual.start || effActual.end
                              ? `${formatChineseShortDate(effActual.start) || '-'} ~ ${
                                  formatChineseShortDate(effActual.end) || '-'
                                }`
                              : '-'}
                          </td>
                          <td className="py-2 px-2 text-center font-mono tabular-nums text-slate-700 border-r border-slate-200">
                            預{pDays} / 實{aDays}
                          </td>
                          <td
                            className={`py-2 px-2 text-center font-mono font-bold border-r border-slate-200 ${
                              task.status === 'C'
                                ? 'text-emerald-700'
                                : task.status === 'O'
                                ? 'text-rose-700'
                                : 'text-slate-500'
                            }`}
                          >
                            {task.status}
                          </td>
                          <td className="py-2 px-2 text-center font-mono tabular-nums text-[11px] text-slate-600">
                            {overrideEntries.length > 0 ? (
                              <span>
                                {[
                                  workDots > 0 ? `綠${workDots}` : '',
                                  delayDots > 0 ? `紅${delayDots}` : '',
                                  pilotDots > 0 ? `藍${pilotDots}` : '',
                                  pauseDots > 0 ? `灰${pauseDots}` : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            匯入後將自動保留復原紀錄，可隨時於主表點選「復原上一步」還原。
          </span>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
            >
              取消
            </button>
            <button
              type="button"
              disabled={isReparsing || Boolean(parseError) || result.projects.length === 0}
              onClick={() =>
                onConfirmImport(result.projects, importMode, result.detectedYear)
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5" />
              確認匯入排程 ({result.projects.length} 款機種)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
