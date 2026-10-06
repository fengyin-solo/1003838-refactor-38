import { derivePending } from './action-chain'
import { MODULE_BY_KEY } from './modules'
import type { EntryRow } from './types'

// 参观区域缺失时的迁移值：存量记录没填参观区域的一律按「未分配」落库。
export const UNASSIGNED_VISIT_AREA = '未分配'

// 工地接待存量迁移：
// - 缺参观区域的补「未分配」；
// - 待办标志按动作链重新推导，修掉旧版「归档又回到待办」写坏的存量数据；
// - 历史来访记录的接待人员与状态原样保留，迁移绝不改写这两项。
export function migrateVisitRows(rows: EntryRow[]): EntryRow[] {
  const meta = MODULE_BY_KEY.get('visit')
  if (!meta) {
    return rows
  }
  return rows.map((row) => {
    const next: EntryRow = { ...row, pending: derivePending(meta, String(row.status)) }
    const area = row['参观区域']
    if (typeof area !== 'string' || area.trim() === '') {
      next['参观区域'] = UNASSIGNED_VISIT_AREA
    }
    return next
  })
}

// 读取存量数据的统一出口：目前只有工地接待需要迁移，后续模块的迁移也挂在同一个函数里。
export function migrateEntries(entries: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  if (!entries.visit) {
    return entries
  }
  return { ...entries, visit: migrateVisitRows(entries.visit) }
}
