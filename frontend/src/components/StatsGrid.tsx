'use client';

import { BRAND } from '@/lib/config';

interface Stat {
  label: string;
  value: string | number;
  subValue: string;
  icon: 'nodes' | 'epochs' | 'shares' | 'pool' | 'requests' | 'data';
}

const Icons = {
  requests: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  data: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  ),
  nodes: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  epochs: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  shares: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  pool: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

const IconColors = {
  nodes: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  epochs: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  shares: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
  pool: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
  requests: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400',
  data: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
};

export function StatsGrid({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {stats.map((stat, i) => (
        <div key={i} className="card group">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text-muted)]">{stat.label}</p>
              <p className="text-3xl font-bold text-[var(--text)] mt-1">{stat.value}</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">{stat.subValue}</p>
            </div>
            <div className={`p-3 rounded-xl ${IconColors[stat.icon]} group-hover:scale-110 transition-transform`}>
              {Icons[stat.icon]}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}