'use client';

declare global {
  interface Window {
    __TAURI__?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      convertFileSrc: (filePath: string) => string;
    };
    // Tauri v2 injects this (no @tauri-apps/api needed for detection)
    __TAURI_INTERNALS__?: unknown;
    __TAURI_METADATA__?: unknown;
  }
}

export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return !!(
    w.__TAURI_INTERNALS__ ||
    w.__TAURI_METADATA__ ||
    w.__TAURI__
  );
}

export async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error('Not running in Tauri (desktop app required)');
  }
  // Preferred: Tauri v2 official API
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(command, args);
  } catch (v2err) {
    // Fallback: Tauri v1 legacy global (kept for compat)
    if (typeof window !== 'undefined' && window.__TAURI__?.invoke) {
      return window.__TAURI__.invoke(command, args) as Promise<T>;
    }
    throw v2err;
  }
}
