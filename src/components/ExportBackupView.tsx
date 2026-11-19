import React, { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload, RotateCcw, Check, HardDrive } from 'lucide-react';
import {
  ExcelThemeMode,
  ExportOptions,
  HolidayItem,
  ProjectModel,
} from '../types/schedule';
import {
  formatBytesHuman,
  getStorageDiagnostics,
  StorageDiagnostics,
} from '../utils/storage';
import {
  getLastWeekRange,
  getThisMonthRange,
  getThisWeekRange,
} from '../utils/dateUtils';

interface ExportBackupViewProps {
  allProjects: ProjectModel[];
  filteredProjects: ProjectModel[];
  holidays: HolidayItem[];
  defaultStartDate: string;
  defaultEndDate: string;
  onTriggerExcelExport: (options: ExportOptions) => Promise<void>;
  onImportBackupData: (projects: ProjectModel[], holidays?: HolidayItem[]) => void;
  onResetDefaultData: () => void;
}

export const ExportBackupView: React.FC<ExportBackupViewProps> = ({
  allProjects,
  filteredProjects,
  holidays,
  defaultStartDate,
  defaultEndDate,
  onTriggerExcelExport,
  onImportBackupData,
  onResetDefaultData,
}) => {
  const [filename, setFilename] = useState('NPI_專案管理排程追控表_2026');
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [theme, setTheme] = useState<ExcelThemeMode>('classic_npi');
  const [includeSummarySheet, setIncludeSummarySheet] = useState(true);
  const [includeWeeklyDfmSheet, setIncludeWeeklyDfmSheet] = useState(true);
  const [onlyFilteredRows, setOnlyFilteredRows] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [storageDiag, setStorageDiag] = useState<StorageDiagnostics | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    getStorageDiagnostics(allProjects, holidays).then((diag) => {
      if (active) setStorageDiag(diag);
    });
    return () => {
      active = false;
    };
  }, [allProjects, holidays]);

  const handleExcelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (startDate > endDate) {
      setFeedbackMsg('匯出起始日期不可晚於結束日期');
      return;
    }
    setIsExporting(true);
    setFeedbackMsg(null);
    try {
      await onTriggerExcelExport({
        filename,
        startDate,
        endDate,
        theme,
        includeSummarySheet,
        includeWeeklyDfmSheet,
        onlyFilteredRows,
      });
      setFeedbackMsg('已成功產生並下載 Excel (.xlsx) 排程追控報表');
    } catch {
      setFeedbackMsg('匯出 Excel 時發生錯誤，請檢查日期區間設定');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      projects: allProjects,
      holidays,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename || 'NPI_schedule_backup'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setFeedbackMsg('已下載 JSON 專案排程備份檔');
  };

  const handleImportJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(String(evt.target?.result || '{}'));
        if (Array.isArray(parsed.projects)) {
          onImportBackupData(
            parsed.projects,
            Array.isArray(parsed.holidays) ? parsed.holidays : undefined
          );
          setFeedbackMsg(`成功匯入 ${parsed.projects.length} 款機種排程資料`);
        } else {
          setFeedbackMsg('檔案格式不符：找不到有效的 projects 排程陣列');
        }
      } catch {
        setFeedbackMsg('無法解析 JSON 備份檔案，請確認檔案內容正確');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const applyRangePreset = (s: string, e: string) => {
    setStartDate(s);
    setEndDate(e);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex items-start justify-between gap-4 pb-5 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
              Excel (.xlsx) 排程報表客製匯出
            </h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              匯出標準真實 Excel 活頁簿：含前 10 欄凍結窗格、DFM 預計 / 試產預計橫條、實際正常 / 超期異常 / 試產確認甘特圖色塊、專案進度摘要表，以及「每週 DFM 統計」工作表。
            </p>
          </div>
        </div>

        <form onSubmit={handleExcelSubmit} className="mt-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              匯出檔案名稱
            </label>
            <div className="flex items-center">
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                className="flex-1 px-3 py-2 text-sm font-mono border border-slate-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                required
              />
              <span className="px-3 py-2 text-sm font-mono bg-slate-100 border border-l-0 border-slate-300 rounded-r-lg text-slate-600">
                .xlsx
              </span>
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <label className="text-xs font-semibold text-slate-700">
                甘特圖日曆匯出區間
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(() => {
                  const yr = Number(startDate.slice(0, 4)) || new Date().getFullYear();
                  const lastWeek = getLastWeekRange();
                  const thisWeek = getThisWeekRange();
                  const thisMonth = getThisMonthRange();
                  return [
                    { label: '上週', s: lastWeek.start, e: lastWeek.end },
                    { label: '本週', s: thisWeek.start, e: thisWeek.end },
                    { label: '本月', s: thisMonth.start, e: thisMonth.end },
                    { label: 'Q1', s: `${yr}-01-01`, e: `${yr}-03-31` },
                    { label: 'Q2', s: `${yr}-04-01`, e: `${yr}-06-30` },
                    { label: 'Q3', s: `${yr}-07-01`, e: `${yr}-09-30` },
                    { label: 'Q4', s: `${yr}-10-01`, e: `${yr}-12-31` },
                    { label: '上半年全覽', s: `${yr}-01-01`, e: `${yr}-06-30` },
                    { label: '下半年全覽', s: `${yr}-07-01`, e: `${yr}-12-31` },
                    { label: '年度全覽', s: `${yr}-01-01`, e: `${yr}-12-31` },
                  ];
                })().map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyRangePreset(preset.s, preset.e)}
                    className="px-2 py-0.5 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="block text-[11px] text-slate-500 mb-1">起始日期</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <span className="block text-[11px] text-slate-500 mb-1">結束日期</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  required
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Excel 報表配色樣式
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setTheme('classic_npi')}
                className={`p-3.5 rounded-lg border text-left transition-colors ${
                  theme === 'classic_npi'
                    ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <p className="text-xs font-bold text-slate-900">
                  經典硬體 NPI 追控表樣式（推薦）
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  亮綠完成任務格、淡紫週末標題、黃底假日、DFM 預計 / 試產預計橫條，與正常 / 超期 / 試產確認甘特圖。
                </p>
              </button>

              <button
                type="button"
                onClick={() => setTheme('modern_corp')}
                className={`p-3.5 rounded-lg border text-left transition-colors ${
                  theme === 'modern_corp'
                    ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <p className="text-xs font-bold text-slate-900">
                  現代商務深藍極簡樣式
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  深藍白字凍結標題列、柔和薄荷綠、試產預計 / 試產確認與玫瑰紅進度條，適合向主管或客戶簡報。
                </p>
              </button>
            </div>
          </div>

          <div className="space-y-2.5 pt-1">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeSummarySheet}
                onChange={(e) => setIncludeSummarySheet(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-slate-900"
              />
              <span className="text-xs font-medium text-slate-700">
                同時產生第 2 個工作表「專案進度統計摘要」（含工時差異與追控備註清單）
              </span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeWeeklyDfmSheet}
                onChange={(e) => setIncludeWeeklyDfmSheet(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-slate-900"
              />
              <span className="text-xs font-medium text-slate-700">
                同時產生第 3 個工作表「每週DFM統計」（統計每一週 DFM REVIEW 預計與實際天數）
              </span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyFilteredRows}
                onChange={(e) => setOnlyFilteredRows(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-slate-900"
              />
              <span className="text-xs font-medium text-slate-700">
                僅匯出目前篩選結果（目前篩選 {filteredProjects.length} 款 / 全部 {allProjects.length} 款機種）
              </span>
            </label>
          </div>

          {feedbackMsg && (
            <div className="px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-900 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>{feedbackMsg}</span>
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 flex items-center justify-end">
            <button
              type="submit"
              disabled={isExporting}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              {isExporting ? '正在產生 Excel 報表...' : '立即下載 Excel (.xlsx) 報表'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-6 h-fit">
        <div>
          <h3 className="text-base font-bold text-slate-900">資料備份與還原</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            所有排程與假日設定皆自動存於大容量本機資料庫（IndexedDB，突破傳統 5MB 限制）。您亦可匯出 JSON 專案快照供團隊成員載入續編。
          </p>
          {storageDiag && (
            <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 text-[11px] text-slate-600 font-mono tabular-nums">
              <div className="flex items-center justify-between font-sans">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                  <HardDrive className="w-3.5 h-3.5 text-emerald-700" />
                  {storageDiag.backend}
                </span>
                <span
                  className={
                    storageDiag.persisted ? 'text-emerald-700 font-semibold' : 'text-slate-500'
                  }
                >
                  {storageDiag.persisted ? '已啟用防清除保護' : '標準本機保存'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>專案資料體積：</span>
                <span className="text-slate-900 font-semibold">
                  {formatBytesHuman(storageDiag.projectsSizeBytes)} ({allProjects.length} 款機種)
                </span>
              </div>
              {storageDiag.quotaBytes !== null && (
                <div className="flex items-center justify-between">
                  <span>瀏覽器可用空間：</span>
                  <span className="text-slate-900 font-semibold">
                    已用 {formatBytesHuman(storageDiag.usageBytes)} / 上限{' '}
                    {formatBytesHuman(storageDiag.quotaBytes)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleExportJson}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            匯出 JSON 專案備份檔
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportJsonFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-800 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" />
            匯入 JSON 備份檔還原
          </button>
        </div>

        <div className="pt-5 border-t border-slate-200 space-y-3">
          <p className="text-xs font-semibold text-slate-700">重置系統範例資料</p>
          <p className="text-xs text-slate-500">
            若需恢復初始預設的 6 款硬體 NPI 機種（#21 ~ #26）與 2026 下半年排程範例，可點擊下方重置。
          </p>

          {confirmReset ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onResetDefaultData();
                  setConfirmReset(false);
                  setFeedbackMsg('已恢復預設 NPI 專案排程範例資料');
                }}
                className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors"
              >
                確認覆蓋並重置
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-3 py-2 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              重置為預設範例排程
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
