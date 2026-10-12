export const NETWORK = {
  testnet: {
    name: 'Pudge Testnet',
    rpc: 'https://testnet.ckb.dev',
    indexer: 'https://testnet.ckb.dev/indexer',
    explorer: 'https://pudge.explorer.nervos.org',
    faucet: 'https://faucet.nervos.org',
  },
  devnet: {
    name: 'Local Devnet',
    rpc: 'http://127.0.0.1:8114',
    indexer: 'http://127.0.0.1:8116',
    explorer: '',
    faucet: '',
  },
} as const;

export type NetworkKey = keyof typeof NETWORK;

// Contract code hashes (v0.1 audited binaries)
export const CODE_HASHES = {
  registry: '0x1ceea29bd9a625ccd2f7ba852a9fd98c0363c668e6fa76ca9ad054482e2fafd8',
  epoch: '0x36074a1c44e9c6b6d741c0934a905cbbaeb6f0b12cb69513b91ccefd586786e1',
  rewards: '0xa717298157262884a0e4e70a50c17486ad264554cadaca20efa8a90086f2cd84',
  alwaysSuccess: '0xf9f720d4042162130a856dcd8a7c626f5bf5c4b5f11cce2b81f5536b9fe52463',
  xudt: '0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95',
} as const;

// Known lock scripts (testnet)
export const LOCKS = {
  secp256k1: {
    codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
    hashType: 'type' as const,
  },
  operator: {
    codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
    hashType: 'type' as const,
    args: '0x8e42b1999f265a0078503c4acec4d5e134534297',
  },
} as const;

// Epoch ID used in testnet deployment
export const TESTNET_EPOCH_ID = 497585;

// Points constants (match bees-network-core)
export const POINTS_CONFIG = {
  bytesPerNetPt: 102_400,
  beatsPerUpPt: 20,
  maxNetPerDay: 500,
  maxUpPerDay: 144,
} as const;

// Branding
export const BRAND = {
  name: 'Bee Network',
  tagline: 'Real-Time Geographic Intelligence for AI Agents',
  colors: {
    primary: '#FFB800',      // Honey gold
    primaryDark: '#E6A600',
    secondary: '#1A1A1A',    // Near black
    surface: '#FFFFFF',
    surfaceAlt: '#FAFAFA',
    text: '#1A1A1A',
    textMuted: '#666666',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    border: '#E5E5E5',
  },
  gradients: {
    primary: 'linear-gradient(135deg, #FFB800 0%, #FFD700 100%)',
    honeycomb: 'radial-gradient(circle at 30% 30%, #FFF8E1 0%, #FFECB3 100%)',
  },
} as const;