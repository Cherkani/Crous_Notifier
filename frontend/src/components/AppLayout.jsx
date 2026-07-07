import React, { useMemo, useState } from 'react'
import {
  Activity,
  Bell,
  ChevronLeft,
  ChevronRight,
  Mail,
  MessageCircle,
  Moon,
  RefreshCw,
  Settings,
  ShieldAlert,
  Sun,
} from 'lucide-react'

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'watches', label: 'Crous search', icon: Bell },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'messages', label: 'Tests', icon: Mail },
  { id: 'monitoring', label: 'Monitoring', icon: ShieldAlert },
  { id: 'logs', label: 'Logs', icon: RefreshCw },
  { id: 'configuration', label: 'Configuration', icon: Settings },
]

export function AppLayout({ sidebarOpen, onToggleSidebar, activeView, onViewChange, topbar, children }) {
  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      <Sidebar open={sidebarOpen} activeView={activeView} onViewChange={onViewChange} onToggle={onToggleSidebar} />
      <div className="workbench">
        {topbar}
        <main className="content-stack">{children}</main>
      </div>
    </div>
  )
}

function Sidebar({ open, activeView, onViewChange, onToggle }) {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar-brand">
        <div className="brand-mark">CA</div>
        {open && (
          <div>
            <strong>Crous Automation</strong>
            <span>critical monitor</span>
          </div>
        )}
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              className={`nav-item ${activeView === item.id ? 'active' : ''}`}
              type="button"
              onClick={() => onViewChange(item.id)}
              aria-label={item.label}
              title={item.label}
              key={item.id}
            >
              <Icon size={20} />
              {open && <span>{item.label}</span>}
            </button>
          )
        })}
      </nav>

      <button className="sidebar-toggle" onClick={onToggle} aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}>
        {open ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>
    </aside>
  )
}

export function Topbar({ whatsappReady, smtpReady, theme, onToggleTheme, onRefresh, onLogout }) {
  return (
    <header className="topbar">
      <div className="topbar-glow" aria-hidden="true" />
      <div className="topbar-main">
        <div className="topbar-icon">
          <Bell size={22} />
        </div>
        <div className="topbar-copy-block">
          <p className="eyebrow">Crous watcher</p>
          <h1>Salma’s Crous Watch</h1>
          <p className="topbar-copy">A gentle but vigilant monitor for Crous housing, WhatsApp alerts, and operational safety.</p>
        </div>
      </div>
      <div className="topbar-illustration" aria-hidden="true">
        <div className="crous-skyline">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="cyber-art-girl">
          <span className="girl-head" />
          <span className="girl-hair" />
          <span className="girl-beret" />
          <span className="girl-glasses" />
          <span className="girl-hoodie" />
          <span className="girl-arm brush-arm" />
          <span className="girl-arm laptop-arm" />
          <span className="girl-laptop" />
          <span className="girl-palette" />
          <span className="girl-brush" />
        </div>
        <div className="cyber-card">
          <span />
          <span />
        </div>
        <div className="paint-bubble"><span /></div>
        <div className="code-spark code-one">&lt;/&gt;</div>
        <div className="code-spark code-two">✦</div>
      </div>
      <div className="topbar-actions">
        <div className="status-cluster" aria-label="System status">
          <span className={`system-pill ${whatsappReady ? 'ready' : 'pending'}`}>
            <i />
            WhatsApp
          </span>
          <span className={`system-pill ${smtpReady ? 'ready' : 'pending'}`}>
            <i />
            SMTP
          </span>
        </div>
        <button className="theme-toggle" type="button" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
        <button className="ghost topbar-button" onClick={onRefresh}><RefreshCw size={16} /> Refresh</button>
        <button className="ghost topbar-button" onClick={onLogout}>Log out</button>
      </div>
    </header>
  )
}

export function ConfigPanel({ state, settingsDraft, setSettingsDraft, onSave, saving }) {
  const [activeTab, setActiveTab] = useState('receivers')
  const schedule = state?.schedule || {}
  const minutes = (value) => Math.round((Number(value || 0) / 60000) * 10) / 10
  const envCheckMinutes = minutes(schedule.scrapeIntervalMs || 60000)
  const envNoResultMinutes = minutes(schedule.noResultWhatsAppIntervalMs || 1800000)
  const effectiveCheckMinutes = Number(settingsDraft.scrapeIntervalMinutes || 0) || envCheckMinutes
  const effectiveNoResultMinutes = Number(settingsDraft.noResultWhatsAppIntervalMinutes || 0) || envNoResultMinutes
  const scheduleSource = schedule.source === 'configuration' ? 'saved configuration' : 'backend env default'
  const previewItems = '- Studio proche campus\n  Prix: 450 €\n  Résidence Crous exemple\n  https://trouverunlogement.lescrous.fr/accommodations/12345'
  const previewMessage = useMemo(() => String(settingsDraft.notificationTemplate || '')
    .replaceAll('{items}', previewItems)
    .replaceAll('{url}', state?.watches?.[0]?.url || 'https://trouverunlogement.lescrous.fr/search?bounds=...')
    .replaceAll('{watchName}', state?.watches?.[0]?.name || 'Crous search')
    .replaceAll('{count}', '1'), [settingsDraft.notificationTemplate, state?.watches])

  return (
    <aside className="config-panel" aria-label="System configuration">
      <div className="panel-heading">
        <span><Settings size={18} /></span>
        <div>
          <p className="eyebrow">Configuration</p>
          <h2>Senders and receivers</h2>
          <p className="panel-copy">Edit only notification numbers and emails here. The Crous search stays configured in the Crous search sidebar.</p>
        </div>
      </div>

      <div className="tab-switch" role="tablist" aria-label="Configuration sections">
        {[
          ['receivers', 'Receivers'],
          ['timing', 'Timing'],
          ['preview', 'Preview'],
        ].map(([id, label]) => (
          <button type="button" className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)} key={id}>{label}</button>
        ))}
      </div>

      {activeTab === 'receivers' && (
        <>
          <div className="config-section">
            <div className="sender-grid">
              <div>
                <label>WhatsApp sender</label>
                <strong>{state?.whatsapp?.phoneNumber ? `+${state.whatsapp.phoneNumber}` : state?.settings?.whatsappPhone || 'Pair WhatsApp device first'}</strong>
                <small>One connected sender device sends to all WhatsApp receivers.</small>
              </div>
              <div>
                <label>Email sender</label>
                <strong>{state?.smtp?.from || 'SMTP sender missing'}</strong>
                <small>Email always sends from the configured SMTP account.</small>
              </div>
            </div>
          </div>

          <div className="config-section">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={Boolean(settingsDraft.operationalAlertsEnabled)}
                onChange={(event) => setSettingsDraft({ ...settingsDraft, operationalAlertsEnabled: event.target.checked })}
              />
              <span>Email me on crashes and critical errors</span>
            </label>
            <label>Monitoring email receiver(s)</label>
            <input
              value={settingsDraft.operationalAlertEmail || ''}
              onChange={(event) => setSettingsDraft({ ...settingsDraft, operationalAlertEmail: event.target.value })}
              placeholder="admin@example.com, ops@example.com"
            />
          </div>

          <div className="config-section">
            <label>Default email receiver(s)</label>
            <textarea
              className="compact-textarea"
              value={settingsDraft.defaultEmail || ''}
              onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultEmail: event.target.value })}
              placeholder={'student@example.com\nparent@example.com'}
            />
            <label>Default WhatsApp receiver number(s)</label>
            <textarea
              className="compact-textarea"
              value={settingsDraft.defaultWhatsAppRecipient || ''}
              onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultWhatsAppRecipient: event.target.value })}
              placeholder={'+212600000000\n+212688505361'}
            />
            <small className="config-help">Add multiple receivers with commas or one per line. The sender stays the connected WhatsApp device / SMTP account.</small>
          </div>
        </>
      )}

      {activeTab === 'timing' && (
        <div className="config-section">
          <div className="schedule-grid">
            <div>
              <label>Check Crous every</label>
              <input
                type="number"
                min="1"
                step="1"
                value={settingsDraft.scrapeIntervalMinutes}
                onChange={(event) => setSettingsDraft({ ...settingsDraft, scrapeIntervalMinutes: event.target.value })}
                placeholder={String(envCheckMinutes)}
              />
              <small>
                The watcher executes one full Crous check every {effectiveCheckMinutes} minute(s), based on the {scheduleSource}.
                Leave empty to use env default: {envCheckMinutes} minute(s).
              </small>
            </div>
            <div>
              <label>WhatsApp no-result update</label>
              <input
                type="number"
                min="1"
                step="1"
                value={settingsDraft.noResultWhatsAppIntervalMinutes}
                onChange={(event) => setSettingsDraft({ ...settingsDraft, noResultWhatsAppIntervalMinutes: event.target.value })}
                placeholder={String(envNoResultMinutes)}
              />
              <small>
                If a check finds no housing, WhatsApp can send “not yet anything” updates every {effectiveNoResultMinutes} minute(s).
                New housing alerts are sent as soon as a check detects them.
              </small>
            </div>
            <div>
              <label>Email sending rule</label>
              <select
                value={settingsDraft.noResultEmailEnabled ? 'all' : 'important'}
                onChange={(event) => setSettingsDraft({ ...settingsDraft, noResultEmailEnabled: event.target.value === 'all' })}
              >
                <option value="important">Found housing + issue/error only</option>
                <option value="all">Also send no-result updates</option>
              </select>
              <small>
                {settingsDraft.noResultEmailEnabled
                  ? 'Email will also send normal no-result updates.'
                  : 'Email sends found housing alerts plus required monitoring logs for crashes, scrape issues, and critical errors. It will not send normal no-result checks.'}
              </small>
            </div>
          </div>
          <p className="config-help">
            Saved timing values apply immediately and are kept in the database. Current effective plan: check Crous every {effectiveCheckMinutes} minute(s);
            WhatsApp no-result heartbeat every {effectiveNoResultMinutes} minute(s); email for found housing and monitoring issues.
          </p>
        </div>
      )}

      {activeTab === 'preview' && (
        <>
          <div className="config-section">
            <label>Notification template</label>
            <textarea
              value={settingsDraft.notificationTemplate || ''}
              onChange={(event) => setSettingsDraft({ ...settingsDraft, notificationTemplate: event.target.value })}
            />
            <small className="config-help">Available variables: {'{items}'}, {'{url}'}, {'{watchName}'}, {'{count}'}.</small>
          </div>
          <div className="config-section">
            <label>Preview message</label>
            <pre className="message-preview">{previewMessage}</pre>
          </div>
        </>
      )}

      <button onClick={onSave} disabled={saving}><ShieldAlert size={16} /> Save configuration</button>

      <div className="config-health">
        <strong>Capture status</strong>
        <span>{state?.smtp?.configured ? 'SMTP ready' : 'SMTP missing'}</span>
        <span>{state?.settings?.operationalAlertsEnabled ? 'Operational alerts enabled' : 'Operational alerts paused'}</span>
      </div>
    </aside>
  )
}
