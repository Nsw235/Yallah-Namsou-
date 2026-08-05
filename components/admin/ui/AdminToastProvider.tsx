'use client'

import React from 'react'
import { Toaster } from 'react-hot-toast'

export default function AdminToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
    </>
  )
}
