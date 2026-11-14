import React, { useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { CalendarDayEntryType, HolidayItem } from '../types/schedule';
import {
  TAIWAN_HOLIDAY_YEAR_MAX,
  TAIWAN_HOLIDAY_YEAR_MIN,
  TAIWAN_HOLIDAY_YEARS,
} from '../data/taiwanHolidays';
import { buildHolidayMap, generateCalendarDays } from '../utils/dateUtils';

interface HolidayCalendarViewProps {
  holidays: HolidayItem[];
  onAddHoliday: (item: HolidayItem) => void;
  onRemoveHoliday: (dateStr: string) => void;
  onSyncTaiwanHolidays: () => void;
}

const DISPLAY_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const ENTRY_TYPE_META: Record<
  CalendarDayEntryType,
  {
    label: string;
    shortLabel: string;
    defaultName: string;
    placeholder: string;
    calendarClass: string;
    dotClass: string;
    textClass: string;
  }
> = {
  factory_off: {
    label: '廠休 / 盤點日（不計工作天）',
    shortLabel: '廠休/盤點',
    defaultName: '廠休 / 盤點日',
    placeholder: '例如：年中盤點日、廠區歲修',
    calendarClass: 'bg-orange-300 text-orange-950 font-bold ring-1 ring-orange-500',
    dotClass: 'bg-orange-300 border border-orange-500',
    textClass: 'text-orange-700',
  },
  makeup_workday: {
    label: '調班 / 補班工作天（將假日或週末轉為工作天）',
    shortLabel: '調班工作天',
    defaultName: '調班補上班日',
    placeholder: '例如：廠休調班、盤點補班日',
    calendarClass: 'bg-teal-300 text-teal-950 font-bold ring-1 ring-teal-600',
    dotClass: 'bg-teal-300 border border-teal-600',
    textClass: 'text-teal-700',
  },
  event: {
    label: '展覽 / 活動（非假日，仍計入工作天）',
    shortLabel: '展覽/活動',
    defaultName: '展覽 / 活動行程',
    placeholder: '例如：COMPUTEX 展覽、客戶稽核',
    calendarClass: 'bg-indigo-300 text-indigo-950 font-bold ring-1 ring-indigo-500',
    dotClass: 'bg-indigo-300 border border-indigo-500',
    textClass: 'text-indigo-700',
  },
  holiday: {
    label: '國定假日 / 補假（不計工作天）',
    shortLabel: '國定/補假',
    defaultName: '國定假日',
    placeholder: '例如：端午節、中秋補假',
    calendarClass: 'bg-amber-300 text-slate-950 font-bold ring-1 ring-amber-500',
    dotClass: 'bg-amber-300 border border-amber-500',
    textClass: 'text-amber-700',
  },
};

export const HolidayCalendarView: React.FC<HolidayCalendarViewProps> = ({
  holidays,
  onAddHoliday,
  onRemoveHoliday,
  onSyncTaiwanHolidays,
}) => {
  const [selectedYear, setSelectedYear] = useState(2026);
  const [newDate, setNewDate] = useState('2026-08-14');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<CalendarDayEntryType>('factory_off');
  const [quickPaintType, setQuickPaintType] = useState<CalendarDayEntryType>('factory_off');
  const [listFilterType, setListFilterType] = useState<'ALL' | CalendarDayEntryType>('ALL');

  const holidayMap = useMemo(() => buildHolidayMap(holidays), [holidays]);

  const sortedHolidays = useMemo(
    () => [...holidays].sort((a, b) => a.date.localeCompare(b.date)),
    [holidays]
  );

  const yearFilteredHolidays = useMemo(
    () =>
      sortedHolidays.filter((h) => {
        if (!h.date.startsWith(`${selectedYear}-`)) return false;
        if (listFilterType !== 'ALL' && h.type !== listFilterType) return false;
        return true;
      }),
    [sortedHolidays, selectedYear, listFilterType]
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
      name: newName.trim() || ENTRY_TYPE_META[newType].defaultName,
      type: newType,
    });
    setNewName('');
  };

  const handleCalendarDayClick = (dateStr: string) => {
    const existing = holidayMap.get(dateStr);
    if (existing && existing.type === quickPaintType) {
      onRemoveHoliday(dateStr);
    } else {
      onAddHoliday({
        date: dateStr,
        name: ENTRY_TYPE_META[quickPaintType].defaultName,
        type: quickPaintType,
      });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Add & Manage Year-Filtered Calendar Entries */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-6 h-fit">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            廠休 / 調班 / 展覽與國定假日設定
          </h2>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            系統已自動帶入 2023–2033 年台灣國定假日與補休日；「廠休 / 盤點」、「調班工作天」（將假日/週末轉為工作天）及「展覽 / 活動」（註記行程且維持計入工作天）可由您自行填寫或點擊右側月曆標記。
          </p>
          <button
            type="button"
            onClick={onSyncTaiwanHolidays}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            補齊台灣 2023–2033 國定假日與補休日
          </button>
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
              類別
            </label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as CalendarDayEntryType)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="factory_off">{ENTRY_TYPE_META.factory_off.label}</option>
              <option value="makeup_workday">{ENTRY_TYPE_META.makeup_workday.label}</option>
              <option value="event">{ENTRY_TYPE_META.event.label}</option>
              <option value="holiday">{ENTRY_TYPE_META.holiday.label}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              事項名稱
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={ENTRY_TYPE_META[newType].placeholder}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
          </div>

          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            新增{ENTRY_TYPE_META[newType].shortLabel}
          </button>
        </form>

        <div className="pt-4 border-t border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">
              {selectedYear} 年已登錄假日清單
            </span>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              共 {yearFilteredHolidays.length} 日
            </span>
          </div>

          <div className="flex flex-wrap gap-1">
            {(
              [
                { id: 'ALL', label: '全部' },
                { id: 'factory_off', label: '廠休/盤點' },
                { id: 'makeup_workday', label: '調班工作天' },
                { id: 'event', label: '展覽/活動' },
                { id: 'holiday', label: '國定/補假' },
              ] as { id: 'ALL' | CalendarDayEntryType; label: string }[]
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setListFilterType(f.id)}
                className={`px-2 py-1 text-[11px] font-medium rounded border transition-colors ${
                  listFilterType === f.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {yearFilteredHolidays.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">
              {selectedYear} 年此分類尚無登錄項目。
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 max-h-[380px] overflow-y-auto">
              {yearFilteredHolidays.map((h) => {
                const meta = ENTRY_TYPE_META[h.type] || ENTRY_TYPE_META.holiday;
                return (
                  <li
                    key={h.date}
                    className="py-2.5 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                      <span className={`inline-block w-2.5 h-2.5 rounded-xs shrink-0 ${meta.dotClass}`} />
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {h.date}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-slate-700">{h.name}</span>
                      <span className={`text-[11px] font-medium ${meta.textClass}`}>
                        {meta.shortLabel}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveHoliday(h.date)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors shrink-0"
                      title="移除此項目"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Right: Interactive 12-Month Calendar with Quick-Mark Mode & 2023-2033 Year Switcher */}
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-700" />
              {selectedYear} 年 1–12 月排程工作日曆（點擊日期快速切換標記）
            </h3>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 mt-1.5">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-xs bg-purple-100 border border-purple-300" />
                週六/日例假
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className={`inline-block w-3 h-3 rounded-xs ${ENTRY_TYPE_META.holiday.dotClass}`} />
                國定/補假（不計工時）
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className={`inline-block w-3 h-3 rounded-xs ${ENTRY_TYPE_META.factory_off.dotClass}`} />
                廠休/盤點（不計工時）
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className={`inline-block w-3 h-3 rounded-xs ${ENTRY_TYPE_META.makeup_workday.dotClass}`} />
                調班工作天（計入工時）
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className={`inline-block w-3 h-3 rounded-xs ${ENTRY_TYPE_META.event.dotClass}`} />
                展覽/活動（計入工時）
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() =>
                handleYearChange(Math.max(TAIWAN_HOLIDAY_YEAR_MIN, selectedYear - 1))
              }
              disabled={selectedYear <= TAIWAN_HOLIDAY_YEAR_MIN}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-white disabled:opacity-40 rounded transition-colors"
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
              {Array.from(new Set([...TAIWAN_HOLIDAY_YEARS, selectedYear]))
                .sort((a, b) => a - b)
                .map((yr) => (
                  <option key={yr} value={yr}>
                    {yr} 年
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={() =>
                handleYearChange(Math.min(TAIWAN_HOLIDAY_YEAR_MAX, selectedYear + 1))
              }
              disabled={selectedYear >= TAIWAN_HOLIDAY_YEAR_MAX}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-white disabled:opacity-40 rounded transition-colors"
              title="後一年"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick-Mark Mode Bar */}
        <div className="flex flex-wrap items-center gap-2 mb-5 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
          <span className="text-xs font-semibold text-slate-700 mr-1">
            點擊月曆日期快速標記為：
          </span>
          {(
            ['factory_off', 'makeup_workday', 'event', 'holiday'] as CalendarDayEntryType[]
          ).map((mode) => {
            const meta = ENTRY_TYPE_META[mode];
            const active = quickPaintType === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setQuickPaintType(mode)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <span className={`inline-block w-2.5 h-2.5 rounded-xs ${meta.dotClass}`} />
                {meta.shortLabel}
              </button>
            );
          })}
          <span className="text-[11px] text-slate-500 ml-auto">
            再次點擊同類型日期即可取消標記
          </span>
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
                    const entry = holidayMap.get(d.dateStr);
                    let cls = 'bg-white text-slate-700 hover:bg-slate-100';
                    if (entry) {
                      cls = (ENTRY_TYPE_META[entry.type] || ENTRY_TYPE_META.holiday).calendarClass;
                    } else if (d.isWeekend) {
                      cls = 'bg-purple-100/80 text-purple-900 hover:bg-purple-200/70';
                    }

                    return (
                      <button
                        key={d.dateStr}
                        type="button"
                        onClick={() => handleCalendarDayClick(d.dateStr)}
                        title={
                          entry
                            ? `${d.dateStr} [${(ENTRY_TYPE_META[entry.type] || ENTRY_TYPE_META.holiday).shortLabel}] ${entry.name}`
                            : `${d.dateStr}（點擊標記為 ${ENTRY_TYPE_META[quickPaintType].shortLabel}）`
                        }
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
