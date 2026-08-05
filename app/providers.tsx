'use client'

import React from 'react'
import AdminToastProvider from '@/components/admin/ui/AdminToastProvider'
import { AdminModalProvider } from '@/components/admin/ui/AdminModalProvider'

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AdminToastProvider>
      <AdminModalProvider>{children}</AdminModalProvider>
    </AdminToastProvider>
  )
}
