/**
 * dsh-token-gist — cumulative token usage tracker with GitHub gist backup.
 *
 * Host half. It folds provider-reported token usage out of the `session/event`
 * feed into a running total that lives in its own file — NOT derived from
 * session logs — so deleting or compacting a conversation never reduces the
 * total. The total is written locally and synced to a GitHub gist.
 *
 * It also registers a Typert remote (read by the browser card) and a
 * `/token-usage` slash command.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import Schema from '@deepseek-ai/schemastery'

const PACKAGE = 'dsh-token-gist'
const ROW_ID = 'dsh-token-gist'
const REMOTE_SERVICE = 'dshTokenGist'
const REMOTE_NAMESPACE = 'tokenGist'
const STATE_VERSION = 1

export const Config = Schema.object({
  gistToken: Schema.string()
    .description('GitHub personal access token with gist write scope; or set env DSH_TOKEN_GIST_TOKEN.'),
  gistId: Schema.string()
    .description('Existing gist id to update. Empty = create a new gist on the first sync.'),
  gistFilename: Schema.string()
    .default('dsh-token-usage.json')
    .description('Filename inside the gist.'),
  autoSync: Schema.boolean()
    .default(true)
    .description('Sync to gist automatically on an interval.'),
  syncIntervalMinutes: Schema.natural()
    .default(30)
    .max(1440)
    .description('Auto-sync interval in minutes (1-1440).'),
  description: Schema.string()
    .default('DSH token usage total')
    .description('Gist description.'),
})

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const STATE_DIR = process.env.DSH_TOKEN_GIST_DIR || path.join(dshHome, 'dsh-token-gist')
const STATE_FILE = path.join(STATE_DIR, 'state.json')

const emptyBuckets = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

const bucketsOf = (usage) => ({
  inputTokens: num(usage && usage.inputTokens),
  outputTokens: num(usage && usage.outputTokens),
  cacheReadTokens: num(usage && usage.cacheReadTokens),
  cacheWriteTokens: num(usage && usage.cacheWriteTokens),
})

const bucketsEqual = (a, b) =>
  a.inputTokens === b.inputTokens
  && a.outputTokens === b.outputTokens
  && a.cacheReadTokens === b.cacheReadTokens
  && a.cacheWriteTokens === b.cacheWriteTokens

const totalOf = (b) => b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens

/** Last `usage` chunk in a compact assistant stream, scanning backwards. */
function lastUsageFromStream(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let i = stream.length - 1; i >= 0; i -= 1) {
    const record = stream[i]
    if (record && record.type === 'chunk' && record.chunk && record.chunk.type === 'usage') {
      return record.chunk.usage
    }
  }
  return undefined
}

/** Mirrors token-meter's `usageOf`: settled usage, else the stream's last usage. */
function usageOf(event) {
  if (event.type === 'assistant/message' && event.data && event.data.usage !== undefined) {
    return event.data.usage
  }
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  return lastUsageFromStream(event.data && event.data.stream)
}

function localDayKey(ms) {
  const d = new Date(ms)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (
      parsed
      && parsed.version === STATE_VERSION
      && parsed.totals
      && parsed.perDay
      && parsed.last
    ) {
      return parsed
    }
  } catch {
    // first run or unreadable state: start fresh
  }
  return {
    version: STATE_VERSION,
    updatedAt: Date.now(),
    totals: emptyBuckets(),
    perDay: {},
    last: {},
    lastSync: null,
  }
}

class Tracker {
  constructor(config) {
    this.config = config || {}
    this.state = loadState()
    this.persistTimer = undefined
    this.syncTimer = undefined
    this.firstSyncTimer = undefined
    this.syncing = false
  }

  token() {
    return this.config.gistToken || process.env.DSH_TOKEN_GIST_TOKEN || ''
  }

  /** Fold one usage event into the running totals (mirrors the token-meter fold). */
  fold(sessionId, turn, step, usage, timeMs) {
    const buckets = bucketsOf(usage)
    const last = this.state.last[sessionId]
    const previous = last && last.turn === turn && last.step === step ? last.buckets : undefined
    if (previous && bucketsEqual(previous, buckets)) return

    const delta = {
      inputTokens: buckets.inputTokens - (previous ? previous.inputTokens : 0),
      outputTokens: buckets.outputTokens - (previous ? previous.outputTokens : 0),
      cacheReadTokens: buckets.cacheReadTokens - (previous ? previous.cacheReadTokens : 0),
      cacheWriteTokens: buckets.cacheWriteTokens - (previous ? previous.cacheWriteTokens : 0),
    }

    const t = this.state.totals
    t.inputTokens += delta.inputTokens
    t.outputTokens += delta.outputTokens
    t.cacheReadTokens += delta.cacheReadTokens
    t.cacheWriteTokens += delta.cacheWriteTokens

    const key = localDayKey(timeMs || Date.now())
    const day = this.state.perDay[key] || emptyBuckets()
    day.inputTokens += delta.inputTokens
    day.outputTokens += delta.outputTokens
    day.cacheReadTokens += delta.cacheReadTokens
    day.cacheWriteTokens += delta.cacheWriteTokens
    this.state.perDay[key] = day

    this.state.last[sessionId] = { turn, step, buckets, at: Date.now() }
    this.state.updatedAt = Date.now()
    this.pruneLast()
    this.schedulePersist()
  }

  retryStarted(sessionId, turn, step) {
    const last = this.state.last[sessionId]
    if (last && last.turn === turn && last.step === step) delete this.state.last[sessionId]
  }

  pruneLast() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    for (const sid of Object.keys(this.state.last)) {
      if (this.state.last[sid].at < cutoff) delete this.state.last[sid]
    }
  }

  schedulePersist() {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined
      this.persist()
    }, 800)
  }

  persist() {
    try {
      atomicWrite(STATE_FILE, this.state)
    } catch {
      // non-fatal: keep counting in memory and retry on the next write
    }
  }

  summary() {
    return {
      totals: { ...this.state.totals },
      totalTokens: totalOf(this.state.totals),
      perDay: { ...this.state.perDay },
      lastSync: this.state.lastSync ? { ...this.state.lastSync } : null,
      updatedAt: this.state.updatedAt,
      configured: Boolean(this.token()),
      gistId: (this.state.lastSync && this.state.lastSync.gistId) || this.config.gistId || '',
    }
  }

  summaryText() {
    const s = this.summary()
    const fmt = (n) => n.toLocaleString('en-US')
    const lines = [
      `Token 总用量：${fmt(s.totalTokens)}`,
      `  输入 ${fmt(s.totals.inputTokens)} · 输出 ${fmt(s.totals.outputTokens)} · 缓存读 ${fmt(s.totals.cacheReadTokens)} · 缓存写 ${fmt(s.totals.cacheWriteTokens)}`,
    ]
    const days = Object.keys(s.perDay).sort()
    const today = days[days.length - 1]
    if (today) lines.push(`今日（${today}）：${fmt(totalOf(s.perDay[today]))} tokens`)
    if (s.lastSync) {
      const status = s.lastSync.ok ? '成功' : `失败：${s.lastSync.error || '未知'}`
      lines.push(`最近 gist 同步：${new Date(s.lastSync.at).toLocaleString()} — ${status}${s.lastSync.gistId ? `（gist ${s.lastSync.gistId}）` : ''}`)
    } else {
      lines.push('最近 gist 同步：尚未同步')
    }
    if (!s.configured) lines.push('（未配置 gist token —— 请在插件配置里设置 gistToken，或设置环境变量 DSH_TOKEN_GIST_TOKEN）')
    return lines.join('\n')
  }

  async syncNow() {
    if (this.syncing) throw new Error('已有同步正在进行')
    const token = this.token()
    if (!token) throw new Error('未配置 gist token（请在插件配置里设置 gistToken，或设置环境变量 DSH_TOKEN_GIST_TOKEN）')
    this.syncing = true
    try {
      this.persist()
      const filename = this.config.gistFilename || 'dsh-token-usage.json'
      const gistId = (this.state.lastSync && this.state.lastSync.gistId) || this.config.gistId || ''
      const payload = {
        updatedAt: new Date(this.state.updatedAt).toISOString(),
        totals: this.state.totals,
        totalTokens: totalOf(this.state.totals),
        perDay: this.state.perDay,
        generatedBy: PACKAGE,
      }
      const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': PACKAGE,
        'Content-Type': 'application/json',
      }
      const method = gistId ? 'PATCH' : 'POST'
      const url = gistId ? `https://api.github.com/gists/${gistId}` : 'https://api.github.com/gists'
      const body = {
        description: this.config.description || 'DSH token usage total',
        public: false,
        files: { [filename]: { content: JSON.stringify(payload, null, 2) } },
      }
      const res = await fetch(url, { method, headers, body: JSON.stringify(body) })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`gist API ${res.status}: ${text.slice(0, 300)}`)
      }
      const data = await res.json()
      const newGistId = (data && data.id) || gistId
      this.state.lastSync = { at: Date.now(), ok: true, error: null, gistId: newGistId, url: (data && data.html_url) || '' }
      this.persist()
      return { ok: true, gistId: newGistId, url: (data && data.html_url) || '', at: this.state.lastSync.at }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      this.state.lastSync = { at: Date.now(), ok: false, error: message, gistId: (this.state.lastSync && this.state.lastSync.gistId) || this.config.gistId || '' }
      this.persist()
      throw error
    } finally {
      this.syncing = false
    }
  }

  start() {
    if (this.config.autoSync !== false && this.token()) {
      const mins = Math.max(1, Number(this.config.syncIntervalMinutes) || 30)
      this.syncTimer = setInterval(() => {
        void this.syncNow().catch(() => {})
      }, mins * 60 * 1000)
      this.firstSyncTimer = setTimeout(() => {
        void this.syncNow().catch(() => {})
      }, 15000)
    }
  }

  stop() {
    if (this.syncTimer) clearInterval(this.syncTimer)
    if (this.firstSyncTimer) clearTimeout(this.firstSyncTimer)
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = undefined
    }
    this.persist()
  }
}

// ── Remote result/parameter codecs ──────────────────────────────────────────

const codec = (typeSymbol, parse) => ({ mode: 'strict', typeSymbol, create: () => ({ parse }) })

function descriptor(method, parameters, typeSymbol, parse) {
  return {
    id: `${PACKAGE}#${REMOTE_NAMESPACE}/${method}`,
    service: REMOTE_SERVICE,
    namespace: REMOTE_NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters,
    result: codec(`${PACKAGE}#${typeSymbol}`, parse),
  }
}

const jsonParameter = (name, typeSymbol, parse, acceptsUndefined = false) => ({
  name,
  wire: name,
  source: 'json',
  codec: codec(`${PACKAGE}#${typeSymbol}`, parse),
  acceptsUndefined,
})

const assertObject = (value, label) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label}: not an object`)
  }
  return value
}

const parseSummary = (value) => {
  const v = assertObject(value, 'tokenGist/summary')
  if (typeof v.totals !== 'object' || v.totals === null || typeof v.totalTokens !== 'number') {
    throw new TypeError('tokenGist/summary: bad totals')
  }
  return v
}

const parseSyncResult = (value) => assertObject(value, 'tokenGist/syncNow')

const parseConfigView = (value) => assertObject(value, 'tokenGist/config')

const parseConfigPatch = (value) => {
  const v = assertObject(value, 'tokenGist/setConfig patch')
  return { ...v }
}

const SUMMARY_DESCRIPTOR = descriptor('summary', [], 'Summary', parseSummary)
const SYNC_DESCRIPTOR = descriptor('syncNow', [], 'SyncResult', parseSyncResult)
const CONFIG_DESCRIPTOR = descriptor('config', [], 'ConfigView', parseConfigView)
const SET_CONFIG_DESCRIPTOR = descriptor('setConfig', [jsonParameter('patch', 'ConfigPatch', parseConfigPatch)], 'ConfigView', parseConfigView)

const CONFIG_FIELDS = ['gistToken', 'gistId', 'gistFilename', 'autoSync', 'syncIntervalMinutes', 'description']

function configView(config) {
  const view = {}
  for (const key of CONFIG_FIELDS) view[key] = config[key]
  view.writable = true
  return view
}

/** The Remote receiver, one instance per plugin activation. */
class TokenGistService {
  constructor(tracker) {
    this.tracker = tracker
    this.configEditor = undefined
  }

  attachConfigEditor(configEditor) {
    this.configEditor = configEditor
  }

  entry() {
    if (!this.configEditor) return undefined
    const rows = this.configEditor.configuration()
    const mine = rows.find((item) => (
      item.entry && (item.entry.options && item.entry.options.name === PACKAGE
        || (typeof item.entry.id === 'string' && item.entry.id.includes(ROW_ID)))
    ))
    return mine && mine.entry
  }

  async summary() {
    return this.tracker.summary()
  }

  async syncNow() {
    return this.tracker.syncNow()
  }

  async config() {
    return { ...configView(this.tracker.config), writable: this.entry() !== undefined }
  }

  async setConfig(patch) {
    const entry = this.entry()
    if (entry === undefined) throw new Error(`未找到 ${PACKAGE} 的 Loader 配置项；请直接编辑 cordis.patch.yml`)
    const next = {}
    for (const key of CONFIG_FIELDS) {
      if (patch[key] !== undefined) next[key] = patch[key]
    }
    await this.configEditor.edit(entry, (current) => ({ ...current, ...next }))
    return { ...configView({ ...this.tracker.config, ...next }), writable: true }
  }
}

// ── plugin entry ────────────────────────────────────────────────────────────

export const inject = ['sessions', 'commands']

export function apply(ctx, config) {
  const tracker = new Tracker(config)

  // Accumulate token usage from every session's committed events. This runs on
  // NEW appends only (restore/fork history is not replayed), so the counter is
  // independent of the session logs and survives conversation deletion.
  ctx.on('session/event', (session, event) => {
    try {
      if (event.type === 'llm/retry-started') {
        tracker.retryStarted(session.id, event.data && event.data.turn, event.data && event.data.step)
        return
      }
      const usage = usageOf(event)
      if (usage === undefined) return
      tracker.fold(session.id, event.data.turn, event.data.step, usage, event.time)
    } catch {
      // never let accounting break the session feed
    }
  })

  // Slash command: `/token-usage` shows totals; `/token-usage sync` pushes now.
  ctx.commands.register({
    name: 'token-usage',
    description: '查看 DSH token 总用量与 gist 同步状态（加 "sync" 立即同步到 gist）',
    handler: async ({ rawInput }) => {
      const arg = (rawInput || '').trim().toLowerCase()
      if (arg === 'sync' || arg === 'push') {
        try {
          const result = await tracker.syncNow()
          return { kind: 'success', text: `已同步到 gist ${result.gistId}${result.url ? ` — ${result.url}` : ''}` }
        } catch (error) {
          return { kind: 'error', text: `gist 同步失败：${error && error.message ? error.message : String(error)}` }
        }
      }
      return { kind: 'success', text: tracker.summaryText() }
    },
  })

  // Auto-sync interval + first sync.
  tracker.start()

  // Expose the Remote for the browser card / config form.
  ctx.inject(['typert'], (remoteCtx) => {
    const service = new TokenGistService(tracker)
    service.typertRemote = Object.freeze({ service, serviceKey: REMOTE_SERVICE, namespace: REMOTE_NAMESPACE })
    remoteCtx.reflect.provide(REMOTE_SERVICE, service)

    remoteCtx.inject(['configEditor'], (configCtx) => {
      service.attachConfigEditor(configCtx.configEditor)
    })

    const unregister = remoteCtx.typert.register({
      package: PACKAGE,
      face: 'host',
      schemas: [],
      model: { services: [], events: [], objects: [] },
      invocations: [SUMMARY_DESCRIPTOR, SYNC_DESCRIPTOR, CONFIG_DESCRIPTOR, SET_CONFIG_DESCRIPTOR],
    })
    remoteCtx.effect(() => () => void unregister(), `${PACKAGE}: remote`)
  })

  ctx.on('dispose', () => tracker.stop())
}
