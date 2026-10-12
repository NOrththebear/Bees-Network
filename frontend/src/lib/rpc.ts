import { NETWORK, type NetworkKey } from './config';

export interface RpcClient {
  rpc(method: string, params: unknown[], opts?: RpcCallOptions): Promise<unknown>;
  getTipHeader(opts?: RpcCallOptions): Promise<{ number: string; hash: string; timestamp: string }>;
  getCells(searchKey: SearchKey, order: 'asc' | 'desc', limit: string, after?: string, opts?: RpcCallOptions): Promise<{ objects: CellObject[]; last_cursor: string }>;
  getLiveCell(outPoint: OutPoint, withData: boolean, opts?: RpcCallOptions): Promise<{ cell: CellOutput | null; cell_output: CellOutput | null; data: string }>;
}

export interface SearchKey {
  script: Script;
  script_type: 'lock' | 'type';
  filter?: {
    script?: Script;
    output_data_len_range?: [string, string];
    block_range?: [string, string];
  };
}

export interface Script {
  code_hash: string;
  hash_type: 'data' | 'data1' | 'data2' | 'type';
  args: string;
}

export interface OutPoint {
  tx_hash: string;
  index: string;
}

export interface CellOutput {
  capacity: string;
  lock: Script;
  type?: Script | null;
}

export interface CellObject {
  out_point: OutPoint;
  output: CellOutput;
  output_data: string;
  block_number: string;
  tx_index: string;
}

export interface RpcCallOptions {
  signal?: AbortSignal;
}

function createRpcClient(baseUrl: string): RpcClient {
  const idCounter = { current: 1 };
  return {
    async rpc(method: string, params: unknown[], opts?: RpcCallOptions) {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: idCounter.current++,
          jsonrpc: '2.0',
          method,
          params,
        }),
        signal: opts?.signal,
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
      return json.result;
    },
    async getTipHeader(opts?: RpcCallOptions) {
      return this.rpc('get_tip_header', [], opts) as Promise<{ number: string; hash: string; timestamp: string }>;
    },
    async getCells(searchKey: SearchKey, order: 'asc' | 'desc', limit: string, after?: string, opts?: RpcCallOptions) {
      return this.rpc('get_cells', [searchKey, order, limit, after], opts) as Promise<{ objects: CellObject[]; last_cursor: string }>;
    },
    async getLiveCell(outPoint: OutPoint, withData: boolean, opts?: RpcCallOptions) {
      return this.rpc('get_live_cell', [outPoint, withData], opts) as Promise<{ cell: CellOutput | null; cell_output: CellOutput | null; data: string }>;
    },
  };
}

export function getRpcClient(network: NetworkKey = 'testnet'): RpcClient {
  return createRpcClient(NETWORK[network].rpc);
}

export function getIndexerClient(network: NetworkKey = 'testnet'): RpcClient {
  return createRpcClient(NETWORK[network].indexer);
}

/** Find cells by type script (uses indexer) */
export async function findCellsByType(
  typeScript: Script,
  network: NetworkKey = 'testnet',
  limit = '0x64',
  opts?: RpcCallOptions
): Promise<CellObject[]> {
  const client = getIndexerClient(network);
  const res = await client.getCells(
    { script: typeScript, script_type: 'type' },
    'desc',
    limit,
    undefined,
    opts
  );
  return res.objects;
}

/** Find cells by lock script */
export async function findCellsByLock(
  lockScript: Script,
  network: NetworkKey = 'testnet',
  limit = '0x64',
  opts?: RpcCallOptions
): Promise<CellObject[]> {
  const client = getIndexerClient(network);
  const res = await client.getCells(
    { script: lockScript, script_type: 'lock' },
    'desc',
    limit,
    undefined,
    opts
  );
  return res.objects;
}

/** Get live cell with data */
export async function getLiveCell(
  outPoint: OutPoint,
  network: NetworkKey = 'testnet',
  opts?: RpcCallOptions
): Promise<{ cell: CellOutput | null; data: string }> {
  const client = getRpcClient(network);
  const res = await client.getLiveCell(outPoint, true, opts);
  return {
    cell: res.cell_output,
    data: res.data,
  };
}