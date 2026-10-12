'use client';

import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui';
import { Toggle } from '@/components/ui';
import { useState, useEffect } from 'react';

const RocketIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.484 16.886a.5.5 0 01-.14-.88l8-10a.5.5 0 01.882.14l4.111 4.11a.5.5 0 01-.14.88l-1.57 1.571a4.5 4.5 0 01-6.364 0l-1.57-1.57a.5.5 0 01-.14-.88z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 12v8m0-8h8m-8 0l3-3m-3 3l-3 3m0-8v8m0 0l3-3m-3 3l-3-3" />
  </svg>
);

const RefreshIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const NotificationsIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
);

const AnalyticsIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

export default function AppSettings() {
  const [autoStart, setAutoStart] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    setAutoStart(localStorage.getItem('bees_auto_start') === 'true');
    setAutoUpdate(localStorage.getItem('bees_auto_update') !== 'false');
    setNotifications(localStorage.getItem('bees_notifications') !== 'false');
    setAnalytics(localStorage.getItem('bees_analytics') === 'true');
  }, []);

  const handleAutoStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setAutoStart(checked);
    localStorage.setItem('bees_auto_start', checked.toString());
  };

  const handleAutoUpdateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setAutoUpdate(checked);
    localStorage.setItem('bees_auto_update', checked.toString());
  };

  const handleNotificationsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setNotifications(checked);
    localStorage.setItem('bees_notifications', checked.toString());
  };

  const handleAnalyticsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setAnalytics(checked);
    localStorage.setItem('bees_analytics', checked.toString());
  };

  return (
    <div className="min-h-screen bg-[var(--surface)] pt-16 pb-24 px-4 safe-area-top safe-area-bottom">
      <Header
        title="App Settings"
        showBack
        backHref="/account"
      />

      <main className="max-w-md mx-auto space-y-4 pt-4 pb-8">
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <RocketIcon />
              </span>
              <span className="font-medium text-[var(--color-text)]">Enable Auto Start</span>
            </div>
            <Toggle checked={autoStart} onChange={handleAutoStartChange} />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <RefreshIcon />
              </span>
              <span className="font-medium text-[var(--color-text)]">Enable Auto Update</span>
            </div>
            <Toggle checked={autoUpdate} onChange={handleAutoUpdateChange} />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <NotificationsIcon />
              </span>
              <span className="font-medium text-[var(--color-text)]">Push Notifications</span>
            </div>
            <Toggle checked={notifications} onChange={handleNotificationsChange} />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <AnalyticsIcon />
              </span>
              <span className="font-medium text-[var(--color-text)]">Usage Analytics</span>
            </div>
            <Toggle checked={analytics} onChange={handleAnalyticsChange} />
          </div>
        </Card>
      </main>
    </div>
  );
}