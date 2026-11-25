import type ExcelJS from 'exceljs';
import {
  DailyOverrideType,
  HolidayItem,
  ProjectModel,
  ProjectStage,
  ScheduleTask,
  TaskCategory,
  TaskStatus,
} from '../types/schedule';
import { buildHolidayMap, isWorkingCalendarDay } from './dateUtils';

export interface ParsedSheetCandidate {
  name: string;
  rowCount: number;
  hasGanttSchedule: boolean;
  isHidden: boolean;
  estimatedDataRows: number;
}

export interface ExcelParseResult {
  sheetName: string;
  availableSheets: ParsedSheetCandidate[];
  detectedYear: number;
  projects: ProjectModel[];
  stats: {
    modelCount: number;
    taskCount: number;
    mergedSameModelGroups: number;
    calendarColumnsCount: number;
    paintedPlannedCells: number;
    paintedActualCells: number;
  };
}

interface ParsedColumnMap {
  headerRowIdx: number;
  dayRowIdx: number;
  seqCol: number;
  modelCol: number;
  taskCol: number;
  pcbCol: number;
  doneCol: number;
  startCol: number;
  endCol: number;
  daysCol: number;
  statusCol: number;
  scheduleCol: number;
  eeCol?: number;
  meCol?: number;
  customerCol?: number;
  calendarCols: { col: number; dateStr: string }[];
}

function getEffectiveCell(sheet: ExcelJS.Worksheet, row: number, col: number): ExcelJS.Cell {
  const cell = sheet.getCell(row, col);
  if (cell.isMerged && cell.master) {
    return cell.master;
  }
  return cell;
}

function unwrapFormulaResult(val: ExcelJS.CellValue): ExcelJS.CellValue {
  if (val && typeof val === 'object' && 'result' in val && val.result !== undefined) {
    return unwrapFormulaResult(val.result as ExcelJS.CellValue);
  }
  return val;
}

function cellValueToString(val: ExcelJS.CellValue): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val).trim();
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'object') {
    if ('error' in val && val.error !== undefined) {
      return '';
    }
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText.map((part) => part.text || '').join('').trim();
    }
    if ('result' in val) {
      if (val.result !== undefined) {
        return cellValueToString(val.result as ExcelJS.CellValue);
      }
      return '';
    }
    // IMPORTANT: Hyperlinks with formatted text store `{ text: { richText: [...] }, hyperlink: '...' }`.
    // Always extract `text` recursively before ever considering `hyperlink`.
    if ('text' in val && val.text !== undefined) {
      const extractedText = cellValueToString(val.text as ExcelJS.CellValue);
      if (extractedText) return extractedText;
    }
    if ('hyperlink' in val && typeof val.hyperlink === 'string') {
      return val.hyperlink.trim();
    }
  }
  return '';
}

function getMergedText(sheet: ExcelJS.Worksheet, row: number, col: number): string {
  if (!col || col < 1) return '';
  const master = getEffectiveCell(sheet, row, col);
  const direct = cellValueToString(master.value);
  if (direct) return direct;
  if (
    master.value &&
    typeof master.value === 'object' &&
    !('error' in master.value) &&
    !('formula' in master.value) &&
    !('sharedFormula' in master.value) &&
    typeof master.text === 'string' &&
    master.text !== '[object Object]'
  ) {
    return master.text.trim();
  }
  return '';
}

function getRawCellText(sheet: ExcelJS.Worksheet, row: number, col: number): string {
  if (!col || col < 1) return '';
  const cell = sheet.getCell(row, col);
  const direct = cellValueToString(cell.value);
  if (direct) return direct;
  if (
    cell.value &&
    typeof cell.value === 'object' &&
    !('error' in cell.value) &&
    !('formula' in cell.value) &&
    !('sharedFormula' in cell.value) &&
    typeof cell.text === 'string' &&
    cell.text !== '[object Object]'
  ) {
    return cell.text.trim();
  }
  return '';
}

function parseArgbToRgb(argb?: string): [number, number, number] | null {
  if (!argb || typeof argb !== 'string') return null;
  const clean = argb.replace(/^#/, '').trim();
  if (clean.length === 8) {
    const alpha = parseInt(clean.slice(0, 2), 16);
    if (alpha === 0) return null;
    return [
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
      parseInt(clean.slice(6, 8), 16),
    ];
  }
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }
  return null;
}

const OFFICE_THEME_BASE_RGB: Record<number, [number, number, number]> = {
  0: [255, 255, 255],
  1: [0, 0, 0],
  2: [231, 230, 230],
  3: [68, 84, 106],
  4: [68, 114, 196],
  5: [237, 125, 49],
  6: [165, 165, 165],
  7: [255, 192, 0],
  8: [91, 155, 213],
  9: [112, 173, 71],
};

function applyTint(rgb: [number, number, number], tint?: number): [number, number, number] {
  if (!tint || Math.abs(tint) < 0.001) return rgb;
  return rgb.map((ch) => {
    if (tint < 0) return Math.round(ch * (1 + tint));
    return Math.round(ch + (255 - ch) * tint);
  }) as [number, number, number];
}

function extractColorRgb(
  color?: Partial<ExcelJS.Color> & { tint?: number }
): [number, number, number] | null {
  if (!color) return null;
  if (color.argb) {
    const rgb = parseArgbToRgb(color.argb);
    if (rgb) return applyTint(rgb, color.tint);
  }
  if (typeof color.theme === 'number' && OFFICE_THEME_BASE_RGB[color.theme]) {
    return applyTint(OFFICE_THEME_BASE_RGB[color.theme], color.tint);
  }
  return null;
}

function extractFillRgb(cell: ExcelJS.Cell): [number, number, number] | null {
  const fill = cell.fill;
  if (!fill || fill.type !== 'pattern' || fill.pattern === 'none') return null;
  const fg = (fill as ExcelJS.FillPattern).fgColor as
    | (Partial<ExcelJS.Color> & { tint?: number })
    | undefined;
  return extractColorRgb(fg);
}

function isNearWhiteBackground(rgb: [number, number, number]): boolean {
  const [r, g, b] = rgb;
  return Math.min(r, g, b) >= 234;
}

function classifyPlannedFill(rgb: [number, number, number] | null): boolean {
  if (!rgb) return false;
  if (isNearWhiteBackground(rgb)) return false;
  const [r, g, b] = rgb;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  return spread >= 20;
}

function hasColoredPlannedBorder(cell: ExcelJS.Cell): boolean {
  const border = cell.border;
  if (!border) return false;
  const isAccentEdge = (edge?: Partial<ExcelJS.Border>) => {
    if (!edge || !edge.style || edge.style === 'thin' || edge.style === 'hair') return false;
    const rgb = extractColorRgb(edge.color as (Partial<ExcelJS.Color> & { tint?: number }) | undefined);
    if (!rgb) return false;
    const spread = Math.max(...rgb) - Math.min(...rgb);
    return spread >= 25;
  };
  return isAccentEdge(border.top) && isAccentEdge(border.bottom);
}

function classifyActualCode(cell: ExcelJS.Cell): DailyOverrideType | null {
  const raw = unwrapFormulaResult(cell.value);
  if (raw === null || raw === undefined) return null;
  const num =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\d+$/.test(raw.trim())
      ? Number(raw.trim())
      : null;
  if (num === 2) return 'work';   // 2 = 正常綠
  if (num === 3) return 'delay';  // 3 = 超期紅
  if (num === 4) return 'pause';  // 4 = 停工灰
  if (num === 5) return 'pilot';  // 5 = 試產確認
  return null;
}

function classifyActualFill(
  rgb: [number, number, number] | null
): 'pilot' | 'work' | 'delay' | 'gray' | null {
  if (!rgb) return null;
  if (isNearWhiteBackground(rgb)) return null;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;

  // Gray (weekend/pause #D1D5DB / #CBD5E1 / #D9D9D9)
  if (spread <= 28 && r >= 130 && r <= 232) {
    return 'gray';
  }

  // Water Blue / Cyan / Sky Blue (試產確認 #38BDF8 / #00B0F0 / #00FFFF)
  if (b >= 165 && b > r + 40 && g >= 115 && b >= g - 15) {
    return 'pilot';
  }

  // Green (實際正常 #16E016 / #10B981 / #00FF00 / #92D050)
  if (g > r + 20 && g > b + 15 && g >= 110) {
    return 'work';
  }

  // Red / Rose / Magenta (超期異常 #F40058 / #F43F5E / #FF0000)
  if (r > g + 45 && r >= 150) {
    return 'delay';
  }

  return null;
}

function isGreenCompletionCell(cell: ExcelJS.Cell): boolean {
  const rgb = extractFillRgb(cell);
  if (!rgb || isNearWhiteBackground(rgb)) return false;
  const [r, g, b] = rgb;
  return g > r + 15 && g >= b && g >= 140;
}

function excelSerialToDate(serial: number): Date {
  const utcMs = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(utcMs);
}

function parseExcelDateWithMeta(
  val: ExcelJS.CellValue,
  fallbackYear: number
): { dateStr: string; hasExplicitYear: boolean } {
  if (val === null || val === undefined || val === '') {
    return { dateStr: '', hasExplicitYear: false };
  }

  const unwrapped = unwrapFormulaResult(val);
  if (unwrapped instanceof Date) {
    const y = unwrapped.getUTCFullYear();
    const m = String(unwrapped.getUTCMonth() + 1).padStart(2, '0');
    const d = String(unwrapped.getUTCDate()).padStart(2, '0');
    return { dateStr: `${y}-${m}-${d}`, hasExplicitYear: true };
  }

  if (typeof unwrapped === 'number' && unwrapped > 30000 && unwrapped < 80000) {
    const dt = excelSerialToDate(unwrapped);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return { dateStr: `${y}-${m}-${d}`, hasExplicitYear: true };
  }

  const text = cellValueToString(unwrapped);
  if (!text) return { dateStr: '', hasExplicitYear: false };

  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    return {
      dateStr: `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`,
      hasExplicitYear: true,
    };
  }

  const zhFullMatch = text.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
  if (zhFullMatch) {
    return {
      dateStr: `${zhFullMatch[1]}-${zhFullMatch[2].padStart(2, '0')}-${zhFullMatch[3].padStart(2, '0')}`,
      hasExplicitYear: true,
    };
  }

  const zhMatch = text.match(/^(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
  if (zhMatch) {
    return {
      dateStr: `${fallbackYear}-${zhMatch[1].padStart(2, '0')}-${zhMatch[2].padStart(2, '0')}`,
      hasExplicitYear: false,
    };
  }

  const mdMatch = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (mdMatch) {
    return {
      dateStr: `${fallbackYear}-${mdMatch[1].padStart(2, '0')}-${mdMatch[2].padStart(2, '0')}`,
      hasExplicitYear: false,
    };
  }

  return { dateStr: '', hasExplicitYear: false };
}

function shiftDateYear(dateStr: string, deltaYears: number): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const yr = Number(dateStr.slice(0, 4)) + deltaYears;
  return `${yr}${dateStr.slice(4)}`;
}

function adjustCrossYearPair(
  startMeta: { dateStr: string; hasExplicitYear: boolean },
  endMeta: { dateStr: string; hasExplicitYear: boolean },
  firstCalMonth: number | null
): { start: string; end: string } {
  let start = startMeta.dateStr;
  let end = endMeta.dateStr;

  // If the sheet's calendar starts in Q1 (Jan-Mar), text-only dates in Oct-Dec belong to prior year
  if (firstCalMonth !== null && firstCalMonth <= 3) {
    if (start && !startMeta.hasExplicitYear && Number(start.slice(5, 7)) >= 10) {
      start = shiftDateYear(start, -1);
    }
    if (end && !endMeta.hasExplicitYear && Number(end.slice(5, 7)) >= 10) {
      end = shiftDateYear(end, -1);
    }
  }

  // Fallback: if start > end (e.g. 12月15日 ~ 1月7日) and start lacked explicit year, move start back 1 year
  if (start && end && start > end) {
    if (!startMeta.hasExplicitYear) {
      start = shiftDateYear(start, -1);
    } else if (!endMeta.hasExplicitYear) {
      end = shiftDateYear(end, 1);
    }
  }

  return { start, end };
}

function parseMonthCellValue(
  rawText: string,
  val: ExcelJS.CellValue,
  defaultYear: number
): { month: number; year?: number } | null {
  const unwrapped = unwrapFormulaResult(val);
  if (unwrapped instanceof Date) {
    return { month: unwrapped.getUTCMonth() + 1, year: unwrapped.getUTCFullYear() };
  }
  if (typeof unwrapped === 'number' && unwrapped > 30000 && unwrapped < 80000) {
    const dt = excelSerialToDate(unwrapped);
    return { month: dt.getUTCMonth() + 1, year: dt.getUTCFullYear() };
  }
  const t = rawText.trim();
  if (!t) return null;

  const ymZh = t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (ymZh) {
    const m = Number(ymZh[2]);
    if (m >= 1 && m <= 12) return { year: Number(ymZh[1]), month: m };
  }

  const ymSlash = t.match(/^(\d{4})[-/](\d{1,2})$/);
  if (ymSlash) {
    const m = Number(ymSlash[2]);
    if (m >= 1 && m <= 12) return { year: Number(ymSlash[1]), month: m };
  }

  const mOnly = t.match(/^(\d{1,2})\s*月?$/);
  if (mOnly) {
    const m = Number(mOnly[1]);
    if (m >= 1 && m <= 12) return { month: m };
  }

  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const lower = t.toLowerCase();
  const idx = monthNames.findIndex((mn) => lower.startsWith(mn));
  if (idx >= 0) {
    const yMatch = t.match(/(\d{4})/);
    return { month: idx + 1, year: yMatch ? Number(yMatch[1]) : defaultYear };
  }

  return null;
}

function inferStageAndCategory(taskName: string): {
  stage: ProjectStage;
  stageIteration: number | null;
  taskCategory: TaskCategory;
} {
  const upper = taskName.toUpperCase().trim();
  let stage: ProjectStage = 'OTHER';
  if (upper.includes('PROTO')) stage = 'PROTO';
  else if (upper.includes('EVT')) stage = 'EVT';
  else if (upper.includes('DVT')) stage = 'DVT';
  else if (upper.includes('MVT') || upper.includes('PVT')) stage = 'MVT';
  else if (upper.includes('MP')) stage = 'MP';

  const iterMatch = upper.match(/(?:PROTO|EVT|DVT|MVT|PVT|MP)\s*(\d+)/);
  const stageIteration = iterMatch ? Number(iterMatch[1]) : null;

  let taskCategory: TaskCategory = 'other';
  if (upper.includes('DFM')) taskCategory = 'dfm';
  else if (taskName.includes('試產') || upper.includes('PILOT')) taskCategory = 'pilot';

  return { stage, stageIteration, taskCategory };
}

function parseTaskStatus(raw: string, completed: boolean): TaskStatus {
  const norm = raw.trim().toUpperCase().replace(/\//g, '');
  if (norm === 'C' || norm === 'CLOSED' || norm === '已結案') return 'C';
  if (norm === 'NA' || norm === '免評') return 'NA';
  if (norm === 'O' || norm === 'OPEN' || norm === '待結案') return 'O';
  return completed ? 'C' : 'O';
}

function scoreHeaderRow(sheet: ExcelJS.Worksheet, rowIdx: number): number {
  const maxCols = Math.min(Math.max(sheet.columnCount || 60, 60), 160);
  const seen = new Set<string>();
  let hasModel = false;

  for (let c = 1; c <= maxCols; c++) {
    const label = getMergedText(sheet, rowIdx, c).replace(/\s+/g, '');
    if (!label || label.length > 24) continue;
    if (label.includes('序號')) seen.add('seq');
    if (label.includes('機種') || label.toLowerCase().includes('model')) {
      seen.add('model');
      hasModel = true;
    }
    if ((label.includes('任務') && !label.includes('狀態')) || label.toLowerCase().includes('task')) {
      seen.add('task');
    }
    if (label.toUpperCase().includes('PCB')) seen.add('pcb');
    if (
      label === '完成' ||
      label === '問題點結案' ||
      label.includes('完成') ||
      label.includes('問題點結案')
    ) {
      seen.add('done');
    }
    if (label === '開始' || label.includes('開始')) seen.add('start');
    if (label === '結束' || label.includes('結束')) seen.add('end');
    if (label.includes('工作天')) seen.add('days');
    if (label === '狀態' || label === '任務狀態' || label.includes('狀態')) {
      seen.add('status');
    }
    if (label === '排程' || label.includes('排程')) seen.add('schedule');
  }

  if (!hasModel || seen.size < 2) return 0;
  const isHiddenRow = Boolean(sheet.getRow(rowIdx).hidden);
  return seen.size * 10 + (isHiddenRow ? 0 : 5);
}

function detectColumnsAndCalendar(
  sheet: ExcelJS.Worksheet,
  baseYear: number
): ParsedColumnMap | null {
  const maxScanRows = Math.min(Math.max(sheet.rowCount || 80, 80), 150);
  let headerRowIdx = -1;
  let bestScore = 0;

  for (let r = 1; r <= maxScanRows; r++) {
    const score = scoreHeaderRow(sheet, r);
    if (score > bestScore) {
      bestScore = score;
      headerRowIdx = r;
    }
  }

  if (headerRowIdx === -1) return null;

  let seqCol = -1;
  let modelCol = -1;
  let taskCol = -1;
  let pcbCol = -1;
  let doneCol = -1;
  let startCol = -1;
  let endCol = -1;
  let daysCol = -1;
  let statusCol = -1;
  let scheduleCol = -1;
  let eeCol: number | undefined;
  let meCol: number | undefined;
  let customerCol: number | undefined;

  const maxHeaderCol = Math.min(Math.max(sheet.columnCount || 60, 60), 160);
  let lastFixedCol = 0;

  const colScores = {
    seq: -1,
    model: -1,
    task: -1,
    pcb: -1,
    done: -1,
    start: -1,
    end: -1,
    days: -1,
    status: -1,
    schedule: -1,
  };

  const assignBestCol = (
    key: keyof typeof colScores,
    colIdx: number,
    exact: boolean,
    isHiddenCol: boolean
  ) => {
    const candidateScore = (exact ? 10 : 5) + (isHiddenCol ? 0 : 20);
    if (candidateScore > colScores[key]) {
      colScores[key] = candidateScore;
      lastFixedCol = Math.max(lastFixedCol, colIdx);
      return true;
    }
    return false;
  };

  for (let c = 1; c <= maxHeaderCol; c++) {
    const label = getMergedText(sheet, headerRowIdx, c).replace(/\s+/g, '');
    if (!label || label.length > 24) continue;
    const isHiddenCol = Boolean(sheet.getColumn(c).hidden);
    const lower = label.toLowerCase();

    if (label.includes('序號')) {
      if (assignBestCol('seq', c, label === '序號', isHiddenCol)) seqCol = c;
    } else if (label.includes('機種') || lower.includes('model')) {
      if (assignBestCol('model', c, label === '機種名稱', isHiddenCol)) modelCol = c;
    } else if (label === '狀態' || label === '任務狀態' || label.includes('狀態')) {
      if (
        assignBestCol(
          'status',
          c,
          label === '狀態' || label === '任務狀態',
          isHiddenCol
        )
      ) {
        statusCol = c;
      }
    } else if (label.includes('任務') || lower.includes('task')) {
      if (assignBestCol('task', c, label === '任務名稱', isHiddenCol)) taskCol = c;
    } else if (label.toUpperCase().includes('PCB')) {
      if (assignBestCol('pcb', c, label.toUpperCase() === 'PCB數量', isHiddenCol)) pcbCol = c;
    } else if (
      label === '完成' ||
      label === '問題點結案' ||
      label.includes('完成') ||
      label.includes('問題點結案')
    ) {
      if (
        assignBestCol(
          'done',
          c,
          label === '完成' || label === '問題點結案',
          isHiddenCol
        )
      ) {
        doneCol = c;
      }
    } else if (label === '開始' || label.includes('開始')) {
      if (assignBestCol('start', c, label === '開始', isHiddenCol)) startCol = c;
    } else if (label === '結束' || label.includes('結束')) {
      if (assignBestCol('end', c, label === '結束', isHiddenCol)) endCol = c;
    } else if (label.includes('工作天')) {
      if (assignBestCol('days', c, label === '工作天', isHiddenCol)) daysCol = c;
    } else if (label === '排程' || label.includes('排程')) {
      if (assignBestCol('schedule', c, label === '排程', isHiddenCol)) scheduleCol = c;
    } else if (!eeCol && label.toUpperCase() === 'EE') {
      eeCol = c;
    } else if (!meCol && label.toUpperCase() === 'ME') {
      meCol = c;
    } else if (!customerCol && label.includes('客戶')) {
      customerCol = c;
    }
  }

  const calStartCol =
    scheduleCol > 0
      ? Math.max(scheduleCol + 1, Math.min(lastFixedCol + 1, scheduleCol + 4))
      : lastFixedCol > 0
      ? lastFixedCol + 1
      : 11;
  let dayRowIdx = headerRowIdx + 1;
  const totalCols = sheet.columnCount || 0;

  const probeDayValue = (rowIdx: number, colIdx: number): number | null => {
    const rawVal = unwrapFormulaResult(sheet.getCell(rowIdx, colIdx).value);
    if (rawVal instanceof Date) return rawVal.getUTCDate();
    if (typeof rawVal === 'number') {
      if (rawVal > 30000 && rawVal < 80000) return excelSerialToDate(rawVal).getUTCDate();
      if (Number.isInteger(rawVal) && rawVal >= 1 && rawVal <= 31) return rawVal;
      return null;
    }
    const txt = cellValueToString(rawVal);
    if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return Number(txt.slice(8, 10));
    const n = Number(txt);
    return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
  };

  let foundDaysInNext = 0;
  for (let c = calStartCol; c <= Math.min(totalCols, calStartCol + 25); c++) {
    if (probeDayValue(dayRowIdx, c) !== null) foundDaysInNext++;
  }
  if (foundDaysInNext === 0) {
    let foundDaysInHeader = 0;
    for (let c = calStartCol; c <= Math.min(totalCols, calStartCol + 25); c++) {
      if (probeDayValue(headerRowIdx, c) !== null) foundDaysInHeader++;
    }
    if (foundDaysInHeader > 0) {
      dayRowIdx = headerRowIdx;
    }
  }

  const monthRowIdx =
    dayRowIdx === headerRowIdx && headerRowIdx > 1 ? headerRowIdx - 1 : headerRowIdx;

  const calendarCols: { col: number; dateStr: string }[] = [];
  let activeYear = baseYear;
  let prevMonth: number | null = null;
  let activeMonth: number | null = null;

  for (let c = calStartCol; c <= totalCols; c++) {
    const dayCell = sheet.getCell(dayRowIdx, c);
    const dayVal = unwrapFormulaResult(dayCell.value);

    if (dayVal instanceof Date) {
      const y = dayVal.getUTCFullYear();
      const m = dayVal.getUTCMonth() + 1;
      const d = dayVal.getUTCDate();
      activeYear = y;
      activeMonth = m;
      prevMonth = m;
      calendarCols.push({
        col: c,
        dateStr: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      });
      continue;
    }

    if (typeof dayVal === 'number' && dayVal > 30000 && dayVal < 80000) {
      const dt = excelSerialToDate(dayVal);
      const y = dt.getUTCFullYear();
      const m = dt.getUTCMonth() + 1;
      const d = dt.getUTCDate();
      activeYear = y;
      activeMonth = m;
      prevMonth = m;
      calendarCols.push({
        col: c,
        dateStr: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      });
      continue;
    }

    const dayRaw = cellValueToString(dayVal);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dayRaw)) {
      const [y, m] = dayRaw.split('-').map(Number);
      activeYear = y;
      activeMonth = m;
      prevMonth = m;
      calendarCols.push({ col: c, dateStr: dayRaw });
      continue;
    }

    const dayNum = Number(dayRaw);
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) continue;

    const mCell = getEffectiveCell(sheet, monthRowIdx, c);
    const mText = cellValueToString(mCell.value);
    const parsedMonth = parseMonthCellValue(mText, mCell.value, activeYear);

    if (parsedMonth) {
      if (parsedMonth.year) {
        activeYear = parsedMonth.year;
      } else if (prevMonth !== null && parsedMonth.month < prevMonth) {
        activeYear += 1;
      }
      activeMonth = parsedMonth.month;
      prevMonth = parsedMonth.month;
    } else if (activeMonth !== null && dayNum === 1 && calendarCols.length > 0) {
      if (activeMonth === 12) {
        activeMonth = 1;
        activeYear += 1;
      } else {
        activeMonth += 1;
      }
      prevMonth = activeMonth;
    }

    if (activeMonth !== null) {
      const dateStr = `${activeYear}-${String(activeMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      calendarCols.push({ col: c, dateStr });
    }
  }

  return {
    headerRowIdx,
    dayRowIdx,
    seqCol,
    modelCol,
    taskCol,
    pcbCol,
    doneCol,
    startCol,
    endCol,
    daysCol,
    statusCol,
    scheduleCol,
    eeCol,
    meCol,
    customerCol,
    calendarCols,
  };
}

function parseModelNameCell(raw: string): {
  modelName: string;
  modelSubtitle?: string;
  ee?: string;
  me?: string;
} {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { modelName: '' };
  const modelName = lines[0];
  let modelSubtitle: string | undefined;
  let ee: string | undefined;
  let me: string | undefined;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const eeMatch = line.match(/^EE\s*[:：]\s*(.+)$/i);
    const meMatch = line.match(/^ME\s*[:：]\s*(.+)$/i);
    if (eeMatch) ee = eeMatch[1].trim();
    else if (meMatch) me = meMatch[1].trim();
    else if (!modelSubtitle) modelSubtitle = line;
    else modelSubtitle = `${modelSubtitle} ${line}`;
  }
  return { modelName, modelSubtitle, ee, me };
}

function extractYearHint(filename: string, sheet: ExcelJS.Worksheet): number {
  const fnMatch = filename.match(/(20\d{2})/);
  if (fnMatch) return Number(fnMatch[1]);

  // First locate header row to scan calendar headers accurately (even if header starts at row 31+)
  let detectedHeaderRow = 1;
  const maxScanRows = Math.min(Math.max(sheet.rowCount || 80, 80), 150);
  let bestScore = 0;
  for (let r = 1; r <= maxScanRows; r++) {
    const sc = scoreHeaderRow(sheet, r);
    if (sc > bestScore) {
      bestScore = sc;
      detectedHeaderRow = r;
    }
  }

  const probeRows: number[] = [];
  const addProbeRange = (from: number, to: number) => {
    for (let r = Math.max(1, from); r <= Math.min(sheet.rowCount || to, to); r++) {
      if (!probeRows.includes(r)) probeRows.push(r);
    }
  };
  // Prioritize header + day rows, then just above header, then top sheet rows, then first few data rows
  addProbeRange(detectedHeaderRow, detectedHeaderRow + 1);
  addProbeRange(detectedHeaderRow - 3, detectedHeaderRow - 1);
  addProbeRange(1, 10);
  addProbeRange(detectedHeaderRow + 2, detectedHeaderRow + 10);

  for (const r of probeRows) {
    for (let c = 1; c <= Math.min(sheet.columnCount || 60, 160); c++) {
      const val = unwrapFormulaResult(sheet.getCell(r, c).value);
      if (val instanceof Date) {
        const yr = val.getUTCFullYear();
        if (yr >= 2000 && yr <= 2100) return yr;
      }
      if (typeof val === 'number' && val > 30000 && val < 80000) {
        const yr = excelSerialToDate(val).getUTCFullYear();
        if (yr >= 2000 && yr <= 2100) return yr;
      }
      const txt = getMergedText(sheet, r, c);
      const m = txt.match(/(20\d{2})/);
      if (m) return Number(m[1]);
    }
  }

  return new Date().getFullYear();
}

export async function parseScheduleFromExcelBuffer(
  buffer: ArrayBuffer,
  filename: string,
  holidays: HolidayItem[],
  options?: {
    targetSheetName?: string;
    baseYearOverride?: number;
  }
): Promise<ExcelParseResult> {
  const excelModule = await import('exceljs');
  const ExcelJSRuntime =
    excelModule.default ?? (excelModule as unknown as typeof ExcelJS);
  const workbook = new ExcelJSRuntime.Workbook();
  await workbook.xlsx.load(buffer);

  if (workbook.worksheets.length === 0) {
    throw new Error('Excel 檔案內找不到任何工作表');
  }

  interface SheetEvaluation {
    ws: ExcelJS.Worksheet;
    candidate: ParsedSheetCandidate;
    score: number;
  }

  const evaluations: SheetEvaluation[] = workbook.worksheets.map((ws) => {
    const isHidden = ws.state === 'hidden' || ws.state === 'veryHidden';
    const probeYear = options?.baseYearOverride ?? extractYearHint(filename, ws);
    const detected = detectColumnsAndCalendar(ws, probeYear);
    let estimatedDataRows = 0;

    if (detected && detected.modelCol > 0) {
      const startR = Math.max(detected.headerRowIdx, detected.dayRowIdx) + 1;
      for (let r = startR; r <= (ws.rowCount || 0); r++) {
        if (getMergedText(ws, r, detected.modelCol) || getRawCellText(ws, r, detected.scheduleCol)) {
          estimatedDataRows++;
        }
      }
    }

    const hasGantt = Boolean(detected && detected.calendarCols.length > 0);
    const nameBonus =
      ws.name.includes('專案排程追控') ||
      ws.name.includes('總表') ||
      ws.name.includes('排程')
        ? 500
        : 0;
    const score =
      (isHidden ? -1_000_000 : 0) +
      (detected ? 10_000 : 0) +
      (hasGantt ? 5_000 : 0) +
      estimatedDataRows * 10 +
      nameBonus;

    return {
      ws,
      candidate: {
        name: ws.name,
        rowCount: ws.rowCount,
        hasGanttSchedule: hasGantt,
        isHidden,
        estimatedDataRows,
      },
      score,
    };
  });

  const candidates = evaluations.map((e) => e.candidate);

  const selectedSheet =
    (options?.targetSheetName
      ? workbook.getWorksheet(options.targetSheetName)
      : undefined) ||
    [...evaluations].sort((a, b) => b.score - a.score)[0]?.ws ||
    workbook.worksheets[0];

  const detectedYear =
    options?.baseYearOverride ?? extractYearHint(filename, selectedSheet);
  const cols = detectColumnsAndCalendar(selectedSheet, detectedYear);
  if (!cols) {
    throw new Error(
      `工作表「${selectedSheet.name}」找不到標準排程表頭欄位（需包含「機種名稱」與「任務名稱 / 排程」）`
    );
  }

  const firstCalMonth =
    cols.calendarCols.length > 0
      ? Number(cols.calendarCols[0].dateStr.slice(5, 7))
      : null;

  const holidayMap = buildHolidayMap(holidays);
  const dataStartRow = Math.max(cols.headerRowIdx, cols.dayRowIdx) + 1;
  const maxRow = selectedSheet.rowCount || 0;

  interface TempModelBucket {
    seqNo: number | null;
    modelName: string;
    modelSubtitle?: string;
    customer?: string;
    ee?: string;
    me?: string;
    tasks: ScheduleTask[];
    appearanceOrder: number;
  }

  const bucketsByModelKey = new Map<string, TempModelBucket>();
  let appearanceCounter = 0;
  let lastSeqNo: number | null = null;
  let lastModelRaw = '';
  let totalRawModelSwitches = 0;
  let prevRawModelKey = '';
  let paintedPlannedCells = 0;
  let paintedActualCells = 0;

  let r = dataStartRow;
  while (r <= maxRow) {
    const schedLabelCurrent = getRawCellText(selectedSheet, r, cols.scheduleCol);
    const schedLabelNext =
      r + 1 <= maxRow ? getRawCellText(selectedSheet, r + 1, cols.scheduleCol) : '';

    const taskNameCurrent = getMergedText(selectedSheet, r, cols.taskCol);
    const modelRawCurrent = getMergedText(selectedSheet, r, cols.modelCol);
    const seqRawCurrent = getMergedText(selectedSheet, r, cols.seqCol);

    const taskMasterRowCurrent =
      cols.taskCol > 0 ? getEffectiveCell(selectedSheet, r, cols.taskCol).row : r;
    const taskMasterRowNext =
      cols.taskCol > 0 && r + 1 <= maxRow
        ? getEffectiveCell(selectedSheet, r + 1, cols.taskCol).row
        : -1;
    const isTaskMergedPair = r + 1 <= maxRow && taskMasterRowNext === taskMasterRowCurrent;
    const isLabelPair =
      schedLabelCurrent.includes('預計') && schedLabelNext.includes('實際');
    const isTwoRowTask = isLabelPair || isTaskMergedPair;

    const trimmedModelCur = modelRawCurrent.trim();
    const trimmedTaskCur = taskNameCurrent.trim();
    if (
      /^(合計|總計|總和|total|說明|圖例|legend)/i.test(trimmedModelCur) ||
      /^(合計|總計|總和|total|說明|圖例|legend)/i.test(trimmedTaskCur)
    ) {
      r += isTwoRowTask ? 2 : 1;
      continue;
    }

    const rowStartVal = getRawCellText(selectedSheet, r, cols.startCol);
    const rowEndVal = getRawCellText(selectedSheet, r, cols.endCol);
    const rowPcbVal = getRawCellText(selectedSheet, r, cols.pcbCol);
    const rowDaysVal = getRawCellText(selectedSheet, r, cols.daysCol);
    const rowDoneVal = getRawCellText(selectedSheet, r, cols.doneCol);

    const hasAnyRowContent = Boolean(
      trimmedModelCur ||
        trimmedTaskCur ||
        schedLabelCurrent ||
        rowStartVal ||
        rowEndVal ||
        rowPcbVal ||
        rowDaysVal ||
        rowDoneVal
    );
    if (!hasAnyRowContent) {
      r += 1;
      continue;
    }

    const effectiveModelRaw = modelRawCurrent || lastModelRaw;
    if (
      !effectiveModelRaw ||
      (!trimmedModelCur &&
        !trimmedTaskCur &&
        !schedLabelCurrent &&
        !rowStartVal &&
        !rowEndVal &&
        !rowPcbVal &&
        !rowDaysVal)
    ) {
      r += isTwoRowTask ? 2 : 1;
      continue;
    }

    const modelInfo = parseModelNameCell(effectiveModelRaw);
    if (!modelInfo.modelName) {
      r += isTwoRowTask ? 2 : 1;
      continue;
    }

    const modelKey = modelInfo.modelName.trim().toUpperCase();
    const isNewModelRow = Boolean(modelRawCurrent) && modelKey !== prevRawModelKey;
    if (modelRawCurrent) lastModelRaw = modelRawCurrent;

    const parsedSeq = Number(seqRawCurrent.replace(/[^\d]/g, ''));
    const hasSeq = seqRawCurrent.trim() !== '' && Number.isFinite(parsedSeq) && parsedSeq > 0;
    if (hasSeq) {
      lastSeqNo = parsedSeq;
    } else if (isNewModelRow) {
      lastSeqNo = null;
    }
    const effectiveSeq = hasSeq ? parsedSeq : lastSeqNo;

    // Skip unnamed tasks or explicit template/sample placeholder rows
    const isSampleModel =
      /^(預設範例|範例機種|範例專案|範例|sample(\s*(model|project))?|example(\s*(model|project))?)$/i.test(
        modelInfo.modelName.trim()
      ) || /^預設範例/i.test(modelInfo.modelName.trim());
    const isSampleTask =
      /^(預設範例|範例任務|範例|sample(\s*task)?|example(\s*task)?)$/i.test(
        trimmedTaskCur
      ) || /^預設範例/i.test(trimmedTaskCur);

    if (
      !trimmedTaskCur ||
      trimmedTaskCur === '未命名任務' ||
      isSampleModel ||
      isSampleTask
    ) {
      r += isTwoRowTask ? 2 : 1;
      continue;
    }

    if (modelKey !== prevRawModelKey) {
      totalRawModelSwitches++;
      prevRawModelKey = modelKey;
    }

    let bucket = bucketsByModelKey.get(modelKey);
    if (!bucket) {
      bucket = {
        seqNo: effectiveSeq,
        modelName: modelInfo.modelName,
        modelSubtitle: modelInfo.modelSubtitle,
        customer: cols.customerCol
          ? getMergedText(selectedSheet, r, cols.customerCol) || undefined
          : undefined,
        ee:
          modelInfo.ee ||
          (cols.eeCol ? getMergedText(selectedSheet, r, cols.eeCol) || undefined : undefined),
        me:
          modelInfo.me ||
          (cols.meCol ? getMergedText(selectedSheet, r, cols.meCol) || undefined : undefined),
        tasks: [],
        appearanceOrder: appearanceCounter++,
      };
      bucketsByModelKey.set(modelKey, bucket);
    } else {
      if (effectiveSeq !== null) {
        bucket.seqNo =
          bucket.seqNo === null ? effectiveSeq : Math.min(bucket.seqNo, effectiveSeq);
      }
      if (!bucket.modelSubtitle && modelInfo.modelSubtitle) {
        bucket.modelSubtitle = modelInfo.modelSubtitle;
      }
      if (!bucket.ee && modelInfo.ee) bucket.ee = modelInfo.ee;
      if (!bucket.me && modelInfo.me) bucket.me = modelInfo.me;
    }

    const planRow = r;
    const actualRow = isTwoRowTask ? r + 1 : -1;

    const finalTaskName = trimmedTaskCur.replace(/^PVT/i, 'MVT');
    const { stage, stageIteration, taskCategory } = inferStageAndCategory(finalTaskName);

    const doneRaw = getMergedText(selectedSheet, planRow, cols.doneCol);
    const doneVal =
      cols.doneCol > 0
        ? unwrapFormulaResult(getEffectiveCell(selectedSheet, planRow, cols.doneCol).value)
        : null;
    const doneUpper = doneRaw.toUpperCase();
    const taskCellGreen =
      cols.taskCol > 0
        ? isGreenCompletionCell(getEffectiveCell(selectedSheet, planRow, cols.taskCol))
        : false;
    const completed =
      doneVal instanceof Date ||
      (typeof doneVal === 'number' && doneVal > 30000 && doneVal < 80000) ||
      doneRaw.includes('☑') ||
      doneRaw.includes('✓') ||
      doneRaw.includes('✔') ||
      doneRaw.includes('✅') ||
      doneRaw.includes('☑️') ||
      doneUpper === 'TRUE' ||
      doneUpper === 'YES' ||
      doneUpper === 'Y' ||
      doneUpper === 'V' ||
      doneRaw === '是' ||
      doneRaw === '1' ||
      /^\d{4}-\d{2}-\d{2}$/.test(doneRaw) ||
      taskCellGreen;

    const statusRaw = getMergedText(selectedSheet, planRow, cols.statusCol);
    const status = parseTaskStatus(statusRaw, completed);

    const pcbMaster =
      cols.pcbCol > 0 ? getEffectiveCell(selectedSheet, planRow, cols.pcbCol) : null;
    const pcbTopText = getRawCellText(selectedSheet, planRow, cols.pcbCol);
    const pcbBottomText =
      actualRow > 0 ? getRawCellText(selectedSheet, actualRow, cols.pcbCol) : '';
    const isPcbMergedAcrossTask =
      cols.pcbCol > 0 &&
      pcbMaster !== null &&
      actualRow > 0 &&
      getEffectiveCell(selectedSheet, actualRow, cols.pcbCol).row === pcbMaster.row;

    let pcbMode: 'qty' | 'note' = taskCategory === 'pilot' ? 'note' : 'qty';
    let plannedQty: number | null = null;
    let actualQty: number | null = null;
    let pilotNote = '';

    const topIsNumeric = /^-?\d+$/.test(pcbTopText);
    const bottomIsNumeric = /^-?\d+$/.test(pcbBottomText);

    if (
      isPcbMergedAcrossTask ||
      taskCategory === 'pilot' ||
      (pcbTopText !== '' && !topIsNumeric)
    ) {
      pcbMode = 'note';
      pilotNote = pcbMaster ? getMergedText(selectedSheet, planRow, cols.pcbCol) : '';
    } else {
      pcbMode = 'qty';
      plannedQty = topIsNumeric ? Number(pcbTopText) : null;
      actualQty = bottomIsNumeric ? Number(pcbBottomText) : null;
    }

    const pStartMeta =
      cols.startCol > 0
        ? parseExcelDateWithMeta(
            selectedSheet.getCell(planRow, cols.startCol).value,
            detectedYear
          )
        : { dateStr: '', hasExplicitYear: false };
    const pEndMeta =
      cols.endCol > 0
        ? parseExcelDateWithMeta(
            selectedSheet.getCell(planRow, cols.endCol).value,
            detectedYear
          )
        : { dateStr: '', hasExplicitYear: false };
    const aStartMeta =
      actualRow > 0 && cols.startCol > 0
        ? parseExcelDateWithMeta(
            selectedSheet.getCell(actualRow, cols.startCol).value,
            detectedYear
          )
        : { dateStr: '', hasExplicitYear: false };
    const aEndMeta =
      actualRow > 0 && cols.endCol > 0
        ? parseExcelDateWithMeta(
            selectedSheet.getCell(actualRow, cols.endCol).value,
            detectedYear
          )
        : { dateStr: '', hasExplicitYear: false };

    let { start: plannedStart, end: plannedEnd } = adjustCrossYearPair(
      pStartMeta,
      pEndMeta,
      firstCalMonth
    );
    let { start: actualStart, end: actualEnd } = adjustCrossYearPair(
      aStartMeta,
      aEndMeta,
      firstCalMonth
    );

    const pDaysText = getRawCellText(selectedSheet, planRow, cols.daysCol);
    const aDaysText =
      actualRow > 0 ? getRawCellText(selectedSheet, actualRow, cols.daysCol) : '';
    const manualPlannedDays = /^\d+$/.test(pDaysText) ? Number(pDaysText) : null;
    const manualActualDays = /^\d+$/.test(aDaysText) ? Number(aDaysText) : null;

    const plannedFillDates: string[] = [];
    const activeActualDates: string[] = [];
    const grayActualDates: string[] = [];
    const dailyOverrides: Record<string, DailyOverrideType> = {};

    for (const cal of cols.calendarCols) {
      const pCell = selectedSheet.getCell(planRow, cal.col);
      const pFillRgb = extractFillRgb(pCell);
      if (classifyPlannedFill(pFillRgb) || hasColoredPlannedBorder(pCell)) {
        plannedFillDates.push(cal.dateStr);
        paintedPlannedCells++;
      }

      if (actualRow > 0) {
        const aCell = selectedSheet.getCell(actualRow, cal.col);
        const codeClass = classifyActualCode(aCell);
        if (codeClass === 'pilot' || codeClass === 'work' || codeClass === 'delay') {
          dailyOverrides[cal.dateStr] = codeClass;
          activeActualDates.push(cal.dateStr);
          paintedActualCells++;
        } else if (codeClass === 'pause') {
          dailyOverrides[cal.dateStr] = 'pause';
          paintedActualCells++;
        } else {
          const aFillRgb = extractFillRgb(aCell);
          const aClass = classifyActualFill(aFillRgb);
          if (aClass === 'pilot' || aClass === 'work' || aClass === 'delay') {
            dailyOverrides[cal.dateStr] = aClass;
            activeActualDates.push(cal.dateStr);
            paintedActualCells++;
          } else if (aClass === 'gray') {
            grayActualDates.push(cal.dateStr);
          }
        }
      }
    }

    if ((!plannedStart || !plannedEnd) && plannedFillDates.length > 0) {
      plannedFillDates.sort();
      if (!plannedStart) plannedStart = plannedFillDates[0];
      if (!plannedEnd) plannedEnd = plannedFillDates[plannedFillDates.length - 1];
    }

    if ((!actualStart || !actualEnd) && activeActualDates.length > 0) {
      activeActualDates.sort();
      if (!actualStart) actualStart = activeActualDates[0];
      if (!actualEnd) actualEnd = activeActualDates[activeActualDates.length - 1];
    }

    for (const gDate of grayActualDates) {
      if (dailyOverrides[gDate]) continue;
      const insideKnownSpan =
        Boolean(actualStart && actualEnd && gDate >= actualStart && gDate <= actualEnd) ||
        Boolean(plannedStart && plannedEnd && gDate >= plannedStart && gDate <= plannedEnd) ||
        (activeActualDates.length > 0 &&
          gDate >= activeActualDates[0] &&
          gDate <= activeActualDates[activeActualDates.length - 1]);
      if (!insideKnownSpan) continue;
      const [gy, gm, gd] = gDate.split('-').map(Number);
      const dow = new Date(gy, gm - 1, gd).getDay();
      const isWorking = isWorkingCalendarDay(
        { dateStr: gDate, isWeekend: dow === 0 || dow === 6 },
        holidayMap
      );
      if (isWorking) {
        dailyOverrides[gDate] = 'pause';
        paintedActualCells++;
      }
    }

    const task: ScheduleTask = {
      id: `task-imp-${Date.now()}-${bucket.appearanceOrder}-${bucket.tasks.length}`,
      taskName: finalTaskName,
      stage,
      stageIteration,
      taskCategory,
      pcbMode,
      plannedQty,
      actualQty,
      pilotNote,
      completed,
      plannedStart,
      plannedEnd,
      actualStart,
      actualEnd,
      manualPlannedDays: !plannedStart && !plannedEnd ? manualPlannedDays : undefined,
      manualActualDays:
        Object.keys(dailyOverrides).length === 0 ? manualActualDays : undefined,
      status,
      dailyOverrides:
        Object.keys(dailyOverrides).length > 0 ? dailyOverrides : undefined,
      explicitActualDailyOnly: true,
    };

    bucket.tasks.push(task);
    r += isTwoRowTask ? 2 : 1;
  }

  const rawBuckets = Array.from(bucketsByModelKey.values()).filter(
    (b) => b.tasks.length > 0
  );
  const maxExplicitSeq = rawBuckets.reduce(
    (max, b) => (b.seqNo !== null ? Math.max(max, b.seqNo) : max),
    0
  );
  let autoSeqCursor = maxExplicitSeq > 0 ? maxExplicitSeq + 1 : 1;

  const projects: ProjectModel[] = rawBuckets
    .map((b) => {
      const assignedSeq = b.seqNo ?? autoSeqCursor++;
      return {
        id: `proj-imp-${Date.now()}-${b.appearanceOrder}`,
        seqNo: assignedSeq,
        modelName: b.modelName,
        modelSubtitle: b.modelSubtitle,
        customer: b.customer,
        ee: b.ee,
        me: b.me,
        tasks: b.tasks,
        _order: b.appearanceOrder,
      };
    })
    .sort((a, b) => a.seqNo - b.seqNo || a._order - b._order)
    .map(({ _order, ...proj }) => proj);

  const totalTasks = projects.reduce((sum, p) => sum + p.tasks.length, 0);

  return {
    sheetName: selectedSheet.name,
    availableSheets: candidates,
    detectedYear,
    projects,
    stats: {
      modelCount: projects.length,
      taskCount: totalTasks,
      mergedSameModelGroups: Math.max(0, totalRawModelSwitches - projects.length),
      calendarColumnsCount: cols.calendarCols.length,
      paintedPlannedCells,
      paintedActualCells,
    },
  };
}
