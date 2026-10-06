<template>
  <section class="page" data-module="visit">
    <header class="page-head">
      <div>
        <h2>工地接待管理</h2>
        <p class="page-desc">维护来访记录，围绕来访编号、来访单位、来访人数、参观日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记来访记录</button>
        <button class="btn" type="button" @click="exportRows">导出工地接待清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <template v-for="action in actions" :key="action">
              <button
                class="link"
                type="button"
                :disabled="!allowedMap.get(String(row.id))?.includes(action)"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无工地接待数据，可先登记来访记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条工地接待记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detailRow" class="detail-mask" @click.self="closeDetail">
      <div class="detail-dialog" role="dialog" aria-modal="true" aria-label="来访记录详情">
        <header class="detail-head">
          <h3>来访记录详情 · {{ detailRow['来访编号'] }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-grid">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ detailRow[field] ?? '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detailRow.status }}</dd>
        </dl>
        <!-- 详情弹层与列表行共用同一条动作链，裁决规则和结果口径完全一致。 -->
        <div class="detail-actions">
          <button
            v-for="action in actions"
            :key="action"
            class="btn"
            type="button"
            :disabled="!detailAllowed.includes(action)"
            @click="runAction(action, detailRow)"
          >
            {{ action }}
          </button>
        </div>
        <p v-if="detailMessage" class="detail-message" :class="{ 'error-text': !detailOk }">{{ detailMessage }}</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  moduleMeta,
  runAction as applyAction,
  visitAllowedActions,
  visitSnapshot,
} from '@/api/local-service'
import type { EntryRow, VisitSummary } from '@/data/types'

const meta = moduleMeta('visit')
const columns = ['来访编号', '来访单位', '来访人数', '参观日期', '接待人员', '参观区域', '备注事项']
const actions = ['完成接待', '提交归档', '取消接待']
const statuses = ['待接待', '已接待', '已归档', '已取消']
const metricLabels = ['本月接待次数', '累计参观人数', '待接待批次']
const detailFields = [...columns]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const summary = ref<VisitSummary>({
  total: 0,
  pending: 0,
  received: 0,
  archived: 0,
  cancelled: 0,
  monthReceived: 0,
  totalVisitors: 0,
})
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = meta.fields.slice(0, 3)

// 列表与详情用同一份可用性裁决：哪些动作能点，单一动作链说了算。
const allowedMap = computed(() => {
  const map = new Map<string, string[]>()
  for (const row of rows.value) {
    map.set(String(row.id), visitAllowedActions(row))
  }
  return map
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count:
      status === '待接待'
        ? summary.value.pending
        : status === '已接待'
          ? summary.value.received
          : status === '已归档'
            ? summary.value.archived
            : summary.value.cancelled,
  })),
)

// 指标卡与概览待办同口径：直接取动作链共享的汇总，不再本地另算一份。
const stats = computed(() => [
  { label: metricLabels[0], value: summary.value.monthReceived },
  { label: metricLabels[1], value: summary.value.totalVisitors },
  { label: metricLabels[2], value: summary.value.pending },
])

const detailRow = ref<EntryRow | null>(null)
const detailMessage = ref('')
const detailOk = ref(true)

const detailAllowed = computed(() => (detailRow.value ? visitAllowedActions(detailRow.value) : []))

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '来访记录登记入口尚未接入审批流'
}

function openDetail(row: EntryRow) {
  detailRow.value = row
  detailMessage.value = ''
  detailOk.value = true
}

function closeDetail() {
  detailRow.value = null
  detailMessage.value = ''
}

// 列表行与详情弹层的按钮都走这里：成功时用动作链回参同时刷新列表与待办汇总，
// 任一步失败回参里没有结果投影，列表状态和待办都保持原样，不会只改一边。
function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  detailMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, filters.value)
  if (!result.ok || !result.list || !result.summary) {
    errorMessage.value = result.message
    detailMessage.value = result.message
    detailOk.value = false
    return
  }
  rows.value = result.list.items
  total.value = result.list.total
  summary.value = result.summary
  if (detailRow.value && String(detailRow.value.id) === String(row.id) && result.row) {
    detailRow.value = result.row
  }
  detailMessage.value = result.message
  detailOk.value = true
}

function reload() {
  errorMessage.value = ''
  try {
    // 接待动作与概览待办使用同一份结果：动作页与概览页都取 visitSnapshot。
    const snapshot = visitSnapshot(undefined, filters.value)
    rows.value = snapshot.list.items
    total.value = snapshot.list.total
    summary.value = snapshot.summary
    if (detailRow.value) {
      const latest = snapshot.list.items.find((item) => String(item.id) === String(detailRow.value?.id))
      if (latest) {
        detailRow.value = latest
      }
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '工地接待列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.detail-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.detail-dialog {
  width: 560px;
  max-width: calc(100vw - 32px);
  max-height: 80vh;
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  padding: 16px 18px;
  border: 1px solid var(--border);
}
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.detail-head h3 {
  margin: 0;
  font-size: 16px;
}
.detail-grid {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 6px 12px;
  margin: 12px 0;
  font-size: 13px;
}
.detail-grid dt {
  color: var(--muted);
}
.detail-grid dd {
  margin: 0;
}
.detail-actions {
  display: flex;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.detail-message {
  margin: 10px 0 0;
  font-size: 12px;
}
.row-actions .link:disabled {
  color: #9aa7b8;
  cursor: not-allowed;
}
</style>
