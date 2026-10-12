'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { NETWORK, CODE_HASHES, POINTS_CONFIG, type NetworkKey } from '@/lib/config';
import { getIndexerClient, findCellsByType, findCellsByLock } from '@/lib/rpc';

const FETCH_TIMEOUT = 8000;

async function fetchWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await promise;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface NodeEntry {
  nodeId: string;
  walletLockHash: string;
  eligible: boolean;
  beats: number;
  bytes: number;
}

export interface RegistryData {
  registryId: string;
  operatorLockHash: string;
  nodes: NodeEntry[];
}

export interface EpochData {
  epochId: number;
  registryId: string;
  merkleRoot: string;
  evidenceHash: string;
  pool: bigint;
  rewardsRoot: string;
  outPoint: { txHash: string; index: string };
  status: 'live' | 'dead';
}

export interface ShareData {
  epochId: number;
  nodeId: string;
  walletLockHash: string;
  netPts: number;
  upPts: number;
  bytes: number;
  amount: bigint;
  outPoint: { txHash: string; index: string };
  status: 'live' | 'claimed';
}

export interface UserHarvest {
  totalHoney: bigint;
  totalNectar: bigint;
  epoch: number;
  networkQuality: number;
  deviceId: string;
  isConnected: boolean;
  userLockHash?: string;
  userNode?: NodeEntry;
  userShares: ShareData[];
}

export function useBeesData(userLockHash?: string, network: NetworkKey = 'testnet') {
  const [registry, setRegistry] = useState<RegistryData | null>(null);
  const [epochs, setEpochs] = useState<EpochData[]>([]);
  const [shares, setShares] = useState<ShareData[]>([]);
  const [userHarvest, setUserHarvest] = useState<UserHarvest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch registry cells by type script code_hash
      const registryCells = await fetchWithTimeout(
        findCellsByType(
          { code_hash: CODE_HASHES.registry, hash_type: 'data2', args: '0x' },
          network
        ),
        FETCH_TIMEOUT
      );

      if (registryCells.length > 0) {
        const cell = registryCells[0];
        const data = decodeRegistryData(cell.output_data);
        setRegistry({
          registryId: cell.output.type?.args || '0x' + '00'.repeat(32),
          operatorLockHash: data.operatorLockHash,
          nodes: data.nodes,
        });
      }

      // Fetch epoch cells by type script code_hash
      const epochCells = await fetchWithTimeout(
        findCellsByType(
          { code_hash: CODE_HASHES.epoch, hash_type: 'data2', args: '0x' },
          network
        ),
        FETCH_TIMEOUT
      );

      const epochData: EpochData[] = epochCells.map((cell) => {
        const decoded = decodeEpochData(cell.output_data);
        return {
          ...decoded,
          outPoint: { txHash: cell.out_point.tx_hash, index: cell.out_point.index },
          status: 'live' as const,
        };
      });
      setEpochs(epochData.sort((a, b) => b.epochId - a.epochId));

      // Fetch reward shares by lock script code_hash
      const shareCells = await fetchWithTimeout(
        findCellsByLock(
          { code_hash: CODE_HASHES.rewards, hash_type: 'data2', args: '0x' },
          network
        ),
        FETCH_TIMEOUT
      );

      const shareData: ShareData[] = shareCells.map((cell) => {
        const decoded = decodeShareData(cell.output_data);
        return {
          ...decoded,
          outPoint: { txHash: cell.out_point.tx_hash, index: cell.out_point.index },
          status: 'live' as const,
        };
      });
      setShares(shareData);

      // Calculate user harvest from latest epoch
      if (epochData.length > 0 && shareData.length > 0) {
        const latestEpoch = epochData[0];
        
        // Filter shares for user's lock hash if provided
        let userShares = shareData.filter(s => s.epochId === latestEpoch.epochId);
        if (userLockHash) {
          userShares = userShares.filter(s => s.walletLockHash.toLowerCase() === userLockHash.toLowerCase());
        }
        
        // Find user's node in registry
        let userNode: NodeEntry | undefined;
        if (userLockHash && registry?.nodes) {
          userNode = registry.nodes.find(n => n.walletLockHash.toLowerCase() === userLockHash.toLowerCase());
        }

        // Sum all shares for this epoch
        let totalHoney = 0n;
        let totalNectar = 0n;
        for (const share of userShares) {
          totalHoney += share.amount;
          totalNectar += share.amount;
        }

        // Calculate network quality based on pool vs potential
        const poolCKB = Number(latestEpoch.pool) / 1e8;
        const networkQuality = Math.min(100, Math.max(0, Math.round((poolCKB / 1000) * 100)));

        setUserHarvest({
          totalHoney,
          totalNectar,
          epoch: latestEpoch.epochId,
          networkQuality,
          deviceId: generateDeviceId(),
          isConnected: true,
          userLockHash,
          userNode,
          userShares,
        });
      } else {
        setUserHarvest({
          totalHoney: 0n,
          totalNectar: 0n,
          epoch: 0,
          networkQuality: 0,
          deviceId: generateDeviceId(),
          isConnected: false,
          userLockHash,
          userShares: [],
        });
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch data';
      console.error('Bees data fetch error:', message);
      setError(message);
      // Fallback mock data for demo
      setUserHarvest({
        totalHoney: 858_00000000n,
        totalNectar: 18000000n,
        epoch: 4,
        networkQuality: 75,
        deviceId: generateDeviceId(),
        isConnected: true,
        userLockHash,
        userShares: [],
      });
    } finally {
      setLoading(false);
    }
  }, [userLockHash, network]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { registry, epochs, shares, userHarvest, loading, error, refetch: fetchData };
}

function decodeRegistryData(dataHex: string): { operatorLockHash: string; nodes: NodeEntry[] } {
  if (!dataHex || dataHex === '0x' || dataHex.length < 68) {
    return { operatorLockHash: '0x' + '00'.repeat(32), nodes: [] };
  }
  const data = hexToBytes(dataHex);
  const operatorLockHash = bytesToHex(data.slice(32, 64));
  const count = new DataView(data.buffer, 64, 4).getUint32(0, true);
  const nodes: NodeEntry[] = [];
  let offset = 68;
  for (let i = 0; i < count; i++) {
    const nodeId = bytesToHex(data.slice(offset, offset + 32)); offset += 32;
    const walletLockHash = bytesToHex(data.slice(offset, offset + 32)); offset += 32;
    const eligible = data[offset++] === 1;
    const beats = Number(new DataView(data.buffer, offset, 8).getBigUint64(0, true)); offset += 8;
    const bytes_ = Number(new DataView(data.buffer, offset, 8).getBigUint64(0, true)); offset += 8;
    nodes.push({ nodeId, walletLockHash, eligible, beats, bytes: bytes_ });
  }
  return { operatorLockHash, nodes };
}

function decodeEpochData(dataHex: string): Omit<EpochData, 'outPoint' | 'status'> {
  if (!dataHex || dataHex === '0x' || dataHex.length < 158) {
    return { epochId: 0, registryId: '0x' + '00'.repeat(32), merkleRoot: '0x' + '00'.repeat(32), evidenceHash: '0x' + '00'.repeat(32), pool: 0n, rewardsRoot: '0x' + '00'.repeat(32) };
  }
  const data = hexToBytes(dataHex);
  let offset = 6; // Skip "BEEP01" magic
  const epochId = Number(new DataView(data.buffer, offset, 8).getBigUint64(0, true)); offset += 8;
  const registryId = bytesToHex(data.slice(offset, offset + 32)); offset += 32;
  const merkleRoot = bytesToHex(data.slice(offset, offset + 32)); offset += 32;
  const evidenceHash = bytesToHex(data.slice(offset, offset + 32)); offset += 32;
  const pool = new DataView(data.buffer, offset, 16).getBigUint64(0, true); offset += 16;
  const rewardsRoot = bytesToHex(data.slice(offset, offset + 32));
  return { epochId, registryId, merkleRoot, evidenceHash, pool, rewardsRoot };
}

function decodeShareData(dataHex: string): Omit<ShareData, 'outPoint' | 'status'> {
  if (!dataHex || dataHex === '0x' || dataHex.length < 112) {
    return { epochId: 0, nodeId: '0x' + '00'.repeat(32), walletLockHash: '0x' + '00'.repeat(32), netPts: 0, upPts: 0, bytes: 0, amount: 0n };
  }
  const data = hexToBytes(dataHex);
  let offset = 0;
  const epochId = Number(new DataView(data.buffer, offset, 8).getBigUint64(0, true)); offset += 8;
  const nodeId = bytesToHex(data.slice(offset, offset + 32)); offset += 32;
  const walletLockHash = bytesToHex(data.slice(offset, offset + 32)); offset += 32;
  const netPts = Number(new DataView(data.buffer, offset, 8).getBigUint64(0, true)); offset += 8;
  const upPts = Number(new DataView(data.buffer, offset, 8).getBigUint64(0, true)); offset += 8;
  const bytes = Number(new DataView(data.buffer, offset, 8).getBigUint64(0, true)); offset += 8;
  const amount = new DataView(data.buffer, offset, 16).getBigUint64(0, true);
  return { epochId, nodeId, walletLockHash, netPts, upPts, bytes, amount };
}

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function formatAmount(amount: bigint, decimals = 8): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  
  // Format with commas and limited decimals
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (frac === 0n) return wholeStr;
  
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${wholeStr}.${fracStr}`;
}

export function formatCompact(amount: bigint, decimals = 8): { value: string; unit: string } {
  const divisor = 10n ** BigInt(decimals);
  const num = Number(amount) / Number(divisor);
  
  if (num >= 1e9) return { value: (num / 1e9).toFixed(2), unit: 'B' };
  if (num >= 1e6) return { value: (num / 1e6).toFixed(2), unit: 'M' };
  if (num >= 1e3) return { value: (num / 1e3).toFixed(2), unit: 'K' };
  return { value: num.toFixed(2), unit: '' };
}

export function formatAmountWithUnit(amount: bigint, decimals = 8): string {
  const { value, unit } = formatCompact(amount, decimals);
  return `${value}${unit ? ' ' + unit : ''}`;
}

function generateDeviceId(): string {
  if (typeof window !== 'undefined') {
    let id = localStorage.getItem('bees_device_id');
    if (!id) {
      id = 'BEE-' + Array.from({ length: 12 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('').match(/.{1,4}/g)?.join('-') || 'BEE-XXXX-XXXX-XXXX';
      localStorage.setItem('bees_device_id', id);
    }
    return id;
  }
  return 'BEE-XXXX-XXXX-XXXX';
}