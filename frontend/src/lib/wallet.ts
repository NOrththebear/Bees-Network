import { blake2b } from '@noble/hashes/blake2.js';

export interface WalletInfo {
  name: string;
  icon: string;
  connect: () => Promise<{ address: string; lockHash: string; publicKey?: string } | null>;
  disconnect: () => Promise<void>;
  isInstalled: () => boolean;
}

export type WalletType = 'unisat' | 'joyid' | 'okx' | 'dotbit' | 'crypton' | 'identity';

export const WALLETS: Record<WalletType, WalletInfo> = {
  unisat: {
    name: 'UniSat',
    icon: '🦄',
    isInstalled: () => typeof window !== 'undefined' && !!window.unisat,
    connect: async () => {
      if (typeof window === 'undefined' || !window.unisat) return null;
      await window.unisat.connect();
      const accounts = await window.unisat.getAccounts();
      if (accounts.length === 0) return null;
      const address = accounts[0];
      const publicKey = await window.unisat.getPublicKey();
      const lockHash = addressToLockHash(address);
      return { address, lockHash, publicKey };
    },
    disconnect: async () => {
      if (typeof window !== 'undefined' && window.unisat) {
        await window.unisat.disconnect();
      }
    },
  },
  joyid: {
    name: 'JoyID',
    icon: '😊',
    isInstalled: () => typeof window !== 'undefined' && !!window.joyid,
    connect: async () => {
      if (typeof window === 'undefined' || !window.joyid) return null;
      const result = await window.joyid.connect();
      if (!result || !result.address) return null;
      const lockHash = addressToLockHash(result.address);
      return { address: result.address, lockHash, publicKey: result.pubkey };
    },
    disconnect: async () => {
      if (typeof window !== 'undefined' && window.joyid) {
        await window.joyid.disconnect();
      }
    },
  },
  okx: {
    name: 'OKX Wallet',
    icon: '🔷',
    isInstalled: () => typeof window !== 'undefined' && !!window.okxwallet,
    connect: async () => {
      if (typeof window === 'undefined' || !window.okxwallet) return null;
      await window.okxwallet.connect();
      const accounts = await window.okxwallet.getAccounts();
      if (accounts.length === 0) return null;
      const address = accounts[0];
      const publicKey = await window.okxwallet.getPublicKey();
      const lockHash = addressToLockHash(address);
      return { address, lockHash, publicKey };
    },
    disconnect: async () => {
      if (typeof window !== 'undefined' && window.okxwallet) {
        await window.okxwallet.disconnect();
      }
    },
  },
  dotbit: {
    name: '.bit',
    icon: '🌐',
    isInstalled: () => typeof window !== 'undefined' && !!window.dotbit,
    connect: async () => {
      if (typeof window === 'undefined' || !window.dotbit) return null;
      await window.dotbit.connect();
      const accounts = await window.dotbit.getAccounts();
      if (accounts.length === 0) return null;
      const address = accounts[0];
      const lockHash = addressToLockHash(address);
      return { address, lockHash };
    },
    disconnect: async () => {
      if (typeof window !== 'undefined' && window.dotbit) {
        await window.dotbit.disconnect();
      }
    },
  },
  crypton: {
    name: 'Crypton',
    icon: '🔐',
    isInstalled: () => typeof window !== 'undefined' && !!window.crypton,
    connect: async () => {
      if (typeof window === 'undefined' || !window.crypton) return null;
      await window.crypton.connect();
      const accounts = await window.crypton.getAccounts();
      if (accounts.length === 0) return null;
      const address = accounts[0];
      const lockHash = addressToLockHash(address);
      return { address, lockHash };
    },
    disconnect: async () => {
      if (typeof window !== 'undefined' && window.crypton) {
        await window.crypton.disconnect();
      }
    },
  },
  identity: {
    name: 'Nervos Identity',
    icon: '🆔',
    isInstalled: () => typeof window !== 'undefined' && !!window.identity,
    connect: async () => {
      if (typeof window === 'undefined' || !window.identity) return null;
      await window.identity.connect();
      const accounts = await window.identity.getAccounts();
      if (accounts.length === 0) return null;
      const address = accounts[0];
      const lockHash = addressToLockHash(address);
      return { address, lockHash };
    },
    disconnect: async () => {
      if (typeof window !== 'undefined' && window.identity) {
        await window.identity.disconnect();
      }
    },
  },
};

function addressToLockHash(address: string): string {
  try {
    const clean = address.startsWith('ckb') ? address.slice(3) : address;
    const decoded = bech32Decode(clean);
    const args = decoded.data.slice(1);
    const hash = blake2b(new Uint8Array(args), { dkLen: 32 });
    return '0x' + Buffer.from(hash).toString('hex');
  } catch {
    return '0x' + '00'.repeat(32);
  }
}

function bech32Decode(str: string): { prefix: string; data: number[] } {
  const charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const parts = str.split('1');
  const prefix = parts[0];
  const dataStr = parts[1];
  const data: number[] = [];
  for (const char of dataStr) {
    const idx = charset.indexOf(char);
    if (idx === -1) throw new Error('Invalid bech32 char');
    data.push(idx);
  }
  return { prefix, data };
}

export function getAvailableWallets(): WalletType[] {
  return Object.entries(WALLETS)
    .filter(([, wallet]) => wallet.isInstalled())
    .map(([type]) => type as WalletType);
}

export function getWallet(type: WalletType): WalletInfo {
  return WALLETS[type];
}

declare global {
  interface Window {
    unisat?: any;
    joyid?: any;
    okxwallet?: any;
    dotbit?: any;
    crypton?: any;
    identity?: any;
  }
}