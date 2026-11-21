/**
 * dsh-token-gist — browser half.
 *
 * A small sidebar-footer card (total tokens + gist sync status + a "sync now"
 * button) and a config form on the plugin's own Plugins page. It talks to the
 * Host through the Typert remote registered in index.js. UI copy follows DSH's
 * language through the Client locale service (zh / en).
 */

window.__ModuleLoader__.load({
  id: 'dsh-token-gist',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PACKAGE = 'dsh-token-gist'
    const REMOTE_SERVICE = 'dshTokenGist'
    const REMOTE_NAMESPACE = 'tokenGist'
    const CARD_ID = 'token-gist-card'
    const NS = 'tokenGist'

    const DICT = {
      en: {
        'card.title': 'Token usage',
        'card.loading': 'loading…',
        'card.notSynced': 'not synced yet',
        'card.synced': 'synced {time}',
        'card.syncFailed': 'sync failed',
        'card.syncing': 'syncing…',
        'card.sync': 'sync',
        'card.inOut': 'in {input} · out {output}',
        'readFailed': 'read failed',

        'form.title': 'Token usage · gist backup',
        'form.token': 'GitHub token (gist scope)',
        'form.gistId': 'Gist id (optional)',
        'form.gistIdPlaceholder': 'leave empty to create a new gist',
        'form.filename': 'Gist filename',
        'form.description': 'Gist description',
        'form.interval': 'Auto-sync interval (minutes)',
        'form.autoSync': 'Auto-sync to gist',
        'form.save': 'Save',
        'form.syncNow': 'Sync now',
        'form.loading': 'Loading config…',
        'form.loadError': 'Could not load config: {message}',
        'saved': 'saved',
        'saveFailed': 'save failed',
        'syncFailed': 'sync failed',
        'syncedTo': 'synced to gist {id}',
        'form.note': 'The token is stored in your local profile config. Prefer a fine-grained PAT limited to “Gists → read and write”, revocable anytime.',
      },
      zh: {
        'card.title': 'Token 用量',
        'card.loading': '加载中…',
        'card.notSynced': '尚未同步',
        'card.synced': '已于 {time} 同步',
        'card.syncFailed': '同步失败',
        'card.syncing': '同步中…',
        'card.sync': '同步',
        'card.inOut': '输入 {input} · 输出 {output}',
        'readFailed': '读取失败',

        'form.title': 'Token 用量 · gist 云备份',
        'form.token': 'GitHub token（gist 权限）',
        'form.gistId': 'Gist id（可选）',
        'form.gistIdPlaceholder': '留空则首次同步时自动新建 gist',
        'form.filename': 'Gist 文件名',
        'form.description': 'Gist 描述',
        'form.interval': '自动同步间隔（分钟）',
        'form.autoSync': '自动同步到 gist',
        'form.save': '保存',
        'form.syncNow': '立即同步',
        'form.loading': '加载配置中…',
        'form.loadError': '无法加载配置：{message}',
        'saved': '已保存',
        'saveFailed': '保存失败',
        'syncFailed': '同步失败',
        'syncedTo': '已同步到 gist {id}',
        'form.note': 'token 保存在你的本地 profile 配置中。建议使用仅限「Gists → 读写」的细粒度 PAT，可随时撤销。',
      },
    }

    function interpolate(template, params) {
      if (!params) return template
      return String(template).replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    }

    // Translator: falls back to English until the locale service is available.
    let t = (key, params) => interpolate(DICT.en[key] ?? key, params)
    let localeRevision = 0
    const localeListeners = new Set()
    const notifyLocale = () => {
      localeRevision += 1
      for (const fn of [...localeListeners]) fn()
    }

    function useT() {
      const [, setRev] = React.useState(localeRevision)
      React.useEffect(() => {
        const fn = () => setRev(localeRevision)
        localeListeners.add(fn)
        return () => { localeListeners.delete(fn) }
      }, [])
      return t
    }

    const encodable = (typeSymbol) => ({
      mode: 'strict',
      typeSymbol: `${PACKAGE}#${typeSymbol}`,
      create: () => ({ parse: (value) => value }),
    })

    const remoteDescriptor = (method, parameters, resultType) => ({
      id: `${PACKAGE}#${REMOTE_NAMESPACE}/${method}`,
      service: REMOTE_SERVICE,
      namespace: REMOTE_NAMESPACE,
      method,
      invocation: { kind: 'direct' },
      parameters,
      result: encodable(resultType),
    })

    const jsonParam = (name, typeSymbol, acceptsUndefined) => ({
      name,
      wire: name,
      source: 'json',
      codec: encodable(typeSymbol),
      acceptsUndefined,
    })

    const CONTRIBUTION = {
      package: PACKAGE,
      descriptors: [
        remoteDescriptor('summary', [], 'Summary'),
        remoteDescriptor('syncNow', [], 'SyncResult'),
        remoteDescriptor('config', [], 'ConfigView'),
        remoteDescriptor('setConfig', [jsonParam('patch', 'ConfigPatch', false)], 'ConfigView'),
      ],
    }

    const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '0')
    const msg = (error) => (error && error.message ? error.message : String(error || ''))

    const styles = {
      card: {
        display: 'flex', flexDirection: 'column', gap: '6px', width: '100%',
        padding: '10px 12px', boxSizing: 'border-box', cursor: 'default',
        fontFamily: 'inherit', color: 'var(--dsw-alias-text, inherit)',
      },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
      total: { fontSize: '13px', fontWeight: 600 },
      meta: { fontSize: '11px', opacity: 0.75, wordBreak: 'break-word' },
      button: {
        fontSize: '11px', padding: '2px 8px', borderRadius: '5px', border: '1px solid var(--dsw-alias-border, #8884)',
        background: 'transparent', color: 'inherit', cursor: 'pointer',
      },
      field: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' },
      input: {
        padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border, #8884)',
        background: 'transparent', color: 'inherit', fontSize: '12px', boxSizing: 'border-box', width: '100%',
      },
    }

    function useSummary() {
      const [summary, setSummary] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [syncing, setSyncing] = React.useState(false)

      const load = React.useCallback(async () => {
        if (!namespace) return
        try {
          const response = await namespace.summary()
          if (response && response.ok === true) setSummary(response.value)
          else setError((response && response.error && (response.error.message || response.error.code)) || 'read failed')
        } catch (e) {
          setError(msg(e))
        }
      }, [])

      React.useEffect(() => {
        void load()
        const timer = setInterval(() => void load(), 30000)
        return () => clearInterval(timer)
      }, [load])

      const sync = React.useCallback(async () => {
        if (!namespace || syncing) return
        setSyncing(true)
        try {
          const response = await namespace.syncNow()
          if (response && response.ok === true) await load()
          else setError((response && response.error && (response.error.message || response.error.code)) || 'sync failed')
        } catch (e) {
          setError(msg(e))
        } finally {
          setSyncing(false)
        }
      }, [syncing, load])

      return { summary, error, syncing, sync, load }
    }

    function SummaryCard() {
      const t = useT()
      const { summary, error, syncing, sync } = useSummary()
      if (!summary) {
        return h('div', { style: styles.card },
          h('div', { style: styles.total }, t('card.title')),
          h('div', { style: styles.meta }, error ? msg(error) : t('card.loading')),
        )
      }
      const lastSync = summary.lastSync
      const syncText = !lastSync
        ? t('card.notSynced')
        : lastSync.ok
          ? t('card.synced', { time: new Date(lastSync.at).toLocaleString() })
          : t('card.syncFailed')
      return h('div', { style: styles.card },
        h('div', { style: styles.row },
          h('span', { style: styles.total }, `${t('card.title')} · ${fmt(summary.totalTokens)}`),
          h('button', { style: styles.button, disabled: syncing, onClick: () => void sync() },
            syncing ? t('card.syncing') : t('card.sync')),
        ),
        h('div', { style: styles.meta },
          t('card.inOut', { input: fmt(summary.totals && summary.totals.inputTokens), output: fmt(summary.totals && summary.totals.outputTokens) })),
        h('div', { style: styles.meta }, syncText),
        error ? h('div', { style: { ...styles.meta, color: 'var(--dsw-alias-danger, #d66)' } }, msg(error)) : null,
      )
    }

    function ConfigForm() {
      const t = useT()
      const [view, setView] = React.useState(null)
      const [form, setForm] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(async () => {
        if (!namespace) return
        try {
          const response = await namespace.config()
          if (response && response.ok === true) {
            setView(response.value)
            setForm({
              gistToken: response.value.gistToken || '',
              gistId: response.value.gistId || '',
              gistFilename: response.value.gistFilename || 'dsh-token-usage.json',
              autoSync: response.value.autoSync !== false,
              syncIntervalMinutes: response.value.syncIntervalMinutes ?? 30,
              description: response.value.description || '',
            })
          } else setStatus((response && response.error && response.error.message) || t('readFailed'))
        } catch (e) {
          setStatus(msg(e))
        }
      }, [t])

      React.useEffect(() => { void load() }, [load])

      const save = async () => {
        if (!namespace || !form) return
        setBusy(true)
        setStatus(null)
        try {
          const response = await namespace.setConfig({
            gistToken: form.gistToken || '',
            gistId: form.gistId || '',
            gistFilename: form.gistFilename || 'dsh-token-usage.json',
            autoSync: form.autoSync,
            syncIntervalMinutes: Math.max(1, Number(form.syncIntervalMinutes) || 30),
            description: form.description || '',
          })
          if (response && response.ok === true) setStatus(t('saved'))
          else setStatus((response && response.error && response.error.message) || t('saveFailed'))
        } catch (e) {
          setStatus(msg(e))
        } finally {
          setBusy(false)
        }
      }

      const syncNow = async () => {
        if (!namespace) return
        setBusy(true)
        setStatus(null)
        try {
          const response = await namespace.syncNow()
          if (response && response.ok === true) setStatus(t('syncedTo', { id: response.value.gistId }))
          else setStatus((response && response.error && response.error.message) || t('syncFailed'))
        } catch (e) {
          setStatus(msg(e))
        } finally {
          setBusy(false)
        }
      }

      if (!form) {
        return h('div', { style: { padding: '12px 16px', fontSize: '13px' } },
          status ? t('form.loadError', { message: status }) : t('form.loading'))
      }

      const field = (label, control) => h('label', { style: styles.field },
        h('span', null, label),
        control,
      )

      const input = (value, onChange, props) => h('input', {
        type: 'text', value, onChange: (e) => onChange(e.target.value), style: styles.input, ...props,
      })

      return h('div', { style: { padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '520px' } },
        h('div', { style: { fontSize: '13px', fontWeight: 600 } }, t('form.title')),
        field(t('form.token'), input(form.gistToken, (v) => setForm({ ...form, gistToken: v }), { type: 'password', placeholder: 'ghp_… / gho_…' })),
        field(t('form.gistId'), input(form.gistId, (v) => setForm({ ...form, gistId: v }), { placeholder: t('form.gistIdPlaceholder') })),
        field(t('form.filename'), input(form.gistFilename, (v) => setForm({ ...form, gistFilename: v }))),
        field(t('form.description'), input(form.description, (v) => setForm({ ...form, description: v }))),
        field(t('form.interval'), input(String(form.syncIntervalMinutes), (v) => setForm({ ...form, syncIntervalMinutes: v }), { inputMode: 'numeric' })),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' } },
          h('input', { type: 'checkbox', checked: form.autoSync, onChange: (e) => setForm({ ...form, autoSync: e.target.checked }) }),
          h('span', null, t('form.autoSync')),
        ),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('button', { style: styles.button, disabled: busy, onClick: () => void save() }, busy ? '…' : t('form.save')),
          h('button', { style: styles.button, disabled: busy, onClick: () => void syncNow() }, t('form.syncNow')),
        ),
        status ? h('div', { style: { fontSize: '12px', opacity: 0.8 } }, status) : null,
        h('div', { style: { fontSize: '11px', opacity: 0.6 } }, t('form.note')),
      )
    }

    function apply(ctx) {
      const face = () => ({ refresh: () => { /* card self-refreshes */ } })

      // Localize UI copy through the Client locale service. Registering the
      // dictionary is optional: without the service, `t` keeps the English
      // fallback above.
      ctx.inject(['locale'], (localeCtx) => {
        const locale = localeCtx.locale
        if (!locale || typeof locale.register !== 'function') return
        localeCtx.effect(() => locale.register(NS, { zh: DICT.zh, en: DICT.en }), `${PACKAGE}: dictionary`)
        t = locale.bind(NS)
        localeCtx.effect(() => {
          const unsubscribe = locale.subscribe(notifyLocale)
          return () => unsubscribe()
        }, `${PACKAGE}: locale subscription`)
        notifyLocale()
      })

      ctx.effect(() => {
        let cancelled = false
        let unmount
        ctx.remote
          .$mount(CONTRIBUTION)
          .then((dispose) => {
            if (cancelled) {
              dispose()
              return
            }
            unmount = dispose
            ctx.inject([`remote.${REMOTE_NAMESPACE}`], (namespaceCtx) => {
              namespace = namespaceCtx.remote[REMOTE_NAMESPACE]
              namespaceCtx.effect(() => () => { namespace = undefined }, `${PACKAGE}: namespace`)
            })
          })
          .catch((error) => {
            console.error(`[${PACKAGE}] could not mount remote:`, error)
          })
        return () => {
          cancelled = true
          if (unmount) unmount()
        }
      }, `${PACKAGE}: remote`)

      // Plugin's own config page (Plugins manager).
      ctx.slots.inject('plugins.bundle.config', () =>
        ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE }, ConfigForm),
      )

      // Sidebar footer card.
      ctx.inject(['layout'], (layoutCtx) => {
        layoutCtx.slots.inject('sidebar.footer.action', () =>
          layoutCtx.slots.register({ name: 'sidebar.footer.action', id: CARD_ID, order: 5, inject: face }, SummaryCard),
        )
      })
    }

    return {
      inject: ['slots', 'remote'],
      apply,
    }
  },
})
