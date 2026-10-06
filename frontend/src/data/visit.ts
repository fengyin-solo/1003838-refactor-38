import type { ActionResult, EntryRow, ModuleMeta, PageResult, VisitSummary } from './types'

// 工地接待的状态、动作与裁决规则集中在这一份「单一动作链」里：
// 列表行内按钮、详情弹层按钮、概览待办的结果投影都走同一条链，不再各写一份。
export const VISIT_PENDING = '待接待'
export const VISIT_RECEIVED = '已接待'
export const VISIT_ARCHIVED = '已归档'
export const VISIT_CANCELLED = '已取消'

export const VISIT_STATUSES = [VISIT_PENDING, VISIT_RECEIVED, VISIT_ARCHIVED, VISIT_CANCELLED] as const

export const VISIT_ACTION_RECEIVE = '完成接待'
export const VISIT_ACTION_ARCHIVE = '提交归档'
export const VISIT_ACTION_CANCEL = '取消接待'

// 存量记录缺少参观区域时，统一按「未分配」迁移，不改动原接待人与原状态。
export const UNASSIGNED_AREA = '未分配'

const CANCELLED_REJECTED: Record<string, string> = {
  // 裁决规则：已取消优先于任何后续归档——取消之后的归档请求一律拦下。
  [VISIT_ACTION_ARCHIVE]: '来访记录此前已取消，取消优先于后续归档，不能再提交归档；如需归档请先重新接待',
}

const TRANSITIONS: Record<string, Record<string, string>> = {
  [VISIT_ACTION_RECEIVE]: {
    // 取消后的记录仍能被接待：已取消 -> 待接待流转为已接待。
    [VISIT_PENDING]: VISIT_RECEIVED,
    [VISIT_CANCELLED]: VISIT_RECEIVED,
  },
  [VISIT_ACTION_ARCHIVE]: {
    // 归档记录还可能回到待接待（见取消动作），回到待接待、接待完成后可再次归档。
    [VISIT_RECEIVED]: VISIT_ARCHIVED,
  },
  [VISIT_ACTION_CANCEL]: {
    // 归档后取消：已归档 -> 待接待，批次重新进入接待队列。
    [VISIT_ARCHIVED]: VISIT_PENDING,
    [VISIT_PENDING]: VISIT_CANCELLED,
    [VISIT_RECEIVED]: VISIT_CANCELLED,
  },
}

const DENIED_HINTS: Record<string, Record<string, string>> = {
  [VISIT_ACTION_RECEIVE]: {
    [VISIT_RECEIVED]: '来访记录已经完成接待，不用重复操作',
    [VISIT_ARCHIVED]: '来访记录已归档，不能再完成接待；如需重新接待请先取消归档',
  },
  [VISIT_ACTION_ARCHIVE]: {
    [VISIT_PENDING]: '来访记录尚未完成接待，不能直接归档',
    [VISIT_ARCHIVED]: '来访记录已经归档，不用重复操作',
  },
  [VISIT_ACTION_CANCEL]: {
    [VISIT_CANCELLED]: '来访记录已经取消，不用重复操作；取消后的记录可直接完成接待',
  },
}

export function isVisitPending(row: EntryRow): boolean {
  return String(row.status) === VISIT_PENDING
}

export function isVisitAbnormal(row: EntryRow): boolean {
  return String(row.status) === VISIT_CANCELLED
}

export function visitActions(): string[] {
  return [VISIT_ACTION_RECEIVE, VISIT_ACTION_ARCHIVE, VISIT_ACTION_CANCEL]
}

/** 当前状态下允许执行的接待动作；列表与详情两处按钮的可用性都由它裁决。 */
export function visitAllowedActions(row: EntryRow): string[] {
  return visitActions().filter((action) => {
    const current = String(row.status)
    return Boolean(TRANSITIONS[action]?.[current])
  })
}

/**
 * 存量迁移：缺少参观区域的来访记录补「未分配」，
 * 接待人员、状态等历史字段原样保留，只把派生标记归一到当前语义。
 */
export function migrateVisitRow(row: EntryRow): EntryRow {
  const area = row['参观区域']
  const migrated = {
    ...row,
    '参观区域': area === undefined || String(area).trim() === '' ? UNASSIGNED_AREA : area,
  }
  migrated.pending = isVisitPending(migrated)
  migrated.abnormal = isVisitAbnormal(migrated)
  return migrated
}

function visitorCount(row: EntryRow): number {
  const raw = Number(row['来访人数'])
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

function isCurrentMonth(value: unknown, now: Date): boolean {
  if (typeof value !== 'string' || value.trim() === '') {
    return false
  }
  const day = new Date(`${value.slice(0, 10)}T00:00:00`)
  return (
    Number.isFinite(day.getTime()) &&
    day.getFullYear() === now.getFullYear() &&
    day.getMonth() === now.getMonth()
  )
}

/** 概览待办、页面指标卡、动作回参共用的汇总口径：只从一份行数据算一次。 */
export function summarizeVisit(rows: EntryRow[], now: Date = new Date()): VisitSummary {
  const summary: VisitSummary = {
    total: rows.length,
    pending: 0,
    received: 0,
    archived: 0,
    cancelled: 0,
    monthReceived: 0,
    totalVisitors: 0,
  }
  for (const row of rows) {
    const status = String(row.status)
    if (status === VISIT_PENDING) summary.pending += 1
    if (status === VISIT_RECEIVED) summary.received += 1
    if (status === VISIT_ARCHIVED) summary.archived += 1
    if (status === VISIT_CANCELLED) summary.cancelled += 1
    // 本月接待次数：本月已完成接待（含随后归档、取消的批次，历史接待事实保留）。
    if (
      (status === VISIT_RECEIVED || status === VISIT_ARCHIVED || status === VISIT_CANCELLED) &&
      isCurrentMonth(row['参观日期'], now)
    ) {
      summary.monthReceived += 1
    }
    // 累计参观人数只统计实际完成接待的批次，已取消批次不计入。
    if (status === VISIT_RECEIVED || status === VISIT_ARCHIVED) {
      summary.totalVisitors += visitorCount(row)
    }
  }
  return summary
}

type VisitChainContext = {
  meta: ModuleMeta
  rows: EntryRow[]
  index: number
  action: string
  next: EntryRow
  target: string
}

type VisitChainOutcome =
  | { pass: false; result: ActionResult }
  | { pass: true; context: VisitChainContext }

type VisitChainStep = {
  name: string
  run: (input: {
    meta: ModuleMeta
    rows: EntryRow[]
    id: number
    action: string
    index: number
  }) => VisitChainOutcome
}

function fail(message: string): VisitChainOutcome {
  return { pass: false, result: { ok: false, message } }
}

// 单一动作链：完成接待 / 提交归档 / 取消接待按同一组有序步骤依次裁决，
// 任一步失败立即短路返回，不会写出半条状态。
export const VISIT_ACTION_CHAIN: VisitChainStep[] = [
  {
    name: '校验动作',
    run: ({ meta, rows, index, action }) => {
      if (!visitActions().includes(action)) {
        return fail(`${meta.entity}没有登记「${action}」这个动作`)
      }
      return {
        pass: true,
        context: { meta, rows, index, action, next: {} as EntryRow, target: '' },
      }
    },
  },
  {
    name: '定位记录',
    run: ({ meta, rows, id, index, action }) => {
      const located = rows.findIndex((row) => Number(row.id) === id)
      if (located < 0) {
        return fail(`没有找到编号为 ${id} 的${meta.entity}`)
      }
      return {
        pass: true,
        context: { meta, rows, index: located, action, next: {} as EntryRow, target: '' },
      }
    },
  },
  {
    name: '裁决流转',
    run: ({ meta, rows, index, action }) => {
      const current = rows[index]
      const status = String(current.status)
      // 最高优先级：已取消优先于任何后续归档。
      if (status === VISIT_CANCELLED && CANCELLED_REJECTED[action]) {
        return fail(CANCELLED_REJECTED[action])
      }
      const target = TRANSITIONS[action]?.[status]
      if (!target) {
        return fail(DENIED_HINTS[action]?.[status] ?? `${meta.entity}当前「${status}」，不能${action}`)
      }
      if (target === status) {
        return fail(`${meta.entity}已经是「${target}」，不用重复操作`)
      }
      // 历史来访记录保留原接待人：流转只改状态与派生标记，不覆盖接待人员等字段。
      const next: EntryRow = {
        ...migrateVisitRow(current),
        status: target,
        pending: target === VISIT_PENDING,
        abnormal: target === VISIT_CANCELLED,
      }
      return {
        pass: true,
        context: { meta, rows, index, action, next, target },
      }
    },
  },
]

/**
 * 执行接待动作链：链上步骤全部通过后才提交持久化，再用提交后的同一份数据
 * 一次性投影出列表结果与概览汇总——任一步失败都不会只改列表而漏掉待办。
 */
export function runVisitChain(params: {
  meta: ModuleMeta
  id: number
  action: string
  loadRows: () => EntryRow[]
  commit: (rows: EntryRow[]) => void
  project: (rows: EntryRow[]) => { list: PageResult; summary: VisitSummary }
}): ActionResult {
  const { meta, id, action, loadRows, commit, project } = params
  const initialRows = loadRows()
  let context: VisitChainContext = {
    meta,
    rows: initialRows,
    index: -1,
    action,
    next: {} as EntryRow,
    target: '',
  }
  for (const step of VISIT_ACTION_CHAIN) {
    const outcome = step.run({
      meta: context.meta,
      rows: context.rows,
      id,
      action: context.action,
      index: context.index,
    })
    if (!outcome.pass) {
      return outcome.result
    }
    context = outcome.context
  }
  if (context.index < 0) {
    return { ok: false, message: '接待动作链未定位到记录，操作未执行' }
  }

  // 提交前先把下一份全量数据在内存里算好，提交与投影共用，杜绝两边口径分叉。
  const nextRows = [...context.rows]
  nextRows[context.index] = context.next
  commit(nextRows)
  const { list, summary } = project(nextRows)
  return {
    ok: true,
    message: `${meta.entity}已${action}，当前状态「${context.target}」`,
    list,
    summary,
    row: context.next,
  }
}
