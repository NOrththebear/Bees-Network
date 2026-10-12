'use client';

import { useState, useEffect, useCallback } from 'react';
import { WALLETS, getAvailableWallets, type WalletType, type WalletInfo } from '@/lib/wallet';

export type { WalletType };

export interface ConnectedWallet {
  type: WalletType;
  address: string;
  lockHash: string;
  publicKey?: string;
  name: string;
  icon: string;
}

export function useWallet() {
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [availableWallets, setAvailableWallets] = useState<WalletType[]>([]);
  const [connecting, setConnecting] = useState<WalletType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAvailableWallets(getAvailableWallets());
    restoreSession();
  }, []);

  const restoreSession = useCallback(async () => {
    try {
      const stored = localStorage.getItem('bees_connected_wallet');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.type && WALLETS[parsed.type as WalletType]) {
          const wallet = WALLETS[parsed.type as WalletType];
          const accounts = await wallet.connect?.();
          if (accounts) {
            setConnectedWallet({
              type: parsed.type as WalletType,
              address: accounts.address,
              lockHash: accounts.lockHash,
              publicKey: accounts.publicKey,
              name: wallet.name,
              icon: wallet.icon,
            });
          } else {
            localStorage.removeItem('bees_connected_wallet');
          }
        }
      }
    } catch {
      localStorage.removeItem('bees_connected_wallet');
    }
  }, []);

  const connect = useCallback(async (type: WalletType) => {
    setConnecting(type);
    setError(null);
    try {
      const wallet = WALLETS[type];
      const result = await wallet.connect();
      if (!result) {
        throw new Error(`Failed to connect to ${wallet.name}`);
      }
      const connected: ConnectedWallet = {
        type,
        address: result.address,
        lockHash: result.lockHash,
        publicKey: result.publicKey,
        name: wallet.name,
        icon: wallet.icon,
      };
      setConnectedWallet(connected);
      localStorage.setItem('bees_connected_wallet', JSON.stringify({
        type,
        address: result.address,
        lockHash: result.lockHash,
        publicKey: result.publicKey,
      }));
      return connected;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setError(message);
      throw err;
    } finally {
      setConnecting(null);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (connectedWallet) {
      const wallet = WALLETS[connectedWallet.type];
      await wallet.disconnect();
      setConnectedWallet(null);
      localStorage.removeItem('bees_connected_wallet');
    }
  }, [connectedWallet]);

  const isConnected = !!connectedWallet;
  const isConnecting = !!connecting;

  return {
    connectedWallet,
    availableWallets,
    connecting,
    isConnected,
    isConnecting,
    error,
    connect,
    disconnect,
    clearError: () => setError(null),
  };
}

export function formatAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatLockHash(lockHash: string): string {
  if (lockHash.length <= 14) return lockHash;
  return `${lockHash.slice(0, 8)}...${lockHash.slice(-4)}`;
}