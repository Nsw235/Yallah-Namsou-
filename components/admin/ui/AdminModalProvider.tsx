'use client'

import React, { createContext, useContext, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

type ConfirmOptions = { title?: string; description?: string; confirmText?: string; cancelText?: string }

type ConfirmHandler = (opts?: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmHandler | null>(null)

export function AdminModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState<ConfirmOptions>({})
  const [resolver, setResolver] = useState<((v: boolean) => void) | null>(null)

  const showConfirm: ConfirmHandler = (o = {}) => {
    setOpts(o)
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      setResolver(() => resolve)
    })
  }

  function handleClose(result: boolean) {
    setOpen(false)
    if (resolver) resolver(result)
    setResolver(null)
  }

  return (
    <ConfirmContext.Provider value={showConfirm}>
      {children}

      <Dialog.Root open={open} onOpenChange={(v) => { if (!v) handleClose(false) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Dialog.Content className="w-full max-w-md p-6 rounded-lg bg-[var(--card-bg)] shadow-lg">
              <Dialog.Title className="text-lg font-semibold">{opts.title ?? 'Confirmer'}</Dialog.Title>
              {opts.description && <Dialog.Description className="mt-2 text-sm text-[var(--muted)]">{opts.description}</Dialog.Description>}

              <div className="mt-6 flex justify-end gap-3">
                <button className="px-3 py-2 rounded-md bg-transparent text-sm" onClick={() => handleClose(false)}>{opts.cancelText ?? 'Annuler'}</button>
                <button className="px-3 py-2 rounded-md bg-[var(--accent)] text-white text-sm" onClick={() => handleClose(true)}>{opts.confirmText ?? 'Confirmer'}</button>
              </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside AdminModalProvider')
  return ctx
}
