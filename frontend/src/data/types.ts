/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type VisitSummary = {
  total: number
  pending: number
  received: number
  archived: number
  cancelled: number
  monthReceived: number
  totalVisitors: number
}

export type ActionResult = {
  ok: boolean
  message: string
  // 接待动作成功时，列表分页与概览待办同出自这一份结果，避免两边各算各的。
  list?: PageResult
  summary?: VisitSummary
  row?: EntryRow
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
