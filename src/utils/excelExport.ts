import ExcelJS from 'exceljs';
import { ExportOptions, HolidayItem, ProjectModel } from '../types/schedule';
import {
  buildHolidayMap,
  computeActualWorkingDays,
  computePlannedWorkingDays,
  computeWeeklyDfmStats,
  formatChineseShortDate,
  generateCalendarDays,
  getActualCellState,
  getEffectiveActualRangeDisplay,
  getPlannedCellState,
  getTaskCategory,
  groupDaysByMonth,
  isTaskDelayedOrWarning,
} from './dateUtils';

const THIN_BORDER_CLASSIC: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF7E6096' } },
  left: { style: 'thin', color: { argb: 'FF7E6096' } },
  bottom: { style: 'thin', color: { argb: 'FF7E6096' } },
  right: { style: 'thin', color: { argb: 'FF7E6096' } },
};

const THIN_BORDER_MODERN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

export async function exportScheduleToExcel(
  projects: ProjectModel[],
  holidays: HolidayItem[],
  options: ExportOptions,
  referenceToday: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NPI 專案管理排程追控系統';
  workbook.created = new Date();

  const isClassic = options.theme === 'classic_npi';
  const baseBorder = isClassic ? THIN_BORDER_CLASSIC : THIN_BORDER_MODERN;

  const holidayMap = buildHolidayMap(holidays);
  const calendarDays = generateCalendarDays(options.startDate, options.endDate);
  const monthSpans = groupDaysByMonth(calendarDays);

  // Sheet 1: 專案排程追控表
  const sheet = workbook.addWorksheet('專案排程追控總表', {
    views: [{ state: 'frozen', xSplit: 10, ySplit: 2 }],
  });

  const fixedHeaders = [
    { title: '序號', width: 7 },
    { title: '機種名稱', width: 22 },
    { title: '任務名稱', width: 20 },
    { title: 'PCB數量', width: 14 },
    { title: '完成', width: 7 },
    { title: '開始', width: 11 },
    { title: '結束', width: 11 },
    { title: '工作天', width: 9 },
    { title: '狀態', width: 8 },
    { title: '排程', width: 10 },
  ];

  fixedHeaders.forEach((col, idx) => {
    sheet.getColumn(idx + 1).width = col.width;
  });

  calendarDays.forEach((_, idx) => {
    sheet.getColumn(11 + idx).width = 4.2;
  });

  const headerRow1 = sheet.getRow(1);
  const headerRow2 = sheet.getRow(2);
  headerRow1.height = 22;
  headerRow2.height = 20;

  fixedHeaders.forEach((col, idx) => {
    const colNum = idx + 1;
    const cell1 = sheet.getCell(1, colNum);
    const cell2 = sheet.getCell(2, colNum);
    cell1.value = col.title;
    sheet.mergeCells(1, colNum, 2, colNum);

    const headerFill: ExcelJS.Fill = isClassic
      ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
      : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    const headerFontColor = isClassic ? 'FF111827' : 'FFFFFFFF';

    [cell1, cell2].forEach((c) => {
      c.fill = headerFill;
      c.font = {
        name: 'Microsoft JhengHei',
        size: 10,
        bold: true,
        color: { argb: headerFontColor },
      };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = baseBorder;
    });
  });

  let currentDayCol = 11;
  for (const mSpan of monthSpans) {
    const startCol = currentDayCol;
    const endCol = currentDayCol + mSpan.daysCount - 1;
    const monthCell = sheet.getCell(1, startCol);
    monthCell.value = isClassic
      ? `${mSpan.month}`
      : `${mSpan.year}年${mSpan.month}月 (Q${mSpan.quarter})`;
    if (endCol > startCol) {
      sheet.mergeCells(1, startCol, 1, endCol);
    }
    for (let c = startCol; c <= endCol; c++) {
      const cell = sheet.getCell(1, c);
      cell.fill = isClassic
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } }
        : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.font = {
        name: 'Microsoft JhengHei',
        size: 11,
        bold: true,
        color: { argb: isClassic ? 'FF1D4ED8' : 'FFFFFFFF' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = baseBorder;
    }
    currentDayCol = endCol + 1;
  }

  calendarDays.forEach((day, idx) => {
    const colNum = 11 + idx;
    const cell = sheet.getCell(2, colNum);
    cell.value = day.day;

    const isHoliday = holidayMap.has(day.dateStr);
    let fillArgb = 'FFFFFFFF';
    let textArgb = 'FF111827';

    if (isHoliday) {
      fillArgb = isClassic ? 'FFFFFF00' : 'FFFEF3C7';
      textArgb = 'FF92400E';
    } else if (day.isWeekend) {
      fillArgb = isClassic ? 'FFE9B8FF' : 'FFE2E8F0';
      textArgb = isClassic ? 'FF3B0764' : 'FF475569';
    } else if (!isClassic) {
      fillArgb = 'FFF8FAFC';
    }

    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
    cell.font = { name: 'Calibri', size: 9, bold: isHoliday, color: { argb: textArgb } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = baseBorder;
  });

  let currentRow = 3;

  for (const project of projects) {
    if (project.tasks.length === 0) continue;
    const projectStartRow = currentRow;
    const projectTotalSubRows = project.tasks.length * 2;
    const projectEndRow = projectStartRow + projectTotalSubRows - 1;

    for (const task of project.tasks) {
      const planRowIdx = currentRow;
      const actualRowIdx = currentRow + 1;
      const planRow = sheet.getRow(planRowIdx);
      const actualRow = sheet.getRow(actualRowIdx);
      planRow.height = 20;
      actualRow.height = 20;

      const isPilotTask = getTaskCategory(task) === 'pilot';
      const plannedDaysCount = computePlannedWorkingDays(task, holidayMap);
      const actualDaysCount = computeActualWorkingDays(task, holidayMap);
      const effectiveActualRange = getEffectiveActualRangeDisplay(task);
      const warningCheck = isTaskDelayedOrWarning(task, referenceToday, holidayMap);

      // Col 3: 任務名稱
      sheet.mergeCells(planRowIdx, 3, actualRowIdx, 3);
      const taskCell = sheet.getCell(planRowIdx, 3);
      taskCell.value = task.taskName;
      const taskCompletedFill: ExcelJS.Fill | undefined = task.completed
        ? {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isClassic ? 'FF00FF00' : 'FFD1FAE5' },
          }
        : undefined;
      for (let r = planRowIdx; r <= actualRowIdx; r++) {
        const c = sheet.getCell(r, 3);
        if (taskCompletedFill) c.fill = taskCompletedFill;
        c.font = {
          name: 'Microsoft JhengHei',
          size: 9,
          bold: true,
          color: { argb: task.completed && !isClassic ? 'FF065F46' : 'FF111827' },
        };
        c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        c.border = baseBorder;
      }

      // Col 4: PCB數量 / 試產備註
      if (task.pcbMode === 'note') {
        sheet.mergeCells(planRowIdx, 4, actualRowIdx, 4);
        const noteCell = sheet.getCell(planRowIdx, 4);
        noteCell.value = task.pilotNote || '';
        for (let r = planRowIdx; r <= actualRowIdx; r++) {
          const c = sheet.getCell(r, 4);
          c.font = {
            name: 'Microsoft JhengHei',
            size: 9,
            bold: true,
            color: { argb: isClassic ? 'FF6B21A8' : 'FF4338CA' },
          };
          c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          c.border = baseBorder;
        }
      } else {
        const pQtyCell = sheet.getCell(planRowIdx, 4);
        const aQtyCell = sheet.getCell(actualRowIdx, 4);
        pQtyCell.value = task.plannedQty ?? '';
        aQtyCell.value = task.actualQty ?? '';

        pQtyCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF111827' } };
        pQtyCell.alignment = { vertical: 'middle', horizontal: 'center' };
        pQtyCell.border = baseBorder;

        aQtyCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isClassic ? 'FF99F6E4' : 'FFECFDF5' },
        };
        aQtyCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
        aQtyCell.alignment = { vertical: 'middle', horizontal: 'center' };
        aQtyCell.border = baseBorder;
      }

      // Col 5: 完成
      sheet.mergeCells(planRowIdx, 5, actualRowIdx, 5);
      const doneCell = sheet.getCell(planRowIdx, 5);
      doneCell.value = task.completed ? '☑' : '☐';
      for (let r = planRowIdx; r <= actualRowIdx; r++) {
        const c = sheet.getCell(r, 5);
        c.font = {
          name: 'Segoe UI Symbol',
          size: 13,
          bold: true,
          color: { argb: task.completed ? 'FF5B21B6' : 'FF64748B' },
        };
        c.alignment = { vertical: 'middle', horizontal: 'center' };
        c.border = baseBorder;
      }

      // Col 6 & 7: 開始 & 結束
      const pStartCell = sheet.getCell(planRowIdx, 6);
      const pEndCell = sheet.getCell(planRowIdx, 7);
      const aStartCell = sheet.getCell(actualRowIdx, 6);
      const aEndCell = sheet.getCell(actualRowIdx, 7);

      pStartCell.value = formatChineseShortDate(task.plannedStart);
      pEndCell.value = formatChineseShortDate(task.plannedEnd);
      aStartCell.value = formatChineseShortDate(effectiveActualRange.start);
      aEndCell.value = formatChineseShortDate(effectiveActualRange.end);

      const isOverdueStart =
        !task.completed &&
        task.plannedStart &&
        !effectiveActualRange.start &&
        task.plannedStart <= referenceToday;

      [pStartCell, pEndCell].forEach((c, idx) => {
        if (idx === 0 && isOverdueStart) {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFECDD3' } };
          c.font = { name: 'Microsoft JhengHei', size: 9, bold: true, color: { argb: 'FF9F1239' } };
        } else {
          c.font = { name: 'Microsoft JhengHei', size: 9, color: { argb: 'FF475569' } };
        }
        c.alignment = { vertical: 'middle', horizontal: 'center' };
        c.border = baseBorder;
      });

      [aStartCell, aEndCell].forEach((c) => {
        c.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: {
            argb: isPilotTask ? 'FFE0F2FE' : isClassic ? 'FF99F6E4' : 'FFF0FDFA',
          },
        };
        c.font = { name: 'Microsoft JhengHei', size: 9, bold: true, color: { argb: 'FF1D4ED8' } };
        c.alignment = { vertical: 'middle', horizontal: 'center' };
        c.border = baseBorder;
      });

      // Col 8: 工作天
      const pDaysCell = sheet.getCell(planRowIdx, 8);
      const aDaysCell = sheet.getCell(actualRowIdx, 8);
      pDaysCell.value = plannedDaysCount;
      aDaysCell.value = actualDaysCount;

      pDaysCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFDB2777' } };
      pDaysCell.alignment = { vertical: 'middle', horizontal: 'center' };
      pDaysCell.border = baseBorder;

      const hasActualSpan = Boolean(effectiveActualRange.start || actualDaysCount > 0);
      aDaysCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: hasActualSpan
            ? isPilotTask
              ? 'FFE0F2FE'
              : isClassic
              ? 'FF99F6E4'
              : 'FFF0FDF4'
            : 'FFFDF2F8',
        },
      };
      aDaysCell.font = {
        name: 'Calibri',
        size: 10,
        bold: true,
        color: { argb: warningCheck.isWarning ? 'FFBE123C' : 'FFDB2777' },
      };
      aDaysCell.alignment = { vertical: 'middle', horizontal: 'center' };
      aDaysCell.border = baseBorder;

      // Col 9: 狀態
      sheet.mergeCells(planRowIdx, 9, actualRowIdx, 9);
      const statusCell = sheet.getCell(planRowIdx, 9);
      statusCell.value = task.status;
      let statusFillArgb = 'FFF8FAFC';
      let statusTextArgb = 'FF0F172A';
      if (task.status === 'C') {
        statusFillArgb = 'FFBBF7D0';
        statusTextArgb = 'FF14532D';
      } else if (task.status === 'O') {
        statusFillArgb = 'FFFDE68A';
        statusTextArgb = 'FFB91C1C';
      }

      for (let r = planRowIdx; r <= actualRowIdx; r++) {
        const c = sheet.getCell(r, 9);
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusFillArgb } };
        c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: statusTextArgb } };
        c.alignment = { vertical: 'middle', horizontal: 'center' };
        c.border = baseBorder;
      }

      // Col 10: 排程
      const pTypeCell = sheet.getCell(planRowIdx, 10);
      const aTypeCell = sheet.getCell(actualRowIdx, 10);
      pTypeCell.value = '預計 ▶';
      aTypeCell.value = '實際 ▶';

      pTypeCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: isPilotTask
            ? 'FFF3E8FF'
            : task.status === 'O'
            ? 'FFFFEDD5'
            : 'FFF8FAFC',
        },
      };
      pTypeCell.font = {
        name: 'Microsoft JhengHei',
        size: 9,
        bold: true,
        color: {
          argb: isPilotTask
            ? 'FF6B21A8'
            : task.status === 'O'
            ? 'FFC2410C'
            : 'FF475569',
        },
      };
      pTypeCell.alignment = { vertical: 'middle', horizontal: 'center' };
      pTypeCell.border = baseBorder;

      aTypeCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: hasActualSpan ? (isPilotTask ? 'FFBAE6FD' : 'FFA7F3D0') : 'FFF1F5F9',
        },
      };
      aTypeCell.font = {
        name: 'Microsoft JhengHei',
        size: 9,
        bold: true,
        color: { argb: 'FF0F172A' },
      };
      aTypeCell.alignment = { vertical: 'middle', horizontal: 'center' };
      aTypeCell.border = baseBorder;

      // Gantt Calendar Cells (Col 11+)
      calendarDays.forEach((day, dIdx) => {
        const colNum = 11 + dIdx;
        const pCell = sheet.getCell(planRowIdx, colNum);
        const aCell = sheet.getCell(actualRowIdx, colNum);

        // Planned Cell Styling: 試產 = Bright Purple (#A855F7), DFM/Other = Orange (#F59E0B)
        const pSeg = getPlannedCellState(day.dateStr, task);
        pCell.border = { ...baseBorder };
        if (pSeg === 'single' || pSeg === 'start' || pSeg === 'end') {
          pCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isPilotTask ? 'FFA855F7' : 'FFF59E0B' },
          };
          pCell.border = {
            ...baseBorder,
            top: { style: 'medium', color: { argb: isPilotTask ? 'FF7E22CE' : 'FFD97706' } },
            bottom: { style: 'medium', color: { argb: isPilotTask ? 'FF7E22CE' : 'FFD97706' } },
          };
        } else if (pSeg === 'middle') {
          pCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isPilotTask ? 'FFD3AAFB' : 'FFFACE85' },
          };
          pCell.border = {
            left: { style: 'hair', color: { argb: isPilotTask ? 'FFD8B4FE' : 'FFFCD34D' } },
            right: { style: 'hair', color: { argb: isPilotTask ? 'FFD8B4FE' : 'FFFCD34D' } },
            top: { style: 'medium', color: { argb: isPilotTask ? 'FF9333EA' : 'FFF59E0B' } },
            bottom: { style: 'medium', color: { argb: isPilotTask ? 'FF9333EA' : 'FFF59E0B' } },
          };
        } else if (day.isWeekend || holidayMap.has(day.dateStr)) {
          pCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
        }

        // Actual Cell Styling: Water Blue (#38BDF8), Green (#16E016 / #10B981), Red (#F40058 / #F43F5E), Gray (#D1D5DB)
        const aState = getActualCellState(day, task, holidayMap);
        aCell.border = { ...baseBorder };
        if (aState === 'pilot_blue') {
          aCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF38BDF8' },
          };
        } else if (aState === 'on_time') {
          aCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isClassic ? 'FF16E016' : 'FF10B981' },
          };
        } else if (aState === 'delay') {
          aCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isClassic ? 'FFF40058' : 'FFF43F5E' },
          };
        } else if (aState === 'non_working_span' || aState === 'pause') {
          aCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1D5DB' } };
        } else if (day.isWeekend || holidayMap.has(day.dateStr)) {
          aCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
        }
      });

      currentRow += 2;
    }

    sheet.mergeCells(projectStartRow, 1, projectEndRow, 1);
    sheet.mergeCells(projectStartRow, 2, projectEndRow, 2);

    const seqCell = sheet.getCell(projectStartRow, 1);
    seqCell.value = project.seqNo;

    const modelCell = sheet.getCell(projectStartRow, 2);
    modelCell.value = project.modelSubtitle
      ? `${project.modelName}\n${project.modelSubtitle}`
      : project.modelName;

    for (let r = projectStartRow; r <= projectEndRow; r++) {
      const c1 = sheet.getCell(r, 1);
      c1.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF334155' } };
      c1.alignment = { vertical: 'middle', horizontal: 'center' };
      c1.border = baseBorder;

      const c2 = sheet.getCell(r, 2);
      c2.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1D4ED8' } };
      c2.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c2.border = baseBorder;
    }
  }

  // Sheet 2: 專案進度統計摘要
  if (options.includeSummarySheet) {
    const summarySheet = workbook.addWorksheet('專案進度統計摘要');
    summarySheet.columns = [
      { header: '序號', key: 'seqNo', width: 8 },
      { header: '機種名稱', key: 'modelName', width: 24 },
      { header: '客戶 / EE / ME', key: 'ownerInfo', width: 22 },
      { header: '階段', key: 'stage', width: 10 },
      { header: '任務名稱', key: 'taskName', width: 22 },
      { header: 'PCB數量 / 試產規格', key: 'spec', width: 20 },
      { header: '預計區間', key: 'planRange', width: 22 },
      { header: '實際區間', key: 'actualRange', width: 22 },
      { header: '預計工作天', key: 'planDays', width: 12 },
      { header: '實際工作天', key: 'actualDays', width: 12 },
      { header: '工時差異', key: 'diffDays', width: 12 },
      { header: '狀態', key: 'status', width: 10 },
      { header: '完成', key: 'completed', width: 10 },
      { header: '追控備註', key: 'remark', width: 34 },
    ];

    const sHeader = summarySheet.getRow(1);
    sHeader.height = 24;
    sHeader.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      cell.font = { name: 'Microsoft JhengHei', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = THIN_BORDER_MODERN;
    });

    for (const p of projects) {
      for (const t of p.tasks) {
        const pDays = computePlannedWorkingDays(t, holidayMap);
        const aDays = computeActualWorkingDays(t, holidayMap);
        const effRange = getEffectiveActualRangeDisplay(t);
        const diff = aDays - pDays;
        const specText =
          t.pcbMode === 'note'
            ? t.pilotNote || '-'
            : `預計 ${t.plannedQty ?? 0} / 實際 ${t.actualQty ?? 0} 板`;

        const ownerParts = [
          p.customer,
          p.ee ? `EE:${p.ee}` : '',
          p.me ? `ME:${p.me}` : '',
        ].filter(Boolean);

        const row = summarySheet.addRow({
          seqNo: p.seqNo,
          modelName: p.modelSubtitle ? `${p.modelName} ${p.modelSubtitle}` : p.modelName,
          ownerInfo: ownerParts.join(' / ') || '-',
          stage: t.stage,
          taskName: t.taskName,
          spec: specText,
          planRange:
            t.plannedStart && t.plannedEnd
              ? `${t.plannedStart} ~ ${t.plannedEnd}`
              : '未排定',
          actualRange:
            effRange.start && effRange.end
              ? `${effRange.start} ~ ${effRange.end}`
              : '未啟動',
          planDays: pDays,
          actualDays: aDays,
          diffDays: diff > 0 ? `+${diff}` : `${diff}`,
          status: t.status,
          completed: t.completed ? '已完成' : '追控中',
          remark: t.remark || '',
        });

        row.height = 20;
        row.eachCell((cell, colNumber) => {
          cell.font = {
            name: 'Microsoft JhengHei',
            size: 9.5,
            bold: colNumber === 11 && diff > 0,
            color: {
              argb: colNumber === 11 && diff > 0 ? 'FFBE123C' : 'FF1E293B',
            },
          };
          cell.alignment = {
            vertical: 'middle',
            horizontal: colNumber === 2 || colNumber === 5 || colNumber === 14 ? 'left' : 'center',
          };
          cell.border = THIN_BORDER_MODERN;
        });
      }
    }
  }

  // Sheet 3: 每週 DFM REVIEW 統計
  if (options.includeWeeklyDfmSheet) {
    const dfmSheet = workbook.addWorksheet('每週DFM統計');
    dfmSheet.columns = [
      { header: '週別 (ISO Week)', key: 'weekKey', width: 16 },
      { header: '週期區間 (週一~週日)', key: 'weekRange', width: 25 },
      { header: 'DFM REVIEW 預計天數', key: 'plannedDays', width: 20 },
      { header: 'DFM REVIEW 實際天數', key: 'actualDays', width: 20 },
      { header: '差異 (實際-預計)', key: 'diffDays', width: 16 },
      { header: '涉及機種數', key: 'modelsCount', width: 13 },
      { header: '當週 DFM 機種與天數明細', key: 'detail', width: 52 },
    ];

    const dHeader = dfmSheet.getRow(1);
    dHeader.height = 24;
    dHeader.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      cell.font = { name: 'Microsoft JhengHei', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = THIN_BORDER_MODERN;
    });

    const weeklyStats = computeWeeklyDfmStats(
      projects,
      holidayMap,
      options.startDate,
      options.endDate
    );

    let sumPlanned = 0;
    let sumActual = 0;

    for (const wk of weeklyStats) {
      sumPlanned += wk.plannedDays;
      sumActual += wk.actualDays;
      const detailText =
        wk.breakdown.length > 0
          ? wk.breakdown
              .map(
                (b) =>
                  `${b.modelName} (${b.taskName}: 預計${b.plannedDays}天 / 實際${b.actualDays}天)`
              )
              .join('；')
          : '無 DFM REVIEW 排程';

      const row = dfmSheet.addRow({
        weekKey: wk.weekKey,
        weekRange: `${wk.weekStart} ~ ${wk.weekEnd}`,
        plannedDays: wk.plannedDays,
        actualDays: wk.actualDays,
        diffDays: wk.diffDays > 0 ? `+${wk.diffDays}` : `${wk.diffDays}`,
        modelsCount: wk.activeModelsCount,
        detail: detailText,
      });

      row.height = 22;
      row.eachCell((cell, colNumber) => {
        cell.font = {
          name: 'Microsoft JhengHei',
          size: 9.5,
          bold: colNumber === 3 || colNumber === 4 || (colNumber === 5 && wk.diffDays > 0),
          color: {
            argb:
              colNumber === 3
                ? 'FFB45309'
                : colNumber === 4
                ? 'FF047857'
                : colNumber === 5 && wk.diffDays > 0
                ? 'FFBE123C'
                : 'FF1E293B',
          },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: colNumber === 7 ? 'left' : 'center',
          wrapText: colNumber === 7,
        };
        cell.border = THIN_BORDER_MODERN;
      });
    }

    const totalDiff = sumActual - sumPlanned;
    const totalRow = dfmSheet.addRow({
      weekKey: '合計',
      weekRange: `${options.startDate} ~ ${options.endDate}`,
      plannedDays: sumPlanned,
      actualDays: sumActual,
      diffDays: totalDiff > 0 ? `+${totalDiff}` : `${totalDiff}`,
      modelsCount: '-',
      detail: '上述期間所有 DFM REVIEW 工作天加總',
    });
    totalRow.height = 24;
    totalRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.font = { name: 'Microsoft JhengHei', size: 10, bold: true, color: { argb: 'FF0F172A' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = THIN_BORDER_MODERN;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const cleanName = options.filename.trim().replace(/\.xlsx$/i, '') || 'NPI_專案排程追控表';
  anchor.href = url;
  anchor.download = `${cleanName}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
