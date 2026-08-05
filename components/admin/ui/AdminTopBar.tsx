"use client"

import React from "react";

type Props = {
  title?: string;
  username?: string;
  onToggleTheme?: () => void;
};

export default function AdminTopBar({ title = "Admin", username, onToggleTheme }: Props) {
  return (
    <header className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-md bg-[var(--accent)] flex items-center justify-center text-white font-semibold">AD</div>
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          {username && <p className="text-sm text-[var(--muted)]">Logged in as {username}</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onToggleTheme}
          className="px-3 py-2 rounded-md bg-transparent border border-transparent hover:bg-[rgba(0,0,0,0.04)]"
          aria-label="Toggle theme"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.36 6.36l-1.41-1.41M7.05 6.05L5.64 4.64m12.02 0l-1.41 1.41M7.05 17.95l-1.41 1.41" />
          </svg>
        </button>

        <div className="flex items-center gap-2">
          <button className="px-3 py-2 rounded-md bg-[var(--card-bg)] border border-[rgba(0,0,0,0.04)] shadow-sm text-sm">New</button>
          <div className="text-sm text-[var(--muted)]">{new Date().toLocaleDateString()}</div>
        </div>
      </div>
    </header>
  );
}
