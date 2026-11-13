import React, { useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { HolidayItem } from '../types/schedule';
import { buildHolidayMap, generateCalendarDays } from '../utils/dateUtils';

interface HolidayCalendarViewProps {
  holidays: HolidayItem[];
  onAddHoliday: (item: HolidayItem) => void;
  onRemoveHoliday: (dateStr: string) => void;
}

const DISPLAY_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const YEAR_OPTIONS = [2024, 2025, 2026, 2027, 2028, 2029, 2030];

export const HolidayCalendarView: React.FC<HolidayCalendarViewProps> = ({
  holidays,
  onAddHoliday,
  onRemoveHoliday,
}) => {
  const [selectedYear, setSelectedYear] = useState(2026);
  const [newDate, setNewDate] = useState('2026-08-14');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'holiday' | 'factory_off'>('factory_off');

  const holidayMap = useMemo(() => buildHolidayMap(holidays), [holidays]);

  const sortedHolidays = useMemo(
    () => [...holidays].sort((a, b) => a.date.localeCompare(b.date)),
    [holidays]
  );

  const handleYearChange = (nextYear: number) => {
    if (!Number.isFinite(nextYear) || nextYear < 2000 || nextYear > 2100) return;
    setSelectedYear(nextYear);
    setNewDate((prev) => {
      if (!prev || prev.length < 10) return `${nextYear}-01-01`;
      const month = Number(prev.slice(5, 7));
      const day = Number(prev.slice(8, 10));
      const maxDay = new Date(nextYear, month, 0).getDate();
      const clampedDay = String(Math.min(day, maxDay)).padStart(2, '0');
      return `${nextYear}-${prev.slice(5, 7)}-${clampedDay}`;
    });
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDate) return;
    onAddHoliday({
      date: newDate,
      name: newName.trim() || (newType === 'holiday' ? '國定假日' : '廠休調整日'),
      type: newType,
    });
    setNewName('');
  };

  const handleCalendarDayToggle = (dateStr: string) => {
    if (holidayMap.has(dateStr)) {
      onRemoveHoliday(dateStr);
    } else {
      onAddHoliday({
        date: dateStr,
        name: '廠休 / 專案不計工時日',
        type: 'factory_off',
      });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Add & Manage Holiday List */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-6 h-fit">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            廠休與國定假日設定
          </h2>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            設定為「國定假日」或「廠休保養日」的日期，會在排程甘特圖與匯出的 Excel 報表中以醒目黃底標示，並自動從「預計工作天」與「實際工作天」中扣除。
          </p>
        </div>

        <form onSubmit={handleAddSubmit} className="space-y-3 pt-2 border-t border-slate-200">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              選擇日期
            </label>
            <input
              type="date"
              value={newDate}
              onChange={(e) => {
                const val = e.target.value;
                setNewDate(val);
                const yr = Number(val.slice(0, 4));
                if (Number.isFinite(yr) && yr >= 2000 && yr <= 2100) {
                  setSelectedYear(yr);
                }
              }}
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              假日 / 廠休名稱
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例如：廠區盤點日、中秋連假"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              類別
            </label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as 'holiday' | 'factory_off')}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="factory_off">廠休 / 產線保養盤點日</option>
              <option value="holiday">國定假日 / 補假</option>
            </select>
          </div>

          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            新增不計工時假日
          </button>
        </form>

        <div className="pt-4 border-t border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-700">
              已登錄假日清單
            </span>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              共 {sortedHolidays.length} 日
            </span>
          </div>

          {sortedHolidays.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">
              尚未設定自訂假日，僅自動扣除週六與週日。
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 max-h-[380px] overflow-y-auto">
              {sortedHolidays.map((h) => (
                <li
                  key={h.date}
                  className="py-2.5 flex items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {h.date}
                    </span>
                    <span className="mx-1.5 text-slate-300">·</span>
                    <span className="text-slate-700">{h.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveHoliday(h.date)}
                    className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                    title="移除此假日"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right: Interactive 12-Month Calendar with Year Switcher */}
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-700" />
              {selectedYear} 年 1–12 月排程工作日曆（點擊日期快速切換廠休）
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              紫色底為週六/週日例假，黃色底為已設定之國定假日或廠休調整日
            </p>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => handleYearChange(selectedYear - 1)}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors"
              title="前一年"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <select
              value={selectedYear}
              onChange={(e) => handleYearChange(Number(e.target.value))}
              className="px-2 py-1 text-xs font-mono font-bold text-slate-900 bg-white border border-slate-200 rounded focus:outline-none"
              aria-label="選擇年份"
            >
              {Array.from(new Set([...YEAR_OPTIONS, selectedYear]))
                .sort((a, b) => a - b)
                .map((yr) => (
                  <option key={yr} value={yr}>
                    {yr} 年
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={() => handleYearChange(selectedYear + 1)}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors"
              title="後一年"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {DISPLAY_MONTHS.map((m) => {
            const mStr = String(m).padStart(2, '0');
            const lastDay = new Date(selectedYear, m, 0).getDate();
            const days = generateCalendarDays(
              `${selectedYear}-${mStr}-01`,
              `${selectedYear}-${mStr}-${String(lastDay).padStart(2, '0')}`
            );
            const firstDow = days[0]?.dayOfWeek ?? 0;

            return (
              <div key={m} className="border border-slate-200 rounded-lg p-3.5">
                <div className="text-xs font-bold text-slate-900 mb-2 text-center font-mono">
                  {selectedYear} 年 {m} 月
                </div>
                <div className="grid grid-cols-7 gap-1 text-[10px] text-center text-slate-400 font-medium mb-1">
                  <span>日</span>
                  <span>一</span>
                  <span>二</span>
                  <span>三</span>
                  <span>四</span>
                  <span>五</span>
                  <span>六</span>
                </div>
                <div className="grid grid-cols-7 gap-1 text-xs font-mono tabular-nums">
                  {Array.from({ length: firstDow }).map((_, i) => (
                    <div key={`empty-${i}`} className="h-7" />
                  ))}
                  {days.map((d) => {
                    const hol = holidayMap.get(d.dateStr);
                    let cls = 'bg-white text-slate-700 hover:bg-slate-100';
                    if (hol) {
                      cls = 'bg-amber-300 text-slate-950 font-bold ring-1 ring-amber-500';
                    } else if (d.isWeekend) {
                      cls = 'bg-purple-100/80 text-purple-900';
                    }

                    return (
                      <button
                        key={d.dateStr}
                        type="button"
                        onClick={() => handleCalendarDayToggle(d.dateStr)}
                        title={hol ? `${d.dateStr} ${hol.name}` : d.dateStr}
                        className={`h-7 rounded flex items-center justify-center transition-colors ${cls}`}
                      >
                        {d.day}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
