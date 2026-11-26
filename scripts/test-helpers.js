// Shared helpers for the end-to-end tests: start the real server as a child process and drive its API.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startServer(port, env = {}) {
  const child = spawn(process.execPath, [join(ROOT, "server", "index.js")], { env: { ...process.env, PORT: String(port), ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 100 && !out.includes("running on"); i++) await sleep(100);
  if (!out.includes("running on")) { child.kill(); throw new Error("server did not start:\n" + out); }
  return { child, base: `http://localhost:${port}`, output: () => out, stop: () => child.kill("SIGTERM") };
}

export async function runScan(base, listId, { timeoutMs = 20000, onPoll } = {}) {
  const { runId } = await fetch(`${base}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listId }) }).then((r) => r.json());
  const t0 = Date.now(); let snap;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(100);
    snap = await fetch(`${base}/api/runs/${runId}`).then((r) => r.json());
    if (onPoll) await onPoll(snap);
    if (snap.headline?.complete) return snap;
  }
  throw new Error("run did not complete in time");
}

export async function waitComplete(base, runId, minVersion, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(100);
    const s = await fetch(`${base}/api/runs/${runId}`).then((r) => r.json());
    if (s.headline?.complete && s.feed.pagesRead.length >= minVersion) return s;
  }
  throw new Error("re-check did not complete in time");
}

/** Pairs of tasks from different agents whose [start, end] intervals overlap. */
export function overlaps(tasks, agents) {
  const asyncT = tasks.filter((t) => agents.includes(t.agent) && t.kind !== "sync" && t.end);
  const pairs = new Set();
  for (const a of asyncT) for (const b of asyncT) if (a.agent < b.agent && a.start < b.end && b.start < a.end) pairs.add(`${a.agent}~${b.agent}`);
  return [...pairs];
}

export function check(cond, msg, failures) { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures.push(msg); }

/** Every rendered number object must carry at least one source reference. */
export function unsourcedNumbers(obj, path = "", out = []) {
  if (obj && typeof obj === "object") {
    if ("v" in obj && "src" in obj && "f" in obj) { if (!obj.src.length && obj.v !== 0) out.push(path); return out; }
    for (const [k, v] of Object.entries(obj)) unsourcedNumbers(v, `${path}.${k}`, out);
  }
  return out;
}
