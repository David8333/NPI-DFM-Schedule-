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
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText.map((part) => part.text || '').join('').trim();
    }
    if ('result' in val && val.result !== undefined) {
      return cellValueToString(val.result as ExcelJS.CellValue);
    }
    if ('text' in val && typeof val.text === 'string') {
      return val.text.trim();
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
  return cellValueToString(master.value);
}

function getRawCellText(sheet: ExcelJS.Worksheet, row: number, col: number): string {
  if (!col || col < 1) return '';
  return cellValueToString(sheet.getCell(row, col).value);
}

function parseArgbToRgb(argb?: string): [number, number, number] | null {
  if (!argb || typeof argb !== 'string') return null;
  const clean = argb.replace(/^#/, '').trim();
  if (clean.length === 8) {
    // AARRGGBB
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

// Standard Office default theme palette fallback (when Excel saves theme index instead of ARGB)
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

function extractFillRgb(cell: ExcelJS.Cell): [number, number, number] | null {
  const fill = cell.fill;
  if (!fill || fill.type !== 'pattern' || fill.pattern === 'none') return null;
  const fg = (fill as ExcelJS.FillPattern).fgColor as
    | (Partial<ExcelJS.Color> & { tint?: number })
    | undefined;
  if (!fg) return null;

  if (fg.argb) {
    const rgb = parseArgbToRgb(fg.argb);
    if (rgb) return applyTint(rgb, fg.tint);
  }
  if (typeof fg.theme === 'number' && OFFICE_THEME_BASE_RGB[fg.theme]) {
    return applyTint(OFFICE_THEME_BASE_RGB[fg.theme], fg.tint);
  }
  return null;
}

function isNearWhiteBackground(rgb: [number, number, number]): boolean {
  const [r, g, b] = rgb;
  return Math.min(r, g, b) >= 234;
}

function classifyPlannedFill(rgb: [number, number, number] | null): boolean {
  if (!rgb) return false;
  if (isNearWhiteBackground(rgb)) return false;
  const [r, g, b] = rgb;
  // Exclude light neutral gray grid borders/fills; accept orange/amber/purple/saturated fills
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  if (spread >= 20) return true;
  return false;
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

  // Water Blue / Sky Blue (試產確認 #38BDF8 / #00B0F0)
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

function parseExcelDateValue(
  val: ExcelJS.CellValue,
  fallbackYear: number
): string {
  if (val === null || val === undefined || val === '') return '';

  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Excel serial date number (e.g. 46226 -> 2026-07-23)
  if (typeof val === 'number' && val > 30000 && val < 80000) {
    const utcMs = Math.round((val - 25569) * 86400 * 1000);
    const dt = new Date(utcMs);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (typeof val === 'object' && 'result' in val && val.result !== undefined) {
    return parseExcelDateValue(val.result as ExcelJS.CellValue, fallbackYear);
  }

  const text = cellValueToString(val);
  if (!text) return '';

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  // X月Y日
  const zhMatch = text.match(/^(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
  if (zhMatch) {
    return `${fallbackYear}-${zhMatch[1].padStart(2, '0')}-${zhMatch[2].padStart(2, '0')}`;
  }

  // M/D
  const mdMatch = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (mdMatch) {
    return `${fallbackYear}-${mdMatch[1].padStart(2, '0')}-${mdMatch[2].padStart(2, '0')}`;
  }

  return '';
}

function parseMonthCellValue(
  rawText: string,
  val: ExcelJS.CellValue,
  defaultYear: number
): { month: number; year?: number } | null {
  if (val instanceof Date) {
    return { month: val.getUTCMonth() + 1, year: val.getUTCFullYear() };
  }
  const t = rawText.trim();
  if (!t) return null;

  // e.g. "2026年7月 (Q3)" or "2026年07月"
  const ymZh = t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (ymZh) {
    const m = Number(ymZh[2]);
    if (m >= 1 && m <= 12) return { year: Number(ymZh[1]), month: m };
  }

  // e.g. "2026-07" or "2026/7"
  const ymSlash = t.match(/^(\d{4})[-/](\d{1,2})$/);
  if (ymSlash) {
    const m = Number(ymSlash[2]);
    if (m >= 1 && m <= 12) return { year: Number(ymSlash[1]), month: m };
  }

  // e.g. "7", "7月", "12月"
  const mOnly = t.match(/^(\d{1,2})\s*月?$/);
  if (mOnly) {
    const m = Number(mOnly[1]);
    if (m >= 1 && m <= 12) return { month: m };
  }

  // English month names
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

function detectColumnsAndCalendar(
  sheet: ExcelJS.Worksheet,
  baseYear: number
): ParsedColumnMap | null {
  const maxScanRows = Math.min(sheet.rowCount || 15, 12);
  let headerRowIdx = -1;

  for (let r = 1; r <= maxScanRows; r++) {
    const row = sheet.getRow(r);
    const texts: string[] = [];
    for (let c = 1; c <= Math.min(row.cellCount || 15, 20); c++) {
      texts.push(getMergedText(sheet, r, c));
    }
    const joined = texts.join('|');
    if (
      (joined.includes('機種') || joined.includes('Model')) &&
      (joined.includes('任務') || joined.includes('序號') || joined.includes('排程'))
    ) {
      headerRowIdx = r;
      break;
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

  const maxHeaderCol = Math.min(sheet.columnCount || 20, 25);
  let lastFixedCol = 0;

  for (let c = 1; c <= maxHeaderCol; c++) {
    const label = getMergedText(sheet, headerRowIdx, c).replace(/\s+/g, '');
    if (!label) continue;
    if (label.includes('序號')) {
      seqCol = c;
      lastFixedCol = Math.max(lastFixedCol, c);
    } else if (label.includes('機種') || label.toLowerCase().includes('model')) {
      modelCol = c;
      lastFixedCol = Math.max(lastFixedCol, c);
    } else if (label.includes('任務') || label.toLowerCase().includes('task')) {
      taskCol = c;
      lastFixedCol = Math.max(lastFixedCol, c);
    } else if (label.toUpperCase().includes('PCB')) {
      pcbCol = c;
      lastFixedCol = Math.max(lastFixedCol, c);
    } else if (label === '完成' || label.includes('完成')) {
      doneCol = c;
      lastFixedCol = Math.max(lastFixedCol, c);
    } else if (label === '開始' || label.includes('開始')) {
      startCol = c;
      lastFixedCol = Math.max(lastFixedCol, c);
    } else if (label === '結束' || label.includes('結束')) {
      endCol = c;
      lastFixedCol = Math.max(lastFixedCol, c);
    } else if (label.includes('工作天')) {
      daysCol = c;
      lastFixedCol = Math.max(lastFixedCol, c);
    } else if (label === '狀態' || label.includes('狀態')) {
      statusCol = c;
      lastFixedCol = Math.max(lastFixedCol, c);
    } else if (label === '排程' || label.includes('排程')) {
      scheduleCol = c;
      lastFixedCol = Math.max(lastFixedCol, c);
    } else if (label.toUpperCase() === 'EE') {
      eeCol = c;
      lastFixedCol = Math.max(lastFixedCol, c);
    } else if (label.toUpperCase() === 'ME') {
      meCol = c;
      lastFixedCol = Math.max(lastFixedCol, c);
    } else if (label.includes('客戶')) {
      customerCol = c;
      lastFixedCol = Math.max(lastFixedCol, c);
    }
  }

  // Locate Day number row (typically headerRowIdx + 1)
  const calStartCol =
    lastFixedCol > 0
      ? Math.max(lastFixedCol + 1, scheduleCol > 0 ? scheduleCol + 1 : 0)
      : 11;
  let dayRowIdx = headerRowIdx + 1;
  const totalCols = sheet.columnCount || 0;

  const probeDayValue = (rowIdx: number, colIdx: number): number | null => {
    const rawVal = sheet.getCell(rowIdx, colIdx).value;
    if (rawVal instanceof Date) return rawVal.getUTCDate();
    if (
      typeof rawVal === 'object' &&
      rawVal !== null &&
      'result' in rawVal &&
      rawVal.result instanceof Date
    ) {
      return rawVal.result.getUTCDate();
    }
    const txt = cellValueToString(rawVal);
    if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return Number(txt.slice(8, 10));
    const n = Number(txt);
    return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
  };

  let foundDaysInNext = 0;
  for (let c = calStartCol; c <= Math.min(totalCols, calStartCol + 20); c++) {
    if (probeDayValue(dayRowIdx, c) !== null) foundDaysInNext++;
  }
  if (foundDaysInNext === 0) {
    let foundDaysInHeader = 0;
    for (let c = calStartCol; c <= Math.min(totalCols, calStartCol + 20); c++) {
      if (probeDayValue(headerRowIdx, c) !== null) foundDaysInHeader++;
    }
    if (foundDaysInHeader > 0) {
      dayRowIdx = headerRowIdx;
    }
  }

  const calendarCols: { col: number; dateStr: string }[] = [];
  let activeYear = baseYear;
  let prevMonth: number | null = null;
  let activeMonth: number | null = null;

  for (let c = calStartCol; c <= totalCols; c++) {
    const dayCell = sheet.getCell(dayRowIdx, c);
    const dayVal = dayCell.value;

    // If the calendar day cell itself is an Excel Date, extract YYYY-MM-DD directly
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

    // Month header usually lives in headerRowIdx (row 1)
    const mCell = getEffectiveCell(sheet, headerRowIdx, c);
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
      // Month header missing on a boundary: advance month automatically
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
  for (let r = 1; r <= Math.min(sheet.rowCount || 5, 5); r++) {
    for (let c = 1; c <= Math.min(sheet.columnCount || 30, 60); c++) {
      const val = sheet.getCell(r, c).value;
      if (val instanceof Date) {
        const yr = val.getUTCFullYear();
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

  const candidates: ParsedSheetCandidate[] = workbook.worksheets.map((ws) => {
    const probeYear = options?.baseYearOverride ?? extractYearHint(filename, ws);
    const detected = detectColumnsAndCalendar(ws, probeYear);
    return {
      name: ws.name,
      rowCount: ws.rowCount,
      hasGanttSchedule: Boolean(detected && detected.calendarCols.length > 0),
    };
  });

  let selectedSheet =
    (options?.targetSheetName
      ? workbook.getWorksheet(options.targetSheetName)
      : undefined) ||
    workbook.worksheets.find((ws) => ws.name.includes('專案排程追控')) ||
    workbook.worksheets.find(
      (ws) => candidates.find((c) => c.name === ws.name)?.hasGanttSchedule
    ) ||
    workbook.worksheets[0];

  const detectedYear =
    options?.baseYearOverride ?? extractYearHint(filename, selectedSheet);
  const cols = detectColumnsAndCalendar(selectedSheet, detectedYear);
  if (!cols) {
    throw new Error(
      `工作表「${selectedSheet.name}」找不到標準排程表頭欄位（需包含「機種名稱」與「任務名稱 / 排程」）`
    );
  }

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

    // Detect 2-row (預計 / 實際) task block vs 1-row fallback
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

    // Skip footer summary / legend rows or blank trailing rows
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
    const hasAnyRowContent = Boolean(
      trimmedModelCur ||
        trimmedTaskCur ||
        schedLabelCurrent ||
        rowStartVal ||
        rowEndVal ||
        rowPcbVal
    );
    if (!hasAnyRowContent) {
      r += 1;
      continue;
    }

    const effectiveModelRaw = modelRawCurrent || lastModelRaw;
    if (!effectiveModelRaw || (!trimmedTaskCur && !schedLabelCurrent && !rowStartVal)) {
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
      // Same model name merged into the same serial number (prefer smallest valid seqNo)
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

    // 任務名稱 & stage/category
    const finalTaskName = (taskNameCurrent || '未命名任務').replace(/^PVT/i, 'MVT');
    const { stage, stageIteration, taskCategory } = inferStageAndCategory(finalTaskName);

    // 完成 checkbox / green task highlight
    const doneRaw = getMergedText(selectedSheet, planRow, cols.doneCol);
    const doneUpper = doneRaw.toUpperCase();
    const taskCellGreen =
      cols.taskCol > 0
        ? isGreenCompletionCell(getEffectiveCell(selectedSheet, planRow, cols.taskCol))
        : false;
    const completed =
      doneRaw.includes('☑') ||
      doneRaw.includes('✓') ||
      doneRaw.includes('✔') ||
      doneUpper === 'TRUE' ||
      doneUpper === 'YES' ||
      doneUpper === 'Y' ||
      doneRaw === '是' ||
      doneRaw === '1' ||
      taskCellGreen;

    // 狀態 (O / C / NA)
    const statusRaw = getMergedText(selectedSheet, planRow, cols.statusCol);
    const status = parseTaskStatus(statusRaw, completed);

    // PCB數量 / 試產備註
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
      pilotNote = pcbMaster ? cellValueToString(pcbMaster.value) : '';
    } else {
      pcbMode = 'qty';
      plannedQty = topIsNumeric ? Number(pcbTopText) : null;
      actualQty = bottomIsNumeric ? Number(pcbBottomText) : null;
    }

    // Dates from 開始 / 結束 columns
    let plannedStart =
      cols.startCol > 0
        ? parseExcelDateValue(
            selectedSheet.getCell(planRow, cols.startCol).value,
            detectedYear
          )
        : '';
    let plannedEnd =
      cols.endCol > 0
        ? parseExcelDateValue(
            selectedSheet.getCell(planRow, cols.endCol).value,
            detectedYear
          )
        : '';
    let actualStart =
      actualRow > 0 && cols.startCol > 0
        ? parseExcelDateValue(
            selectedSheet.getCell(actualRow, cols.startCol).value,
            detectedYear
          )
        : '';
    let actualEnd =
      actualRow > 0 && cols.endCol > 0
        ? parseExcelDateValue(
            selectedSheet.getCell(actualRow, cols.endCol).value,
            detectedYear
          )
        : '';

    // 工作天 manual fallback
    const pDaysText = getRawCellText(selectedSheet, planRow, cols.daysCol);
    const aDaysText =
      actualRow > 0 ? getRawCellText(selectedSheet, actualRow, cols.daysCol) : '';
    const manualPlannedDays = /^\d+$/.test(pDaysText) ? Number(pDaysText) : null;
    const manualActualDays = /^\d+$/.test(aDaysText) ? Number(aDaysText) : null;

    // Scan Gantt Calendar Fills on 預計 & 實際 rows
    const plannedFillDates: string[] = [];
    const activeActualDates: string[] = [];
    const grayActualDates: string[] = [];
    const dailyOverrides: Record<string, DailyOverrideType> = {};

    for (const cal of cols.calendarCols) {
      // Planned row bar
      const pFillRgb = extractFillRgb(selectedSheet.getCell(planRow, cal.col));
      if (classifyPlannedFill(pFillRgb)) {
        plannedFillDates.push(cal.dateStr);
        paintedPlannedCells++;
      }

      // Actual row fills
      if (actualRow > 0) {
        const aFillRgb = extractFillRgb(selectedSheet.getCell(actualRow, cal.col));
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

    // Reconcile start/end dates with painted Gantt cells
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

    // Mark gray cells on working days inside actual range as explicit 'pause'
    for (const gDate of grayActualDates) {
      const insideActualSpan =
        Boolean(actualStart && actualEnd && gDate >= actualStart && gDate <= actualEnd) ||
        (activeActualDates.length > 0 &&
          gDate >= activeActualDates[0] &&
          gDate <= activeActualDates[activeActualDates.length - 1]);
      if (!insideActualSpan) continue;
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
        !actualStart && !actualEnd && Object.keys(dailyOverrides).length === 0
          ? manualActualDays
          : undefined,
      status,
      dailyOverrides:
        Object.keys(dailyOverrides).length > 0 ? dailyOverrides : undefined,
    };

    bucket.tasks.push(task);
    r += isTwoRowTask ? 2 : 1;
  }

  // Sort models by seqNo ascending (assigning sequential seqNo for any unnumbered items)
  const rawBuckets = Array.from(bucketsByModelKey.values());
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
