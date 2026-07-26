import React, { useEffect, useMemo, useState } from 'react'
import { io } from 'socket.io-client'
import {
  Activity,
  BarChart3,
  Bell,
  CheckCircle2,
  Database,
  Loader2,
  Mail,
  MessageCircle,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { api, getSession, getState, login, logout, socketBaseUrl } from './lib/api'
import { AppLayout, ConfigPanel, Topbar } from './components/AppLayout'
import { Card, StatCard, StatusBadge } from './components/ui'

function emptyWatchForm(state) {
  return {
    name: 'Aulnoy-lez-Valenciennes individuel',
    url: '',
    targetLocation: 'Aulnoy-lez-Valenciennes (59300)',
    occupationMode: 'alone',
    maxPrice: '',
    minArea: '',
    notifyWhatsApp: true,
    notifyEmail: Boolean(state?.settings?.emailSendingEnabled),
    whatsappRecipient: state?.settings?.defaultWhatsAppRecipient || state?.settings?.whatsappPhone || '',
    emailRecipient: state?.settings?.defaultEmail || '',
  }
}

function settingsFromState(state) {
  return {
    defaultEmail: state?.settings?.defaultEmail || '',
    defaultWhatsAppRecipient: state?.settings?.defaultWhatsAppRecipient || '',
    emailSendingEnabled: Boolean(state?.settings?.emailSendingEnabled),
    emailDeliveryMode: 'daily_summary',
    emailDailySummaryHour: state?.settings?.emailDailySummaryHour ?? 23,
    operationalAlertsEnabled: Boolean(state?.settings?.operationalAlertsEnabled),
    operationalAlertEmail: state?.settings?.operationalAlertEmail || '',
    scrapeIntervalMinutes: state?.settings?.scrapeIntervalMinutes || '',
    noResultWhatsAppIntervalMinutes: state?.settings?.noResultWhatsAppIntervalMinutes || '',
    noResultEmailEnabled: false,
    notificationTemplate: state?.settings?.notificationTemplate || '',
  }
}

function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits ? `+${digits}` : ''
}

function crousUrlAdvice(value) {
  if (!value) {
    return { tone: 'ready', text: 'Structured target mode is active. The backend will build the Crous URL from the target city and filters.' }
  }
  try {
    const url = new URL(value)
    if (url.hostname !== 'trouverunlogement.lescrous.fr') {
      return { tone: 'danger', text: 'This should be a trouverunlogement.lescrous.fr URL.' }
    }
    if (!url.pathname.includes('/search')) {
      return { tone: 'danger', text: 'This should be a Crous search URL, usually ending with /search.' }
    }
    if (!url.searchParams.has('bounds')) {
      return { tone: 'warning', text: 'This URL has no bounds. It may be too generic. Best practice is to search a city/zone on Crous, click “Rechercher dans la zone”, then paste the URL with bounds=...' }
    }
    return { tone: 'ready', text: 'Good: this looks like a targeted Crous search URL with map bounds.' }
  } catch {
    return { tone: 'danger', text: 'This is not a valid URL yet.' }
  }
}

function countRows(items = [], getKey, preferredOrder = []) {
  const counts = items.reduce((accumulator, item) => {
    const key = getKey(item) || 'unknown'
    accumulator[key] = (accumulator[key] || 0) + 1
    return accumulator
  }, {})

  return [...new Set([...preferredOrder, ...Object.keys(counts)])]
    .filter((key) => counts[key] > 0 || preferredOrder.includes(key))
    .map((key) => ({ label: key, value: counts[key] || 0, tone: key }))
}

function minutesFromMs(value, fallback) {
  return Math.round((Number(value || fallback || 0) / 60000) * 10) / 10
}

function GraphBars({ rows, emptyText = 'No data to graph yet.' }) {
  const max = Math.max(...rows.map((row) => row.value), 0)

  if (!rows.length || max === 0) {
    return <p className="graph-empty">{emptyText}</p>
  }

  return (
    <div className="graph-list">
      {rows.map((row) => (
        <div className="graph-row" key={row.label}>
          <div className="graph-meta">
            <strong>{row.label}</strong>
            <span>{row.value}</span>
          </div>
          <div className="graph-track" aria-label={`${row.label}: ${row.value}`}>
            <div className={`graph-fill ${row.tone}`} style={{ width: `${Math.max((row.value / max) * 100, 8)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function InsightTiles({ rows, totalLabel = 'total', emptyText = 'No data yet.' }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0)

  if (!rows.length || total === 0) {
    return <p className="graph-empty">{emptyText}</p>
  }

  return (
    <div className="insight-tiles">
      <div className="insight-total">
        <span>{totalLabel}</span>
        <strong>{total}</strong>
      </div>
      {rows.map((row) => (
        <div className={`insight-tile ${row.tone || row.label}`} key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
          <small>{Math.round((row.value / total) * 100)}%</small>
        </div>
      ))}
    </div>
  )
}

function SignalBars({ rows, emptyText = 'No graph data yet.' }) {
  const max = Math.max(...rows.map((row) => row.value), 0)

  if (!rows.length || max === 0) {
    return <p className="graph-empty">{emptyText}</p>
  }

  return (
    <div className="signal-bars">
      {rows.map((row) => (
        <div className={`signal-card ${row.tone || row.label}`} key={row.label}>
          <div>
            <strong>{row.value}</strong>
            <span>{row.label}</span>
          </div>
          <div className="signal-track">
            <i style={{ height: `${Math.max((row.value / max) * 100, 8)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

const chartColors = {
  success: '#0f6d5f',
  sent: '#0f6d5f',
  found: '#0f6d5f',
  failed: '#b42318',
  error: '#b42318',
  skipped: '#d97706',
  empty: '#d97706',
  whatsapp: '#25d366',
  email: '#2563eb',
}

function DonutChart({ title, segments, emptyText = 'No data yet.' }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  let cursor = 0
  const background = total
    ? `conic-gradient(${segments.map((segment) => {
      const start = cursor
      const end = cursor + (segment.value / total) * 100
      cursor = end
      return `${chartColors[segment.tone] || '#64748b'} ${start}% ${end}%`
    }).join(', ')})`
    : 'conic-gradient(#e2e8f0 0% 100%)'

  return (
    <div className="donut-widget">
      <div className="donut-chart" style={{ background }} aria-label={`${title}: ${total}`}>
        <div>
          <strong>{total}</strong>
          <span>{title}</span>
        </div>
      </div>
      <div className="donut-legend">
        {total ? segments.map((segment) => (
          <span key={segment.label}>
            <i style={{ background: chartColors[segment.tone] || '#64748b' }} />
            {segment.label}
            <strong>{segment.value}</strong>
          </span>
        )) : <p className="graph-empty">{emptyText}</p>}
      </div>
    </div>
  )
}

function buildRecipientSendHistogram(deliveryEvents = []) {
  const events = deliveryEvents
    .filter((event) => event.createdAt && event.status === 'success' && event.channel === 'whatsapp')
    .map((event) => ({
      createdAt: event.createdAt,
      recipient: event.recipient || 'Unknown number',
    }))
  const hours = []
  const now = new Date()
  now.setMinutes(0, 0, 0)
  for (let index = 7; index >= 0; index -= 1) {
    const date = new Date(now)
    date.setHours(now.getHours() - index)
    const key = date.toISOString().slice(0, 13)
    hours.push({
      key,
      label: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      total: 0,
      recipients: {},
    })
  }

  events.forEach((event) => {
    const date = new Date(event.createdAt)
    if (Number.isNaN(date.getTime())) return
    date.setMinutes(0, 0, 0)
    const bucket = hours.find((hour) => hour.key === date.toISOString().slice(0, 13))
    if (!bucket) return
    bucket.total += 1
    bucket.recipients[event.recipient] = (bucket.recipients[event.recipient] || 0) + 1
  })

  const recipientTotals = events.reduce((accumulator, event) => {
    accumulator[event.recipient] = (accumulator[event.recipient] || 0) + 1
    return accumulator
  }, {})

  return {
    hours,
    recipients: Object.entries(recipientTotals)
      .sort((first, second) => second[1] - first[1])
      .slice(0, 5)
      .map(([recipient, total]) => ({ recipient, total })),
  }
}

function SentByRecipientHistogram({ data }) {
  const max = Math.max(...data.hours.map((row) => row.total), 0)

  if (!max) {
    return <p className="graph-empty">No WhatsApp sends to graph yet.</p>
  }

  return (
    <>
      <div className="histogram">
        {data.hours.map((row) => (
          <div className="histogram-column" key={row.key}>
            <div
              className="histogram-bars"
              title={`${row.label}: ${row.total} WhatsApp send(s)${Object.entries(row.recipients).map(([recipient, total]) => ` · ${recipient}: ${total}`).join('')}`}
            >
              <span className="histogram-send" style={{ height: `${Math.max((row.total / max) * 100, row.total ? 8 : 0)}%` }} />
            </div>
            <small>{row.label}</small>
          </div>
        ))}
      </div>
      <div className="recipient-summary">
        {data.recipients.map((item) => (
          <span key={item.recipient}>
            <strong>{item.recipient}</strong>
            {item.total} sent
          </span>
        ))}
      </div>
    </>
  )
}

export default function App() {
  const [authLoading, setAuthLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [loginDraft, setLoginDraft] = useState({ username: '', password: '' })
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeView, setActiveView] = useState('dashboard')
  const [theme, setTheme] = useState(() => {
    const savedTheme = window.localStorage.getItem('crous-theme')
    if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [watchForm, setWatchForm] = useState(null)
  const [settingsDraft, setSettingsDraft] = useState(settingsFromState(null))
  const [manual, setManual] = useState({ phoneNumber: '', email: '', message: 'Bonjour, ceci est un test de notification Crous.' })
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [emailTest, setEmailTest] = useState('')

  const refresh = async () => {
    const next = await getState()
    setState(next)
    setWatchForm((current) => current || emptyWatchForm(next))
    setSettingsDraft(settingsFromState(next))
    setWhatsappPhone(formatPhone(next.settings?.whatsappPhone || next.whatsapp?.phoneNumber))
    setEmailTest((current) => current || next.settings?.defaultEmail || '')
    setLoading(false)
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('crous-theme', theme)
  }, [theme])

  useEffect(() => {
    getSession()
      .then(() => {
        setAuthenticated(true)
        return refresh()
      })
      .catch(() => {
        setAuthenticated(false)
        setLoading(false)
      })
      .finally(() => setAuthLoading(false))
  }, [])

  useEffect(() => {
    if (!authenticated) return undefined
    const socket = io(socketBaseUrl(), { withCredentials: true })
    socket.on('state:update', () => refresh().catch(() => undefined))
    socket.on('whatsapp:status', (status) => setState((current) => current ? { ...current, whatsapp: status } : current))
    return () => socket.disconnect()
  }, [authenticated])

  const enabledWatches = useMemo(() => state?.watches?.filter((watch) => watch.enabled).length || 0, [state])
  const deliveryMetrics = state?.deliveryMetrics || {}
  const checkMetrics = state?.checkMetrics || {}
  const whatsappSent = (deliveryMetrics.whatsapp_success || 0) + (deliveryMetrics.whatsapp_failed || 0)
  const emailSent = (deliveryMetrics.email_success || 0) + (deliveryMetrics.email_failed || 0)
  const watchUrlAdvice = crousUrlAdvice(watchForm?.url)
  const checkResultSegments = [
    { label: 'Found', value: state?.checkEvents?.filter((event) => event.foundCount > 0).length || 0, tone: 'found' },
    { label: 'No result', value: state?.checkEvents?.filter((event) => event.status !== 'error' && !event.foundCount).length || 0, tone: 'empty' },
    { label: 'Error', value: state?.checkEvents?.filter((event) => event.status === 'error').length || 0, tone: 'error' },
  ]
  const deliverySegments = [
    { label: 'Success', value: state?.deliveryEvents?.filter((event) => event.status === 'success').length || 0, tone: 'success' },
    { label: 'Failed', value: state?.deliveryEvents?.filter((event) => event.status !== 'success').length || 0, tone: 'failed' },
  ]
  const recipientSendData = buildRecipientSendHistogram(state?.deliveryEvents)

  const withSaving = async (work, successText) => {
    setSaving(true)
    setMessage(null)
    try {
      await work()
      await refresh()
      if (successText) setMessage({ type: 'success', text: successText })
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || error.message })
    } finally {
      setSaving(false)
    }
  }

  const submitWatch = async (event) => {
    event.preventDefault()
    await withSaving(async () => {
      await api.post('/watches', watchForm)
      setWatchForm(emptyWatchForm(state))
    }, 'Watch created and first check started.')
  }

  const saveSettings = async () => {
    await withSaving(async () => {
      await api.patch('/settings', settingsDraft)
    }, 'Configuration saved.')
  }

  const purgeOldData = async () => {
    if (!window.confirm('Delete logs, events, and unavailable listing history older than 7 days? Active watches will be preserved.')) return
    await withSaving(() => api.post('/maintenance/purge-old-data'), 'Data older than 7 days was removed.')
  }

  const deleteWatch = async (id) => withSaving(() => api.delete(`/watches/${id}`))
  const checkWatch = async (id) => withSaving(() => api.post(`/watches/${id}/check`), 'Watch checked.')
  const toggleWatch = async (watch) => withSaving(() => api.patch(`/watches/${watch.id}`, { enabled: !watch.enabled }))
  const startWhatsApp = async () => withSaving(() => api.post('/whatsapp/start', { phoneNumber: whatsappPhone }))
  const logoutWhatsApp = async () => withSaving(() => api.post('/whatsapp/logout'), 'WhatsApp logged out.')
  const sendWhatsAppTest = async () => withSaving(() => api.post('/notifications/manual', {
    phoneNumber: manual.phoneNumber,
    message: manual.message,
  }), 'WhatsApp test message sent.')
  const sendEmailTest = async () => withSaving(() => api.post('/email/test', { email: emailTest }), 'Email test sent.')

  const submitLogin = async (event) => {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      await login(loginDraft.username, loginDraft.password)
      setAuthenticated(true)
      setLoading(true)
      await refresh()
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || error.message })
    } finally {
      setSaving(false)
      setAuthLoading(false)
    }
  }

  const handleLogout = async () => {
    await logout().catch(() => undefined)
    setAuthenticated(false)
    setState(null)
    setMessage(null)
  }

  const toggleTheme = () => {
    setTheme((current) => current === 'dark' ? 'light' : 'dark')
  }

  const renderDashboard = () => (
    <>
      <section className="stats-grid">
        <StatCard title="Checks 24h" value={checkMetrics.checks24h || 0} icon={<RefreshCw />} />
        <StatCard title="Found 24h" value={checkMetrics.found24h || 0} icon={<Bell />} tone={(checkMetrics.found24h || 0) ? 'ready' : 'default'} />
        <StatCard title="WhatsApp sent" value={`${deliveryMetrics.whatsapp_success || 0}/${whatsappSent}`} icon={<MessageCircle />} tone={(deliveryMetrics.whatsapp_failed || 0) ? 'danger' : 'ready'} />
        <StatCard title="Email sent" value={`${deliveryMetrics.email_success || 0}/${emailSent}`} icon={<Mail />} tone={!state.settings?.emailSendingEnabled ? 'default' : (deliveryMetrics.email_failed || 0) ? 'danger' : 'ready'} />
      </section>

      <section className="grid three">
        <Card title="Watcher result donut" icon={<Bell size={18} />}>
          <DonutChart title="checks" segments={checkResultSegments} />
        </Card>
        <Card title="Delivery health donut" icon={<Send size={18} />}>
          <DonutChart title="sends" segments={deliverySegments} />
        </Card>
        <Card title="WhatsApp sent by time" icon={<BarChart3 size={18} />}>
          <SentByRecipientHistogram data={recipientSendData} />
          <div className="histogram-legend">
            <span><i className="histogram-send-dot" /> Successful sends by number</span>
          </div>
        </Card>
      </section>

      <section className="grid two">
        <Card title="System state" icon={<Activity size={18} />}>
          <div className="summary-list">
            <span><strong>{enabledWatches}</strong> active Crous watch(es)</span>
            <span><strong>{checkMetrics.totalChecks || 0}</strong> total checks</span>
            <span><strong>{checkMetrics.checksWithResults || 0}</strong> checks with housing found</span>
            <span><strong>{checkMetrics.newListingCount || 0}</strong> new listings detected</span>
            <span><strong>{state.whatsapp?.ready ? 'Ready' : 'Offline'}</strong> WhatsApp device</span>
            <span><strong>{state.smtp?.configured ? 'Ready' : 'Missing'}</strong> SMTP configuration</span>
            <span><strong>{state.settings?.emailSendingEnabled ? 'Enabled' : 'Disabled'}</strong> email sending</span>
            <span><strong>Daily summary</strong> email mode</span>
          </div>
        </Card>
        <Card title="Delivery result" icon={<Send size={18} />}>
          <div className="summary-list">
            <span><strong>{deliveryMetrics.whatsapp_success || 0}</strong> WhatsApp succeeded</span>
            <span><strong>{deliveryMetrics.whatsapp_failed || 0}</strong> WhatsApp failed</span>
            <span><strong>{deliveryMetrics.email_success || 0}</strong> Email succeeded</span>
            <span><strong>{deliveryMetrics.email_failed || 0}</strong> Email failed</span>
            <span><strong>{minutesFromMs(state.schedule?.scrapeIntervalMs, 60000)} min</strong> Crous check interval</span>
            <span><strong>{minutesFromMs(state.schedule?.noResultWhatsAppIntervalMs, 1800000)} min</strong> WhatsApp no-result heartbeat</span>
            <span><strong>{state.settings?.emailDailySummaryQueue?.length || 0}</strong> queued email summary item(s)</span>
          </div>
        </Card>
      </section>

      <section className="grid two">
        <Card title="Recent checks over time" icon={<RefreshCw size={18} />}>
          <div className="event-table compact">
            {state.checkEvents?.slice(0, 8).length ? state.checkEvents.slice(0, 8).map((event) => (
              <div className={`event-row ${event.status === 'error' ? 'failed' : event.foundCount ? 'sent' : 'skipped'}`} key={event.id}>
                <span>{new Date(event.createdAt).toLocaleString()}</span>
                <strong>{event.foundCount} found</strong>
                <p>{event.watchName || 'Watch'} · {event.message || event.errorMessage}</p>
              </div>
            )) : <p className="muted">No checks recorded yet.</p>}
          </div>
        </Card>
        <Card title="Recent sends over time" icon={<ShieldAlert size={18} />}>
          <div className="event-table compact">
            {state.deliveryEvents?.slice(0, 8).length ? state.deliveryEvents.slice(0, 8).map((event) => (
              <div className={`event-row ${event.status === 'success' ? 'sent' : 'failed'}`} key={event.id}>
                <span>{new Date(event.createdAt).toLocaleString()}</span>
                <strong>{event.channel}</strong>
                <p>{event.status} · {event.triggerType} · {event.recipient || '-'}</p>
              </div>
            )) : <p className="muted">No sends recorded yet.</p>}
          </div>
        </Card>
      </section>
    </>
  )

  const renderWatches = () => (
    <section className="grid two">
      <Card title="Crous search setup" icon={<Plus size={18} />}>
        <p className="section-note">Configure only the Crous target here. The system automatically resolves the city on the Crous website and watches individual housing for that area. Receivers stay in Configuration.</p>
        <form className="form" onSubmit={submitWatch}>
          <label>Name</label>
          <input value={watchForm.name} onChange={(event) => setWatchForm({ ...watchForm, name: event.target.value })} />
          <label>Target city, residence or study place</label>
          <input value={watchForm.targetLocation} onChange={(event) => setWatchForm({ ...watchForm, targetLocation: event.target.value })} placeholder="Aulnoy-lez-Valenciennes (59300)" />
          <div className={`url-advice ${watchUrlAdvice.tone}`}>
            <strong>Automatic Crous targeting</strong>
            <span>{watchUrlAdvice.text}</span>
          </div>
          <div className="config-help">
            The backend resolves the city with Crous Photon and generates the Crous bounds URL automatically.
          </div>
          <div className="checks">
            <label><input type="checkbox" checked={watchForm.notifyWhatsApp} onChange={(event) => setWatchForm({ ...watchForm, notifyWhatsApp: event.target.checked })} /> WhatsApp</label>
            <label><input type="checkbox" checked={watchForm.notifyEmail} onChange={(event) => setWatchForm({ ...watchForm, notifyEmail: event.target.checked })} disabled={!state.settings?.emailSendingEnabled} /> Email</label>
          </div>
          <div className="recipient-preview">
            <strong>Receivers are not edited here</strong>
            <span>WhatsApp: {state.settings?.defaultWhatsAppRecipient || 'No default WhatsApp receivers yet'}</span>
            <span>Email: {state.settings?.emailSendingEnabled ? (state.settings?.defaultEmail || 'No default email receivers yet') : 'Disabled by default'}</span>
          </div>
          <div className="actions">
            <button disabled={saving}><Plus size={16} /> Add Crous search</button>
            <button className="ghost" type="button" onClick={() => setActiveView('configuration')}>Edit receivers</button>
          </div>
        </form>
      </Card>

      <Card title="Active Crous searches" icon={<Bell size={18} />}>
        <div className="list">
          {state.watches?.length ? state.watches.map((watch) => (
            <div className="watch" key={watch.id}>
              <div>
                <strong>{watch.name}</strong>
                <p>{watch.url}</p>
                <small>Last: {watch.lastCheckedAt ? new Date(watch.lastCheckedAt).toLocaleString() : 'never'} · Results: {watch.lastResultCount || 0}</small>
                {watch.lastError && <small className="danger">{watch.lastError}</small>}
              </div>
              <div className="actions">
                <button className="ghost" onClick={() => toggleWatch(watch)}>{watch.enabled ? 'Pause' : 'Resume'}</button>
                <button className="ghost" onClick={() => checkWatch(watch.id)}><RefreshCw size={14} /> Check</button>
                <button className="danger-button" onClick={() => deleteWatch(watch.id)}><Trash2 size={14} /></button>
              </div>
            </div>
          )) : <p className="muted">No watches yet.</p>}
        </div>
      </Card>
    </section>
  )

  const renderWhatsApp = () => (
    <section className="grid two">
      <Card title="WhatsApp device" icon={<QrCode size={18} />}>
        <StatusBadge ready={state.whatsapp?.ready} text={state.whatsapp?.ready ? `Connected · +${state.whatsapp.phoneNumber}` : state.whatsapp?.state || 'Disconnected'} />
        <label>WhatsApp phone number</label>
        <input value={whatsappPhone} onChange={(event) => setWhatsappPhone(event.target.value)} placeholder="+212688505361" disabled={state.whatsapp?.ready} />
        <div className="qr-box">
          {state.whatsapp?.qrCode ? <img src={state.whatsapp.qrCode} alt="WhatsApp QR" /> : state.whatsapp?.ready ? <CheckCircle2 size={56} /> : <span>Start to generate QR</span>}
        </div>
        {state.whatsapp?.error && <p className="danger">{state.whatsapp.error}</p>}
        <div className="actions">
          <button onClick={startWhatsApp} disabled={saving || state.whatsapp?.ready}><Play size={16} /> Start / refresh QR</button>
          <button className="ghost" onClick={logoutWhatsApp}>Log out</button>
        </div>
      </Card>

      <Card title="WhatsApp status" icon={<MessageCircle size={18} />}>
        <div className="summary-list">
          <span><strong>{state.whatsapp?.state || 'disconnected'}</strong> current state</span>
          <span><strong>{state.whatsapp?.phoneNumber ? `+${state.whatsapp.phoneNumber}` : '-'}</strong> connected number</span>
          <span><strong>{state.whatsapp?.expectedPhoneNumber ? `+${state.whatsapp.expectedPhoneNumber}` : '-'}</strong> expected number</span>
          <span><strong>{state.whatsapp?.error || '-'}</strong> last error</span>
        </div>
      </Card>
    </section>
  )

  const renderMessages = () => (
    <section className="grid two">
      <Card title="Test WhatsApp send" icon={<MessageCircle size={18} />}>
        <StatusBadge ready={state.whatsapp?.ready} text={state.whatsapp?.ready ? `WhatsApp ready · +${state.whatsapp.phoneNumber}` : 'WhatsApp disconnected'} />
        <label>WhatsApp recipient</label>
        <input value={manual.phoneNumber} onChange={(event) => setManual({ ...manual, phoneNumber: event.target.value })} placeholder="+212600000000" />
        <label>WhatsApp test message</label>
        <textarea value={manual.message} onChange={(event) => setManual({ ...manual, message: event.target.value })} />
        <button onClick={sendWhatsAppTest} disabled={saving || !state.whatsapp?.ready}><Send size={16} /> Send WhatsApp test</button>
      </Card>

      <Card title="Email sending" icon={<ShieldAlert size={18} />}>
        <StatusBadge ready={state.smtp?.configured && state.settings?.emailSendingEnabled} text={state.settings?.emailSendingEnabled ? (state.smtp?.configured ? `Email ready · ${state.smtp.from}` : 'SMTP missing') : 'Email disabled by default'} />
        <label>Email recipient</label>
        <input value={emailTest} onChange={(event) => setEmailTest(event.target.value)} placeholder="student@example.com" disabled={!state.settings?.emailSendingEnabled} />
        <button className="ghost" onClick={sendEmailTest} disabled={saving || !state.smtp?.configured || !state.settings?.emailSendingEnabled}><Mail size={16} /> Send email test</button>
      </Card>
    </section>
  )

  const renderMonitoring = () => (
    <section className="grid two">
      <Card title="Monitoring health" icon={<BarChart3 size={18} />}>
        <InsightTiles
          rows={countRows(state.alertEmailEvents, (event) => event.status, ['sent', 'failed', 'skipped'])}
          totalLabel="alerts"
          emptyText="No monitoring email events to graph yet."
        />
        <SignalBars
          rows={countRows(state.alertEmailEvents, (event) => event.status, ['sent', 'failed', 'skipped'])}
          emptyText="No monitoring email events to graph yet."
        />
        <div className="graph-caption">
          Monitoring tracks critical-alert email behavior when email sending and operational alerts are enabled.
        </div>
      </Card>

      <Card title="Monitoring events" icon={<ShieldAlert size={18} />}>
        <div className="event-table">
          {state.alertEmailEvents?.length ? state.alertEmailEvents.map((event) => (
            <div className={`event-row ${event.status}`} key={event.id}>
              <span>{new Date(event.createdAt).toLocaleString()}</span>
              <strong>{event.status}</strong>
              <p>{event.subject || event.errorMessage || event.eventType}</p>
            </div>
          )) : <p className="muted">No monitoring email events yet.</p>}
        </div>
      </Card>
    </section>
  )

  const renderLogs = () => (
    <section className="grid two">
      <Card title="Log intelligence" icon={<BarChart3 size={18} />}>
        <InsightTiles
          rows={countRows(state.logs, (log) => log.level, ['info', 'warn', 'error'])}
          totalLabel="logs"
          emptyText="No logs to graph yet."
        />
        <div className="graph-caption">
          Fast signal of system health. Errors should stay close to zero; scrape and WhatsApp logs show the watcher is actively working.
        </div>
        <SignalBars
          rows={countRows(state.logs, (log) => log.type).slice(0, 8)}
          emptyText="No log types to graph yet."
        />
      </Card>

      <Card title="System logs" icon={<Database size={18} />}>
        <div className="logs">
          {state.logs?.length ? state.logs.map((log) => (
            <div className={`log ${log.level}`} key={log.id}>
              <span>{new Date(log.createdAt).toLocaleString()}</span>
              <strong>{log.type}</strong>
              <p>{log.message}</p>
            </div>
          )) : <p className="muted">No logs yet.</p>}
        </div>
      </Card>
    </section>
  )

  if (authLoading || loading) {
    return <div className="screen-center"><Loader2 className="spin" /> Loading automation...</div>
  }

  if (!authenticated) {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={submitLogin}>
          <div className="brand-mark">SC</div>
          <p className="eyebrow">Crous watcher</p>
          <h1>Login required</h1>
          <p>Enter the dashboard credentials to manage Crous alerts and WhatsApp notifications.</p>
          {message && <div className={`alert ${message.type}`}>{message.text}</div>}
          <label>Username</label>
          <input value={loginDraft.username} onChange={(event) => setLoginDraft({ ...loginDraft, username: event.target.value })} autoComplete="username" />
          <label>Password</label>
          <input value={loginDraft.password} onChange={(event) => setLoginDraft({ ...loginDraft, password: event.target.value })} type="password" autoComplete="current-password" />
          <button disabled={saving}>{saving ? <Loader2 className="spin" size={16} /> : null} Log in</button>
        </form>
      </div>
    )
  }

  if (!state) {
    return <div className="screen-center">Unable to load the automation API.{message?.text ? ` ${message.text}` : ''}</div>
  }

  const viewContent = {
    dashboard: renderDashboard(),
    watches: renderWatches(),
    whatsapp: renderWhatsApp(),
    messages: renderMessages(),
    monitoring: renderMonitoring(),
    logs: renderLogs(),
    configuration: (
      <ConfigPanel state={state} settingsDraft={settingsDraft} setSettingsDraft={setSettingsDraft} onSave={saveSettings} onPurgeOldData={purgeOldData} saving={saving} />
    ),
  }

  return (
    <AppLayout
      sidebarOpen={sidebarOpen}
      onToggleSidebar={() => setSidebarOpen((open) => !open)}
      activeView={activeView}
      onViewChange={setActiveView}
      topbar={<Topbar whatsappReady={state.whatsapp?.ready} smtpReady={state.smtp?.configured} emailEnabled={state.settings?.emailSendingEnabled} theme={theme} onToggleTheme={toggleTheme} onRefresh={refresh} onLogout={handleLogout} />}
    >
      {message && <div className={`alert ${message.type}`}>{message.text}</div>}
      {viewContent[activeView] || viewContent.dashboard}
    </AppLayout>
  )
}
