import { useEffect, useMemo, useState } from 'react'
import { io } from 'socket.io-client'
import {
  Activity,
  Bell,
  CheckCircle2,
  Loader2,
  Mail,
  MessageCircle,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react'
import { api, getState, socketBaseUrl } from './lib/api'

function emptyWatchForm(state) {
  return {
    name: 'Crous search',
    url: 'https://trouverunlogement.lescrous.fr/tools/31/search',
    notifyWhatsApp: true,
    notifyEmail: true,
    whatsappRecipient: state?.settings?.defaultWhatsAppRecipient || state?.settings?.whatsappPhone || '',
    emailRecipient: state?.settings?.defaultEmail || '',
  }
}

export default function App() {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [watchForm, setWatchForm] = useState(null)
  const [manual, setManual] = useState({ phoneNumber: '', email: '', message: 'Bonjour, ceci est un test de notification Crous.' })
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [emailTest, setEmailTest] = useState('')

  const refresh = async () => {
    const next = await getState()
    setState(next)
    setWatchForm((current) => current || emptyWatchForm(next))
    setWhatsappPhone(next.settings?.whatsappPhone || next.whatsapp?.phoneNumber ? `+${next.whatsapp?.phoneNumber}` : '')
    setEmailTest((current) => current || next.settings?.defaultEmail || '')
    setLoading(false)
  }

  useEffect(() => {
    refresh().catch((error) => {
      setMessage({ type: 'error', text: error.message })
      setLoading(false)
    })
    const socket = io(socketBaseUrl(), { withCredentials: true })
    socket.on('state:update', () => refresh().catch(() => undefined))
    socket.on('whatsapp:status', (status) => setState((current) => current ? { ...current, whatsapp: status } : current))
    return () => socket.disconnect()
  }, [])

  const enabledWatches = useMemo(() => state?.watches?.filter((watch) => watch.enabled).length || 0, [state])

  const submitWatch = async (event) => {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      await api.post('/watches', watchForm)
      await refresh()
      setWatchForm(emptyWatchForm(state))
      setMessage({ type: 'success', text: 'Watch created and first check started.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || error.message })
    } finally {
      setSaving(false)
    }
  }

  const deleteWatch = async (id) => {
    await api.delete(`/watches/${id}`)
    await refresh()
  }

  const checkWatch = async (id) => {
    await api.post(`/watches/${id}/check`)
    await refresh()
  }

  const toggleWatch = async (watch) => {
    await api.patch(`/watches/${watch.id}`, { enabled: !watch.enabled })
    await refresh()
  }

  const startWhatsApp = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const response = await api.post('/whatsapp/start', { phoneNumber: whatsappPhone })
      setState((current) => ({ ...current, whatsapp: response.data }))
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || error.message })
    } finally {
      setSaving(false)
    }
  }

  const logoutWhatsApp = async () => {
    const response = await api.post('/whatsapp/logout')
    setState((current) => ({ ...current, whatsapp: response.data }))
  }

  const sendManual = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await api.post('/notifications/manual', manual)
      await refresh()
      setMessage({ type: 'success', text: 'Manual notification sent.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || error.message })
    } finally {
      setSaving(false)
    }
  }

  const sendEmailTest = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await api.post('/email/test', { email: emailTest })
      await refresh()
      setMessage({ type: 'success', text: 'SMTP test email sent.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.message || error.message })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="screen-center"><Loader2 className="spin" /> Loading automation...</div>
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">CA</div>
          <div>
            <h1>Crous Automation</h1>
            <p>automation.al-shifae.ma</p>
          </div>
        </div>
        <nav>
          <a href="#dashboard"><Activity size={18} /> Dashboard</a>
          <a href="#watches"><Bell size={18} /> Watches</a>
          <a href="#whatsapp"><MessageCircle size={18} /> WhatsApp</a>
          <a href="#email"><Mail size={18} /> Email</a>
          <a href="#logs"><RefreshCw size={18} /> Logs</a>
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Crous watcher</p>
            <h2>Housing alerts through WhatsApp and email</h2>
          </div>
          <button className="ghost" onClick={refresh}><RefreshCw size={16} /> Refresh</button>
        </header>

        {message && <div className={`alert ${message.type}`}>{message.text}</div>}

        <section id="dashboard" className="stats-grid">
          <Stat title="Active watches" value={enabledWatches} icon={<Bell />} />
          <Stat title="WhatsApp" value={state.whatsapp?.ready ? 'Connected' : state.whatsapp?.state || 'Disconnected'} icon={<MessageCircle />} />
          <Stat title="SMTP" value={state.smtp?.configured ? 'Configured' : 'Missing'} icon={<Mail />} />
        </section>

        <section id="watches" className="grid two">
          <div className="card">
            <h3><Plus size={18} /> Add Crous watch</h3>
            <form className="form" onSubmit={submitWatch}>
              <label>Name</label>
              <input value={watchForm.name} onChange={(event) => setWatchForm({ ...watchForm, name: event.target.value })} />
              <label>Crous search URL</label>
              <input value={watchForm.url} onChange={(event) => setWatchForm({ ...watchForm, url: event.target.value })} />
              <div className="checks">
                <label><input type="checkbox" checked={watchForm.notifyWhatsApp} onChange={(event) => setWatchForm({ ...watchForm, notifyWhatsApp: event.target.checked })} /> WhatsApp</label>
                <label><input type="checkbox" checked={watchForm.notifyEmail} onChange={(event) => setWatchForm({ ...watchForm, notifyEmail: event.target.checked })} /> Email</label>
              </div>
              <label>WhatsApp recipient</label>
              <input value={watchForm.whatsappRecipient} onChange={(event) => setWatchForm({ ...watchForm, whatsappRecipient: event.target.value })} placeholder="+212600000000" />
              <label>Email recipient</label>
              <input value={watchForm.emailRecipient} onChange={(event) => setWatchForm({ ...watchForm, emailRecipient: event.target.value })} placeholder="student@example.com" />
              <button disabled={saving}><Plus size={16} /> Add watch</button>
            </form>
          </div>

          <div className="card">
            <h3><Bell size={18} /> Active watches</h3>
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
          </div>
        </section>

        <section className="grid two">
          <div id="whatsapp" className="card">
            <h3><QrCode size={18} /> WhatsApp device</h3>
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
          </div>

          <div id="email" className="card">
            <h3><Send size={18} /> Manual notification</h3>
            <label>WhatsApp recipient</label>
            <input value={manual.phoneNumber} onChange={(event) => setManual({ ...manual, phoneNumber: event.target.value })} placeholder="+212600000000" />
            <label>Email recipient</label>
            <input value={manual.email} onChange={(event) => setManual({ ...manual, email: event.target.value })} placeholder="student@example.com" />
            <label>Message</label>
            <textarea value={manual.message} onChange={(event) => setManual({ ...manual, message: event.target.value })} />
            <button onClick={sendManual} disabled={saving}><Send size={16} /> Send message</button>
            <div className="divider" />
            <label>SMTP test email</label>
            <input value={emailTest} onChange={(event) => setEmailTest(event.target.value)} placeholder="student@example.com" />
            <button className="ghost" onClick={sendEmailTest} disabled={saving}><Mail size={16} /> Send SMTP test</button>
          </div>
        </section>

        <section id="logs" className="card">
          <h3><Activity size={18} /> Logs</h3>
          <div className="logs">
            {state.logs?.length ? state.logs.map((log) => (
              <div className={`log ${log.level}`} key={log.id}>
                <span>{new Date(log.createdAt).toLocaleString()}</span>
                <strong>{log.type}</strong>
                <p>{log.message}</p>
              </div>
            )) : <p className="muted">No logs yet.</p>}
          </div>
        </section>
      </main>
    </div>
  )
}

function Stat({ title, value, icon }) {
  return (
    <div className="stat">
      <span>{icon}</span>
      <p>{title}</p>
      <strong>{value}</strong>
    </div>
  )
}

function StatusBadge({ ready, text }) {
  return <div className={`status ${ready ? 'ready' : 'pending'}`}>{text}</div>
}
