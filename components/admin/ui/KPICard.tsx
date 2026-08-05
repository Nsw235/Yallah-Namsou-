"use client"

import React from "react";

type Props = {
  title: string;
  value: string | number;
  delta?: string;
  children?: React.ReactNode;
};

export default function KPICard({ title, value, delta, children }: Props) {
  return (
    <div className="p-4 rounded-lg bg-[var(--card-bg)] shadow-sm border border-[rgba(0,0,0,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-[var(--muted)]">{title}</div>
          <div className="mt-1 text-2xl font-semibold">{value}</div>
        </div>
        {delta && (
          <div className="text-sm text-[var(--accent)] font-medium self-start">{delta}</div>
        )}
      </div>

      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
