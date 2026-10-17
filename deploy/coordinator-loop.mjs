// Bees Network coordinator loop (v0.1, beta).
//
// Periodically closes a rewards epoch whenever the orchestrator has recorded
// new activity since the last close. Designed to run as a long-lived service
// (systemd --user). All closing logic lives in coordinator.mjs.
//
// Usage:  CKB_RPC=https://testnet.ckb.dev node coordinator-loop.mjs
// Env:    ORCHESTRATOR_URL            (default http://127.0.0.1:8080)
//         COORDINATOR_INTERVAL_SECS   (default 1800 = 30 min)
//         COORDINATOR_MIN_NEW_BEATS   (default 1)
//         COORDINATOR_STATE_FILE      (default ./coordinator-loop-state.json)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCoordinator } from "./coordinator.mjs";

const INTERVAL_MS = Number(process.env.COORDINATOR_INTERVAL_SECS ?? 1800) * 1000;
const MIN_NEW_BEATS = Number(process.env.COORDINATOR_MIN_NEW_BEATS ?? 1);
const ORCH = process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:8080";
const STATE_FILE =
  process.env.COORDINATOR_STATE_FILE ??
  fileURLToPath(new URL("./coordinator-loop-state.json", import.meta.url));

const log = (...a) => console.log(new Date().toISOString(), ...a);

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastClosedTotal: 0 };
  }
}
function saveState(s) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch (e) {
    log("state save failed:", e?.message ?? e);
  }
}

async function tallyTotal() {
  const r = await fetch(`${ORCH}/admin/tally`);
  if (!r.ok) throw new Error(`tally ${r.status}`);
  return Number((await r.json()).total_beats ?? 0);
}

let running = false;
async function tick(state) {
  if (running) {
    log("previous tick still running; skipping");
    return;
  }
  running = true;
  try {
    let total;
    try {
      total = await tallyTotal();
    } catch (e) {
      log("orchestrator unavailable:", e?.message ?? e);
      return;
    }
    // If the orchestrator restarted, its counter resets; treat that as a fresh
    // baseline so we can close again once new beats accrue.
    const baseline = total < state.lastClosedTotal ? 0 : state.lastClosedTotal;
    const newBeats = total - baseline;
    if (newBeats < MIN_NEW_BEATS) {
      log(`tick: total=${total} new=${newBeats} (< ${MIN_NEW_BEATS}) — skip`);
      return;
    }
    log(`tick: total=${total} new=${newBeats} — closing epoch`);
    try {
      const res = await runCoordinator();
      if (res?.closed) {
        state.lastClosedTotal = total;
        saveState(state);
        log(`closed epoch ${res.epochId} tx=${res.tx} earners=${res.earners}`);
      } else if (res?.reason === "unclaimed") {
        log(`head epoch ${res.epochId} unclaimed — waiting for claim before closing`);
      } else {
        log("no earning nodes; not closing");
      }
    } catch (e) {
      log("coordinator error:", e?.stack ?? e);
    }
  } finally {
    running = false;
  }
}

async function main() {
  const state = loadState();
  log(
    `coordinator loop: interval=${INTERVAL_MS / 1000}s min_new_beats=${MIN_NEW_BEATS} orch=${ORCH}`,
  );
  await tick(state);
  setInterval(() => void tick(state), INTERVAL_MS);
}

main().catch((e) => {
  console.error("FATAL:", e?.stack ?? e);
  process.exit(1);
});
