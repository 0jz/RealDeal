// Tasks = units of agent work drawn on the timeline, plus the SSE fan-out to browsers.
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { state } from "./runtime.js";

export const now = () => performance.timeOrigin + performance.now();

const clients = new Map(); // runId -> Set(res)
export const bus = {
  subscribe(runId, res) { if (!clients.has(runId)) clients.set(runId, new Set()); clients.get(runId).add(res); return () => clients.get(runId)?.delete(res); },
  emit(runId, type, data) {
    const set = clients.get(runId); if (!set) return;
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) res.write(msg);
  },
};

export function startTask(run, { agent, label, kind, productId = null, retailerId = null, version = null }) {
  const task = { id: randomUUID().slice(0, 8), runId: run.id, agent, label, kind, productId, retailerId, version, start: now(), end: null, status: "running", steps: [], stale: false, interception: null, note: null, model: null };
  state().tasks.set(task.id, task);
  run.tasks.push(task);
  bus.emit(run.id, "task", publicTask(task));
  return task;
}
export function updateTask(task, patch = {}) {
  Object.assign(task, patch);
  bus.emit(task.runId, "task", publicTask(task));
}
export function endTask(task, status = "done", patch = {}) {
  updateTask(task, { ...patch, status, end: patch.end ?? now() });
}
export const publicTask = ({ toolResult, ...t }) => t;
