import type { EntryRow, ModuleMeta } from './types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 一条流转规则：动作、允许发起的现状、目标状态。from 为空表示不限来源（兼容未登记专用链的老模块）。
export type TransitionRule = {
  action: string
  from: string[]
  to: string
}

// 工地接待的专用动作链：
//   待接待 --完成接待--> 已接待 --提交归档--> 已归档
//   待接待/已接待 --取消接待--> 已取消
// 已取消、已归档都是终态。裁决规则：已取消优先于任何后续归档——
// 记录一旦取消，之后的归档（以及任何其他动作）一律驳回，取消结果不被覆盖。
const VISIT_RULES: TransitionRule[] = [
  { action: '完成接待', from: ['待接待'], to: '已接待' },
  { action: '提交归档', from: ['已接待'], to: '已归档' },
  { action: '取消接待', from: ['待接待', '已接待'], to: '已取消' },
]

const MODULE_RULES: Record<string, TransitionRule[]> = {
  visit: VISIT_RULES,
}

function hasExplicitRules(meta: ModuleMeta): boolean {
  return meta.key in MODULE_RULES
}

// 模块的完整动作链：登记过专用规则的用专用规则；其余模块按元数据退回旧行为（不限来源、只拦重复状态）。
export function transitionRules(meta: ModuleMeta): TransitionRule[] {
  const explicit = MODULE_RULES[meta.key]
  if (explicit) {
    return explicit
  }
  return meta.actions
    .filter((action) => Boolean(meta.actionTargets[action]))
    .map((action) => ({ action, from: [], to: meta.actionTargets[action] }))
}

// 终态判断：专用链看该状态是否还有可发起的动作；老模块沿用「最后一个状态即终点」。
export function isTerminalStatus(meta: ModuleMeta, status: string): boolean {
  if (hasExplicitRules(meta)) {
    return !transitionRules(meta).some((rule) => rule.from.includes(status))
  }
  return status === meta.statuses[meta.statuses.length - 1]
}

// 待办标志的唯一出处：接待动作与概览待办都从这里取，保证两边看到的是同一份结果。
export function derivePending(meta: ModuleMeta, status: string): boolean {
  return !isTerminalStatus(meta, status)
}

// 行级待办：有专用链的模块按状态推导（与动作结果同源），其余模块读存量标志，行为与旧版一致。
export function rowPending(meta: ModuleMeta, row: EntryRow): boolean {
  if (hasExplicitRules(meta)) {
    return derivePending(meta, String(row.status))
  }
  return Boolean(row.pending)
}

// 这条记录当前还能执行哪些动作：列表行按钮、详情按钮都从这里取，入口再多也只有一份判断。
export function availableActions(meta: ModuleMeta, row: EntryRow): string[] {
  const current = String(row.status)
  return transitionRules(meta)
    .filter((rule) => rule.to !== current)
    .filter((rule) => rule.from.length === 0 || rule.from.includes(current))
    .map((rule) => rule.action)
}

export type TransitionPlan =
  | { ok: true; action: string; next: EntryRow }
  | { ok: false; message: string }

// 动作链的唯一入口：校验来源状态，并一次性算出包含状态与待办标志的完整新行。
// 只产出计划不落盘，调用方拿到整行一次写入——任何一步失败都不会只改状态而漏掉待办。
export function planTransition(meta: ModuleMeta, row: EntryRow, action: string): TransitionPlan {
  const rule = transitionRules(meta).find((item) => item.action === action)
  if (!rule) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const current = String(row.status)
  if (current === rule.to) {
    return { ok: false, message: `${meta.entity}已经是「${rule.to}」，不用重复操作` }
  }
  if (hasExplicitRules(meta)) {
    if (isTerminalStatus(meta, current)) {
      if (current === '已取消') {
        return {
          ok: false,
          message: `${meta.entity}已取消，按「已取消优先于任何后续归档」规则，「${action}」被驳回`,
        }
      }
      return { ok: false, message: `${meta.entity}已${current}，「${action}」不再受理` }
    }
    if (!rule.from.includes(current)) {
      return { ok: false, message: `${meta.entity}当前状态「${current}」不能执行「${action}」` }
    }
  }
  const next: EntryRow = {
    ...row,
    status: rule.to,
    pending: derivePending(meta, rule.to),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  return { ok: true, action, next }
}
