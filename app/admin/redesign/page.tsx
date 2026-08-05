"use client"

import React, { useState } from 'react'
import '../../../styles/admin-tokens.css'
import { AdminTopBar, KPICard } from '../../../components/admin/ui'

export default function Page() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', next)
    }
  }

  return (
    <div className="min-h-screen p-8 admin-shell">
      <AdminTopBar title="Admin Redesign (demo)" username="Admin" onToggleTheme={toggle} />

      <main className="mt-8">
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <KPICard title="Total vehicles" value={1248} delta="+4.2%" />
          <KPICard title="Active drivers" value={342} delta="+1.1%" />
          <KPICard title="Today trips" value={5_412} delta="-0.8%" />
          <KPICard title="Incidents" value={12} delta="+0.0%" />
        </section>

        <section className="mt-8">
          <div className="p-4 rounded-lg bg-[var(--card-bg)] border border-[rgba(0,0,0,0.04)]">
            <h2 className="text-lg font-semibold">Overview</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">This page demonstrates the new admin UI tokens and two basic components (AdminTopBar, KPICard). Replace the existing admin views progressively by swapping in these components.</p>
          </div>
        </section>
      </main>
    </div>
  )
}
