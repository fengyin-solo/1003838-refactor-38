import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'
import { migrateVisitRow } from './visit'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'field-archaeology-digital:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 读入即迁移：工地接待存量记录缺少参观区域时补「未分配」，原接待人与状态保留。
function migrateSnapshot(snapshot: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  if (!Array.isArray(snapshot.visit)) {
    return snapshot
  }
  return { ...snapshot, visit: snapshot.visit.map(migrateVisitRow) }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = migrateSnapshot(clone(SEED_ROWS))
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return migrateSnapshot({ ...fallback, ...parsed })
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  // 写入同样过一遍迁移（重置会直接灌入种子数据），保证缓存里没有漏迁的来访记录。
  const incoming = key === 'visit' ? rows.map(migrateVisitRow) : rows
  const next = { ...allRows(), [key]: incoming }
  // 先持久化、再切缓存：写存储失败时内存快照不动，避免列表已变、待办未变的半截状态。
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  cache = next
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
