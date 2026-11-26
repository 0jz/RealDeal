// Minimal worker_threads pool. Jobs are queued and dispatched to idle workers.
import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";

export class WorkerPool {
  constructor(file, size = Math.max(2, Math.min(4, availableParallelism() - 1))) {
    this.size = size; this.queue = []; this.pending = new Map(); this.seq = 0;
    this.workers = Array.from({ length: size }, (_, index) => {
      const w = new Worker(file, { workerData: { index } });
      const slot = { w, busy: true, index }; // busy until "ready"
      w.on("message", (msg) => {
        if (msg.ready) { slot.busy = false; this.#drain(); return; }
        const p = this.pending.get(msg.id); this.pending.delete(msg.id); slot.busy = false;
        msg.ok ? p.resolve({ result: msg.result, startedAt: msg.startedAt, endedAt: msg.endedAt, worker: index }) : p.reject(new Error(msg.error));
        this.#drain();
      });
      w.on("error", (e) => console.error("[worker] error", e));
      return slot;
    });
  }
  run(type, args) {
    return new Promise((resolve, reject) => { this.queue.push({ id: ++this.seq, type, args, resolve, reject }); this.#drain(); });
  }
  #drain() {
    for (const slot of this.workers) {
      if (slot.busy || !this.queue.length) continue;
      const job = this.queue.shift(); slot.busy = true;
      this.pending.set(job.id, job);
      slot.w.postMessage({ id: job.id, type: job.type, args: job.args });
    }
  }
  close() { return Promise.all(this.workers.map((s) => s.w.terminate())); }
}
