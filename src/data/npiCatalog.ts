import { PcbDisplayMode, ProjectStage, ScheduleTask, TaskCategory } from '../types/schedule';

export interface StageTaskTemplate {
  key: string;
  stage: ProjectStage;
  taskName: string;
  taskCategory: TaskCategory;
  pcbMode: PcbDisplayMode;
  defaultPlannedQty: number | null;
  defaultPilotNote: string;
}

export const NPI_STAGES_ORDER: ProjectStage[] = ['PROTO', 'EVT', 'DVT', 'MVT', 'MP'];

export const NPI_STAGE_LABELS: Record<ProjectStage, string> = {
  PROTO: 'PROTO 原型驗證階段',
  EVT: 'EVT 工程驗證階段',
  DVT: 'DVT 設計驗證階段',
  MVT: 'MVT 量產驗證階段',
  MP: 'MP 正式量產階段',
  OTHER: '其他自訂階段',
};

export const NPI_STANDARD_TASK_CATALOG: StageTaskTemplate[] = [
  {
    key: 'PROTO_DFM',
    stage: 'PROTO',
    taskName: 'PROTO DFM REVIEW',
    taskCategory: 'dfm',
    pcbMode: 'qty',
    defaultPlannedQty: 4,
    defaultPilotNote: '',
  },
  {
    key: 'PROTO_PILOT',
    stage: 'PROTO',
    taskName: 'PROTO試產',
    taskCategory: 'pilot',
    pcbMode: 'note',
    defaultPlannedQty: null,
    defaultPilotNote: '20套 試做班',
  },
  {
    key: 'EVT_DFM',
    stage: 'EVT',
    taskName: 'EVT DFM REVIEW',
    taskCategory: 'dfm',
    pcbMode: 'qty',
    defaultPlannedQty: 6,
    defaultPilotNote: '',
  },
  {
    key: 'EVT_PILOT',
    stage: 'EVT',
    taskName: 'EVT試產',
    taskCategory: 'pilot',
    pcbMode: 'note',
    defaultPlannedQty: null,
    defaultPilotNote: 'EVT試產 40pcs',
  },
  {
    key: 'DVT_DFM',
    stage: 'DVT',
    taskName: 'DVT DFM REVIEW',
    taskCategory: 'dfm',
    pcbMode: 'qty',
    defaultPlannedQty: 4,
    defaultPilotNote: '',
  },
  {
    key: 'DVT_PILOT',
    stage: 'DVT',
    taskName: 'DVT試產',
    taskCategory: 'pilot',
    pcbMode: 'note',
    defaultPlannedQty: null,
    defaultPilotNote: 'DVT試產 100pcs',
  },
  {
    key: 'MVT_DFM',
    stage: 'MVT',
    taskName: 'MVT DFM REVIEW',
    taskCategory: 'dfm',
    pcbMode: 'qty',
    defaultPlannedQty: 2,
    defaultPilotNote: '',
  },
  {
    key: 'MVT_PILOT',
    stage: 'MVT',
    taskName: 'MVT試產',
    taskCategory: 'pilot',
    pcbMode: 'note',
    defaultPlannedQty: null,
    defaultPilotNote: 'MVT小批試產 200pcs',
  },
  {
    key: 'MP_DFM',
    stage: 'MP',
    taskName: 'MP DFM REVIEW',
    taskCategory: 'dfm',
    pcbMode: 'qty',
    defaultPlannedQty: 2,
    defaultPilotNote: '',
  },
  {
    key: 'MP_PILOT',
    stage: 'MP',
    taskName: 'MP試產',
    taskCategory: 'pilot',
    pcbMode: 'note',
    defaultPlannedQty: null,
    defaultPilotNote: 'MP量產導入',
  },
];

export function formatStageTaskName(
  stage: ProjectStage,
  category: 'dfm' | 'pilot',
  iteration?: number | null
): string {
  const prefix = iteration && iteration > 0 ? `${stage}${iteration}` : stage;
  return category === 'dfm' ? `${prefix} DFM REVIEW` : `${prefix}試產`;
}

export function createTaskFromTemplate(
  tpl: StageTaskTemplate,
  iteration?: number | null
): ScheduleTask {
  const cat = tpl.taskCategory === 'pilot' ? 'pilot' : 'dfm';
  const taskName =
    iteration && iteration > 0
      ? formatStageTaskName(tpl.stage, cat, iteration)
      : tpl.taskName;
  const pilotNote =
    tpl.pcbMode === 'note' && iteration && iteration > 0
      ? `${tpl.stage}${iteration}試產 30pcs`
      : tpl.defaultPilotNote;

  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    taskName,
    stage: tpl.stage,
    stageIteration: iteration ?? null,
    taskCategory: tpl.taskCategory,
    pcbMode: tpl.pcbMode,
    plannedQty: tpl.defaultPlannedQty,
    actualQty: tpl.pcbMode === 'qty' ? 0 : null,
    pilotNote,
    completed: false,
    plannedStart: '',
    plannedEnd: '',
    actualStart: '',
    actualEnd: '',
    status: 'O',
  };
}
