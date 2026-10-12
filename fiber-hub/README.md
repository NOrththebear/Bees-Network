# Bees Fiber Hub (Railway)

This service runs the native Fiber node (`fnn`) plus a small gateway. It is
the **Bee Network coordinator hub**: the always-online counterparty that
opens hub-funded reward channels to browser Bee nodes and pays them over
Fiber — no wallet extension, no user-side channel setup.

- `POST /rpc` proxies token-authenticated JSON-RPC to the local `fnn` RPC listener.
- WSS upgrades bridge browser Fiber nodes to the local native TCP listener.
- `GET /health` reports whether the gateway is online and whether `fnn` is responding.

## Railway setup

Root Directory: `fiber-hub` (or deploy this folder as the service root).

```text
Dockerfile Path: Dockerfile
Volume Mount Path: /data
```

Set these Railway variables:

```env
FIBER_SECRET_KEY_PASSWORD=<strong-password>
FIBER_NETWORK=testnet
FIBER_HOME=/data
RUST_LOG=info
FIBER_GATEWAY_RPC_TOKEN=<long-random-token>
CKB_RPC_URL=https://testnet.ckb.dev/
```

The mounted `/data` volume is required. It stores the operator key, CKB key,
peer store, channels, graph data, and payment state. Do not delete it after
opening channels.

After deploy, open:

```text
https://<railway-domain>/health
```

Expected response:

```json
{
  "ok": true,
  "gateway": "online",
  "fiber": "online",
  "pubkey": "02..."
}
```

If `fiber` is `starting`, check Railway logs. First boot can take longer
while the node initializes.

## Wiring the hub into the Bee frontend

After Railway gives the service a public domain:

```env
NEXT_PUBLIC_BEES_HUB_PUBKEY=<pubkey from /health>
NEXT_PUBLIC_BEES_HUB_ADDRESS=/dns4/<railway-domain>/tcp/443/wss
NEXT_PUBLIC_BEES_HUB_API=https://<railway-domain>
```

Browser nodes dial the hub on startup; on first reward the hub opens a
hub-funded RUSD channel to the user (auto-accepted with 0 contribution) and
pays the reward invoice. See `frontend/src/lib/fiber-lazy.ts` for the full
coordinator contract.

Full node info (needs the gateway token):

```bash
curl -s https://<railway-domain>/rpc \
  -H 'authorization: Bearer <FIBER_GATEWAY_RPC_TOKEN>' \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"node_info","params":[]}'
```

## Funding

The hub must hold testnet CKB and RUSD liquidity before it can open/fund
browser channels. Fund the address derived from
`default_funding_lock_script.args` in `node_info` (faucet:
https://faucet.nervos.org).

## Notes

- Railway exposes the browser-facing side through HTTPS/WSS on the generated domain.
- Raw Fiber RPC is disabled when `FIBER_GATEWAY_RPC_TOKEN` is missing and rejects requests without the matching bearer token. Do not expose this token to browsers.
- Native Fiber TCP inbound from the public internet is not required: browser nodes dial the hub gateway over WSS.
- Keep Fiber, `fiber-js`, and the public nodes on the same release line. This Dockerfile pins Fiber to `v0.9.0-rc7`, matching `@nervosnetwork/fiber-js@0.9.1`'s protocol.
