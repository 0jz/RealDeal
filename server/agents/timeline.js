// Timeline: an observer participant (handlers only). It watches every SemanticEvent on the runtime,
// binds Mozaik loopIds to tasks, records loop steps (inference / tool call / interception) for the
// timeline bars, and streams a compact event log to the browser.
import { createHuman } from "@mozaik-ai/core";
import { state, AnyEvent } from "../runtime.js";
import { bus, now, publicTask } from "../tasks.js";

const LOOP_STEP = { "inference.started": ["inference", "start"], "inference.completed": ["inference", "end"], "function_call.started": ["tool", "start"], "function_call.completed": ["tool", "end"] };

export function createTimeline() {
  return createHuman({
    name: "Timeline", capabilities: ["observer"],
    handlers: [{
      specification: new AnyEvent(),
      processor: {
        apply({ event }) {
          const s = state(); const t = now();
          const p = event.payload || {};
          let task = null;
          if (event.type === "message_received.started") {
            const m = /^\[task:([\w-]+)\]/.exec(p.content || "");
            if (m && s.tasks.has(m[1])) { s.loopTasks.set(p.loopId, m[1]); task = s.tasks.get(m[1]); task.loopId = p.loopId; }
          } else if (p.loopId) task = s.tasks.get(s.loopTasks.get(p.loopId));
          if (task && LOOP_STEP[event.type]) {
            const [kind, edge] = LOOP_STEP[event.type];
            if (edge === "start") task.steps.push({ kind, start: t, end: null, label: kind === "tool" ? p.call?.name : (task.model === "template" ? "template inference" : `${task.model} inference`) });
            else { const open = [...task.steps].reverse().find((x) => x.kind === kind && x.end === null); if (open) open.end = t; }
            bus.emit(task.runId, "task", publicTask(task));
          }
          const runId = p.runId || task?.runId;
          if (!runId) return;
          const run = s.runs.get(runId); if (!run) return;
          const producer = s.participants.get(event.producerId)?.getManifest().name ?? event.producerId;
          const entry = { t, type: event.type, producer, summary: summarize(event, task) };
          run.log.push(entry);
          bus.emit(runId, "log", entry);
        },
      },
    }],
  });
}

function summarize(event, task) {
  const p = event.payload || {};
  switch (event.type) {
    case "message.sent": return "scan requested";
    case "price.observed": return `${p.productId} v${p.version} (page ${p.page}, ${p.offers.length} offers)`;
    case "function_call.started": return `${task?.label}: ${p.call?.name}(${(p.call?.args || "").slice(0, 120)})`;
    case "interception.started": return `${task?.label}: ShopTrust intercepting ${p.nextStateId}`;
    case "interception.finished": return `${task?.label}: continuing with ${p.nextStateId}${p.input?.call ? " " + p.input.call.args.slice(0, 160) : ""}`;
    case "model.answer": return `${task?.label}: ${(p.answer?.content?.text || "").slice(0, 140)}`;
    default: return task ? task.label : JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => k !== "runId" && k !== "offers"))).slice(0, 140);
  }
}
