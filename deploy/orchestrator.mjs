// Minimal Bees Network orchestrator (v0.1, demo).
//
// Speaks the protocol the bee-node OrchestratorClient expects over plain HTTP:
//   POST /nodes                       -> register node (NodeInfo)
//   GET  /nodes/:id/task              -> 200 TaskRequest, or 204 if none
//   POST /nodes/:id/tasks/:tid/result -> record TaskResult (tally beats/bytes)
//   POST /nodes/:id/heartbeat         -> liveness
//   GET  /probe                       -> tiny payload used as an HttpGet target
//   GET  /admin/tally                 -> per-node {beats,bytes} for the coordinator
//   POST /admin/task                  -> enqueue a specific task for a node
//
// The node falls back to HTTP polling because this server has no WebSocket
// endpoint (the client probes the WS URL first and falls back on failure).
import { createServer } from "node:http";

const PORT = Number(process.env.ORCHESTRATOR_PORT ?? 8080);
const HOST = process.env.ORCHESTRATOR_HOST ?? "127.0.0.1";
const TASK_INTERVAL_MS = Number(process.env.TASK_INTERVAL_MS ?? 0); // 0 = every poll
const REWARD = Number(process.env.TASK_REWARD ?? 1_000_000);

const nodes = new Map(); // node_id -> { info, beats, bytes, last_seen, tasks_issued }
const queue = new Map(); // node_id -> [TaskRequest]
let taskSeq = 0;

function nowMs() { return Date.now(); }
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const s = Buffer.concat(chunks).toString("utf8");
      try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); }
    });
  });
}
function ensureNode(id) {
  if (!nodes.has(id)) nodes.set(id, { info: null, beats: 0, bytes: 0, last_seen: nowMs(), tasks_issued: 0 });
  return nodes.get(id);
}
function makeProbeTask() {
  taskSeq += 1;
  return {
    id: `t-${taskSeq}-${nowMs()}`,
    task_type: "http_get",
    params: { url: `http://${HOST}:${PORT}/probe`, timeout_secs: 10 },
    deadline: nowMs() + 60_000,
    reward_amount: REWARD,
    requester_pubkey: "0x" + "00".repeat(33),
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const parts = path.split("/").filter(Boolean);

  // GET /probe
  if (req.method === "GET" && path === "/probe") {
    return json(res, 200, { ok: true, ts: nowMs(), nonce: Math.floor(Math.random() * 1e9) });
  }

  // GET /admin/tally
  if (req.method === "GET" && path === "/admin/tally") {
    const out = [...nodes.entries()].map(([node_id, n]) => ({
      node_id, beats: n.beats, bytes: n.bytes, last_seen: n.last_seen, tasks_issued: n.tasks_issued,
    }));
    return json(res, 200, { nodes: out, total_beats: out.reduce((a, n) => a + n.beats, 0) });
  }

  // POST /admin/task  { node_id, task }
  if (req.method === "POST" && path === "/admin/task") {
    const body = await readBody(req);
    const id = body.node_id;
    if (!id) return json(res, 400, { error: "node_id required" });
    ensureNode(id);
    const list = queue.get(id) ?? [];
    list.push(body.task ?? makeProbeTask());
    queue.set(id, list);
    return json(res, 200, { queued: list.length });
  }

  // POST /nodes
  if (req.method === "POST" && parts.length === 1 && parts[0] === "nodes") {
    const info = await readBody(req);
    if (!info?.node_id) return json(res, 400, { error: "node_id required" });
    const n = ensureNode(info.node_id);
    n.info = info;
    n.last_seen = nowMs();
    console.log(`[register] ${info.node_id.slice(0, 18)}.. v=${info.version} caps=${(info.capabilities || []).length}`);
    return json(res, 200, { ok: true, node_id: info.node_id });
  }

  // /nodes/:id/task
  if (req.method === "GET" && parts.length === 3 && parts[0] === "nodes" && parts[2] === "task") {
    const id = parts[1];
    const n = ensureNode(id);
    n.last_seen = nowMs();
    const list = queue.get(id) ?? [];
    let task = list.shift();
    if (!task && TASK_INTERVAL_MS >= 0) task = makeProbeTask();
    if (!task) { res.writeHead(204); return res.end(); }
    n.tasks_issued += 1;
    return json(res, 200, task);
  }

  // /nodes/:id/tasks/:tid/result
  if (req.method === "POST" && parts.length === 5 && parts[0] === "nodes" && parts[2] === "tasks" && parts[4] === "result") {
    const id = parts[1];
    const result = await readBody(req);
    const n = ensureNode(id);
    n.last_seen = nowMs();
    n.beats += 1;
    n.bytes += Number(result.bytes_sent ?? 0) + Number(result.bytes_received ?? 0);
    console.log(`[result] ${id.slice(0, 18)}.. task=${result.task_id} ok=${result.success} beats=${n.beats} bytes=${n.bytes}`);
    return json(res, 200, { ok: true, beats: n.beats, bytes: n.bytes });
  }

  // /nodes/:id/heartbeat
  if (req.method === "POST" && parts.length === 3 && parts[0] === "nodes" && parts[2] === "heartbeat") {
    const n = ensureNode(parts[1]);
    n.last_seen = nowMs();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "not found", path, method: req.method });
});

server.listen(PORT, HOST, () => {
  console.log(`Bees orchestrator listening on http://${HOST}:${PORT}`);
});
