import { HolidayItem } from '../types/schedule';

interface HolidaySeed {
  date: string;
  name: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const toISO = (year: number, month: number, day: number): string =>
  `${year}-${pad2(month)}-${pad2(day)}`;

const addDaysISO = (iso: string, offset: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offset));
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};

const getDayOfWeek = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
};

/**
 * 21st-century Qingming solar term calculation (April 4 or 5)
 */
const getQingmingDay = (year: number): number => {
  const y2 = year % 100;
  return Math.floor(y2 * 0.2422 + 4.81) - Math.floor(y2 / 4);
};

/**
 * 2023~2027: Verified official Taiwan Directorate-General of Personnel Administration (人事行政總處) calendars
 * including statutory holidays, compensatory holidays (補假), and 2023~2025 Spring Festival adjusted leaves.
 */
const OFFICIAL_2023_TO_2027: HolidaySeed[] = [
  // ===== 2023 (民國 112 年) =====
  { date: '2023-01-01', name: '開國紀念日 (元旦)' },
  { date: '2023-01-02', name: '開國紀念日補假' },
  { date: '2023-01-20', name: '農曆春節調整放假' },
  { date: '2023-01-21', name: '農曆除夕' },
  { date: '2023-01-22', name: '農曆春節初一' },
  { date: '2023-01-23', name: '農曆春節初二' },
  { date: '2023-01-24', name: '農曆春節初三' },
  { date: '2023-01-25', name: '農曆除夕補假' },
  { date: '2023-01-26', name: '農曆春節初一補假' },
  { date: '2023-01-27', name: '農曆春節調整放假' },
  { date: '2023-02-27', name: '和平紀念日調整放假' },
  { date: '2023-02-28', name: '和平紀念日' },
  { date: '2023-04-03', name: '兒童節及清明節調整放假' },
  { date: '2023-04-04', name: '兒童節' },
  { date: '2023-04-05', name: '民族掃墓節 (清明節)' },
  { date: '2023-05-01', name: '勞動節' },
  { date: '2023-06-22', name: '端午節' },
  { date: '2023-06-23', name: '端午節調整放假' },
  { date: '2023-09-29', name: '中秋節' },
  { date: '2023-10-09', name: '國慶日調整放假' },
  { date: '2023-10-10', name: '國慶日' },

  // ===== 2024 (民國 113 年) =====
  { date: '2024-01-01', name: '開國紀念日 (元旦)' },
  { date: '2024-02-08', name: '小年夜彈性放假' },
  { date: '2024-02-09', name: '農曆除夕' },
  { date: '2024-02-10', name: '農曆春節初一' },
  { date: '2024-02-11', name: '農曆春節初二' },
  { date: '2024-02-12', name: '農曆春節初三' },
  { date: '2024-02-13', name: '農曆春節初一補假' },
  { date: '2024-02-14', name: '農曆春節初二補假' },
  { date: '2024-02-28', name: '和平紀念日' },
  { date: '2024-04-04', name: '兒童節與民族掃墓節 (清明節)' },
  { date: '2024-04-05', name: '兒童節補假' },
  { date: '2024-05-01', name: '勞動節' },
  { date: '2024-06-10', name: '端午節' },
  { date: '2024-09-17', name: '中秋節' },
  { date: '2024-10-10', name: '國慶日' },

  // ===== 2025 (民國 114 年，含年中新法新增 4+1 假日) =====
  { date: '2025-01-01', name: '開國紀念日 (元旦)' },
  { date: '2025-01-27', name: '小年夜彈性放假' },
  { date: '2025-01-28', name: '農曆除夕' },
  { date: '2025-01-29', name: '農曆春節初一' },
  { date: '2025-01-30', name: '農曆春節初二' },
  { date: '2025-01-31', name: '農曆春節初三' },
  { date: '2025-02-28', name: '和平紀念日' },
  { date: '2025-04-03', name: '兒童節補假' },
  { date: '2025-04-04', name: '兒童節與民族掃墓節 (清明節)' },
  { date: '2025-05-01', name: '勞動節' },
  { date: '2025-05-30', name: '端午節補假' },
  { date: '2025-05-31', name: '端午節' },
  { date: '2025-09-28', name: '教師節 (孔子誕辰紀念日)' },
  { date: '2025-09-29', name: '教師節補假' },
  { date: '2025-10-06', name: '中秋節' },
  { date: '2025-10-10', name: '國慶日' },
  { date: '2025-10-24', name: '臺灣光復節補假' },
  { date: '2025-10-25', name: '臺灣光復暨金門古寧頭大捷紀念日' },
  { date: '2025-12-25', name: '行憲紀念日' },

  // ===== 2026 (民國 115 年，零補班新制) =====
  { date: '2026-01-01', name: '開國紀念日 (元旦)' },
  { date: '2026-02-15', name: '小年夜' },
  { date: '2026-02-16', name: '農曆除夕' },
  { date: '2026-02-17', name: '農曆春節初一' },
  { date: '2026-02-18', name: '農曆春節初二' },
  { date: '2026-02-19', name: '農曆春節初三' },
  { date: '2026-02-20', name: '小年夜補假' },
  { date: '2026-02-27', name: '和平紀念日補假' },
  { date: '2026-02-28', name: '和平紀念日' },
  { date: '2026-04-03', name: '兒童節補假' },
  { date: '2026-04-04', name: '兒童節' },
  { date: '2026-04-05', name: '民族掃墓節 (清明節)' },
  { date: '2026-04-06', name: '清明節補假' },
  { date: '2026-05-01', name: '勞動節' },
  { date: '2026-06-19', name: '端午節' },
  { date: '2026-09-25', name: '中秋節' },
  { date: '2026-09-28', name: '教師節 (孔子誕辰紀念日)' },
  { date: '2026-10-09', name: '國慶日補假' },
  { date: '2026-10-10', name: '國慶日' },
  { date: '2026-10-25', name: '臺灣光復暨金門古寧頭大捷紀念日' },
  { date: '2026-10-26', name: '臺灣光復節補假' },
  { date: '2026-12-25', name: '行憲紀念日' },

  // ===== 2027 (民國 116 年，零補班新制) =====
  { date: '2027-01-01', name: '開國紀念日 (元旦)' },
  { date: '2027-02-04', name: '小年夜' },
  { date: '2027-02-05', name: '農曆除夕' },
  { date: '2027-02-06', name: '農曆春節初一' },
  { date: '2027-02-07', name: '農曆春節初二' },
  { date: '2027-02-08', name: '農曆春節初三' },
  { date: '2027-02-09', name: '農曆春節初一補假' },
  { date: '2027-02-10', name: '農曆春節初二補假' },
  { date: '2027-02-28', name: '和平紀念日' },
  { date: '2027-03-01', name: '和平紀念日補假' },
  { date: '2027-04-04', name: '兒童節' },
  { date: '2027-04-05', name: '民族掃墓節 (清明節)' },
  { date: '2027-04-06', name: '兒童節補假' },
  { date: '2027-04-30', name: '勞動節補假' },
  { date: '2027-05-01', name: '勞動節' },
  { date: '2027-06-09', name: '端午節' },
  { date: '2027-09-15', name: '中秋節' },
  { date: '2027-09-28', name: '教師節 (孔子誕辰紀念日)' },
  { date: '2027-10-10', name: '國慶日' },
  { date: '2027-10-11', name: '國慶日補假' },
  { date: '2027-10-25', name: '臺灣光復暨金門古寧頭大捷紀念日' },
  { date: '2027-12-24', name: '行憲紀念日補假' },
  { date: '2027-12-25', name: '行憲紀念日' },
  { date: '2027-12-31', name: '2028開國紀念日補假' },
];

/**
 * Taiwan CWA 120°E lunar festival dates for 2028~2033
 * (CNY 初一, Dragon Boat 端午, Mid-Autumn 中秋)
 */
const LUNAR_2028_TO_2033: Record<
  number,
  { cny: string; dragon: string; midAutumn: string }
> = {
  2028: { cny: '2028-01-26', dragon: '2028-05-28', midAutumn: '2028-10-03' },
  2029: { cny: '2029-02-13', dragon: '2029-06-16', midAutumn: '2029-09-22' },
  2030: { cny: '2030-02-03', dragon: '2030-06-05', midAutumn: '2030-09-12' },
  2031: { cny: '2031-01-23', dragon: '2031-06-24', midAutumn: '2031-10-01' },
  2032: { cny: '2032-02-11', dragon: '2032-06-12', midAutumn: '2032-09-19' },
  2033: { cny: '2033-01-31', dragon: '2033-06-01', midAutumn: '2033-09-08' },
};

function generateHolidaysFor2028To2033(): HolidaySeed[] {
  const map = new Map<string, string>();
  const add = (date: string, name: string) => {
    if (!map.has(date)) map.set(date, name);
  };

  const applySingleDayWithComp = (date: string, name: string) => {
    add(date, name);
    const dow = getDayOfWeek(date);
    if (dow === 6) {
      // Saturday -> preceding workday
      let cand = addDaysISO(date, -1);
      while (getDayOfWeek(cand) === 0 || getDayOfWeek(cand) === 6 || map.has(cand)) {
        cand = addDaysISO(cand, -1);
      }
      add(cand, `${name}補假`);
    } else if (dow === 0) {
      // Sunday -> following workday
      let cand = addDaysISO(date, 1);
      while (getDayOfWeek(cand) === 0 || getDayOfWeek(cand) === 6 || map.has(cand)) {
        cand = addDaysISO(cand, 1);
      }
      add(cand, `${name}補假`);
    }
  };

  for (let year = 2028; year <= 2033; year++) {
    const lunar = LUNAR_2028_TO_2033[year];

    // 1. 開國紀念日 (元旦) 1/1
    const jan1 = toISO(year, 1, 1);
    add(jan1, '開國紀念日 (元旦)');
    const jan1Dow = getDayOfWeek(jan1);
    if (jan1Dow === 6) {
      add(addDaysISO(jan1, -1), `${year}開國紀念日補假`);
    } else if (jan1Dow === 0) {
      add(addDaysISO(jan1, 1), '開國紀念日補假');
    }

    // 2. 農曆春節：小年夜(-2)、除夕(-1)、初一(0)、初二(+1)、初三(+2)
    const cnyOffsets: { offset: number; label: string }[] = [
      { offset: -2, label: '小年夜' },
      { offset: -1, label: '農曆除夕' },
      { offset: 0, label: '農曆春節初一' },
      { offset: 1, label: '農曆春節初二' },
      { offset: 2, label: '農曆春節初三' },
    ];
    const weekendSpringLabels: string[] = [];
    for (const item of cnyOffsets) {
      const d = addDaysISO(lunar.cny, item.offset);
      add(d, item.label);
      const dow = getDayOfWeek(d);
      if (dow === 6 || dow === 0) {
        weekendSpringLabels.push(item.label);
      }
    }
    let compCursor = addDaysISO(lunar.cny, 3);
    for (const label of weekendSpringLabels) {
      while (
        getDayOfWeek(compCursor) === 0 ||
        getDayOfWeek(compCursor) === 6 ||
        map.has(compCursor)
      ) {
        compCursor = addDaysISO(compCursor, 1);
      }
      add(compCursor, `${label}補假`);
    }

    // 3. 和平紀念日 2/28
    applySingleDayWithComp(toISO(year, 2, 28), '和平紀念日');

    // 4. 兒童節 (4/4) & 清明節 (4/4 or 4/5)
    const qmDay = getQingmingDay(year);
    const childrenDate = toISO(year, 4, 4);
    const qingmingDate = toISO(year, 4, qmDay);
    if (childrenDate === qingmingDate) {
      add(childrenDate, '兒童節與民族掃墓節 (清明節)');
      const dow = getDayOfWeek(childrenDate);
      if (dow === 4) {
        add(addDaysISO(childrenDate, 1), '兒童節補假');
      } else if (dow === 0) {
        add(addDaysISO(childrenDate, 1), '兒童節補假');
        add(addDaysISO(childrenDate, 2), '清明節補假');
      } else if (dow === 6) {
        add(addDaysISO(childrenDate, -1), '兒童節補假');
        add(addDaysISO(childrenDate, 2), '清明節補假');
      } else if (dow === 1) {
        add(addDaysISO(childrenDate, 1), '兒童節補假');
      } else {
        // Tue/Wed/Fri -> preceding workday
        let cand = addDaysISO(childrenDate, -1);
        while (getDayOfWeek(cand) === 0 || getDayOfWeek(cand) === 6 || map.has(cand)) {
          cand = addDaysISO(cand, -1);
        }
        add(cand, '兒童節補假');
      }
    } else {
      // Children's Day 4/4 & Qingming 4/5
      add(childrenDate, '兒童節');
      add(qingmingDate, '民族掃墓節 (清明節)');
      const cDow = getDayOfWeek(childrenDate);
      const qDow = getDayOfWeek(qingmingDate);
      if (cDow === 6) {
        add(addDaysISO(childrenDate, -1), '兒童節補假');
      } else if (cDow === 0) {
        add(addDaysISO(qingmingDate, 1), '兒童節補假');
      }
      if (qDow === 6) {
        let cand = addDaysISO(qingmingDate, -1);
        while (getDayOfWeek(cand) === 0 || getDayOfWeek(cand) === 6 || map.has(cand)) {
          cand = addDaysISO(cand, -1);
        }
        add(cand, '清明節補假');
      } else if (qDow === 0) {
        let cand = addDaysISO(qingmingDate, 1);
        while (getDayOfWeek(cand) === 0 || getDayOfWeek(cand) === 6 || map.has(cand)) {
          cand = addDaysISO(cand, 1);
        }
        add(cand, '清明節補假');
      }
    }

    // 5. 勞動節 5/1
    applySingleDayWithComp(toISO(year, 5, 1), '勞動節');

    // 6. 端午節
    applySingleDayWithComp(lunar.dragon, '端午節');

    // 7. 中秋節 & 教師節 9/28 (handle ordering so compensatory dates don't collide)
    applySingleDayWithComp(toISO(year, 9, 28), '教師節 (孔子誕辰紀念日)');
    applySingleDayWithComp(lunar.midAutumn, '中秋節');

    // 8. 國慶日 10/10
    applySingleDayWithComp(toISO(year, 10, 10), '國慶日');

    // 9. 臺灣光復暨金門古寧頭大捷紀念日 10/25
    applySingleDayWithComp(toISO(year, 10, 25), '臺灣光復暨金門古寧頭大捷紀念日');

    // 10. 行憲紀念日 12/25
    applySingleDayWithComp(toISO(year, 12, 25), '行憲紀念日');
  }

  return Array.from(map.entries())
    .map(([date, name]) => ({ date, name }))
    .filter((item) => {
      const y = Number(item.date.slice(0, 4));
      return y >= 2028 && y <= 2033;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const TAIWAN_HOLIDAY_YEAR_MIN = 2023;
export const TAIWAN_HOLIDAY_YEAR_MAX = 2033;

export const TAIWAN_HOLIDAY_YEARS = Array.from(
  { length: TAIWAN_HOLIDAY_YEAR_MAX - TAIWAN_HOLIDAY_YEAR_MIN + 1 },
  (_, i) => TAIWAN_HOLIDAY_YEAR_MIN + i
);

export const TAIWAN_OFFICIAL_HOLIDAYS_2023_2033: HolidayItem[] = [
  ...OFFICIAL_2023_TO_2027,
  ...generateHolidaysFor2028To2033(),
]
  .map((item) => ({
    date: item.date,
    name: item.name,
    type: 'holiday' as const,
  }))
  .sort((a, b) => a.date.localeCompare(b.date));

/**
 * Merge Taiwan 2023–2033 national & compensatory holidays into an existing holiday list
 * strictly appending only dates not yet present in `existing`, so manually added
 * factory_off, makeup_workday, event, or custom holiday items are never overwritten.
 */
export function mergeTaiwanHolidays2023To2033(existing: HolidayItem[]): HolidayItem[] {
  const existingDates = new Set(existing.map((h) => h.date.trim()));
  const additions = TAIWAN_OFFICIAL_HOLIDAYS_2023_2033.filter(
    (tw) => !existingDates.has(tw.date.trim())
  );
  return [...existing, ...additions].sort((a, b) => a.date.localeCompare(b.date));
}
