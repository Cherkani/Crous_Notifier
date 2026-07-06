import React from 'react'

export function Card({ id, title, icon, children, className = '' }) {
  return (
    <section id={id} className={`card ${className}`}>
      {title && <h3>{icon}{title}</h3>}
      {children}
    </section>
  )
}

export function StatCard({ title, value, icon, tone = 'default' }) {
  return (
    <div className={`stat ${tone}`}>
      <span>{icon}</span>
      <p>{title}</p>
      <strong>{value}</strong>
    </div>
  )
}

export function StatusBadge({ ready, text }) {
  return <div className={`status ${ready ? 'ready' : 'pending'}`}>{text}</div>
}

