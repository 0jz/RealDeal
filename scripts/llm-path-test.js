// Tests the WITH-KEY code path without a real key: a tiny OpenAI-compatible mock server answers
// /v1/chat/completions, and the app is started with LLM_BASE_URL pointing at it. This exercises Mozaik's
// OpenAIChatCompletions endpoint, real tool calls, the number guard, id validation and the stale-answer guard.
// The mock's response delay simulates network latency of a hosted model; it exists only in this test double.
import { createServer } from "node:http";
import { startServer, runScan, sleep, overlaps, check } from "./test-helpers.js";

const MOCK_PORT = 3931;
const fmt = (v) => Math.round(v).toLocaleString("en-US") + " RSD";
let calls = 0;
const mock = createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls++;
    const reqJson = JSON.parse(body); const msgs = reqJson.messages; const last = msgs.at(-1);
    const tool = reqJson.tools?.[0]?.function?.name;
    let message;
    if (last.role === "user") {
      const args = /TOOL_ARGS:\s*(\{.*\})/.exec(last.content)?.[1] ?? "{}";
      message = { role: "assistant", content: null, tool_calls: [{ id: "call_" + calls, type: "function", function: { name: tool, arguments: args } }] };
    } else {
      const out = JSON.parse(last.content);
      let content;
      if (tool === "search_kp_listings") {
        const matches = out.candidates.filter((c) => c.title.startsWith(out.product) && c.condition !== "new-accessory").map((c) => ({ id: c.id, reason: "same model" }));
        content = JSON.stringify({ matches: [...matches, { id: "kp-999999", reason: "hallucinated id" }], rejected: [] });
      } else if (tool === "audit_retailer") {
        content = `${out.retailerName} advertised a before price above its 30-day minimum on ${out.violations} of ${out.offersAudited} offers; trust score ${out.score}/100.`;
      } else {
        const t = out.thirtyDay; const rec = out.options.find((o) => o.id === out.recommended);
        content = out.product.startsWith("Kora Stick")
          ? `This deal saves 12,345 RSD.` // invented number: must be rejected by the number guard
          : `The lowest price in the previous 30 days was ${fmt(t.min30.v)}. Best option: ${rec.title} at ${fmt(rec.price.v)}.`;
      }
      message = { role: "assistant", content };
    }
    const delay = 250 + Math.random() * 500;
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "mock-" + calls, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: reqJson.model, choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
    }, delay);
  });
}).listen(MOCK_PORT);

const failures = [];
const srv = await startServer(3932, { LLM_MODE: "", LLM_BASE_URL: `http://localhost:${MOCK_PORT}/v1`, LLM_API_KEY: "test", LLM_MODEL: "mock-model" });
try {
  const meta = await fetch(`${srv.base}/api/meta`).then((r) => r.json());
  check(meta.mode === "llm" && meta.model === "mock-model", `LLM mode via ${meta.provider}`, failures);
  let pushed = false;
  const snap = await runScan(srv.base, "family", {
    timeoutMs: 30000,
    async onPoll(s) { // publish a late feed page while Verdict loops are still reasoning
      if (!pushed && s.tasks.some((t) => t.agent === "Verdict" && t.status === "running" && ["p03", "p04"].includes(t.productId))) { pushed = true; await fetch(`${srv.base}/api/runs/${s.id}/next-page`, { method: "POST" }); }
    },
  });
  await sleep(4000);
  const final = await fetch(`${srv.base}/api/runs/${snap.id}`).then((r) => r.json());
  check(final.items.every((i) => i.verdict), `all products got verdicts via the LLM path (${calls} chat completions)`, failures);
  check(final.items.filter((i) => i.verdict.explanationSource === "llm").length >= final.items.length - 1, "explanations are LLM-written", failures);
  const blender = final.items.find((i) => i.productId === "p11");
  check(blender?.verdict.explanationSource === "template" && /number guard/.test(blender.verdict.check), `number guard rejected the invented number: "${blender?.verdict.check}"`, failures);
  check(final.items.every((i) => /dropped 1 id/.test(i.kp.check)), "KP dropped the hallucinated listing id", failures);
  const pairs = overlaps(final.tasks, ["KP", "CrossShop", "ShopTrust", "Verdict"]);
  check(pairs.length >= 3, `LLM loops overlap: ${pairs.join(", ")}`, failures);
  const kpLoops = final.tasks.filter((t) => t.agent === "KP");
  const concurrentKp = kpLoops.filter((a) => kpLoops.some((b) => a !== b && a.start < b.end && b.start < a.end)).length;
  check(concurrentKp >= 3, `${concurrentKp} KP loops were in flight simultaneously`, failures);
  const discarded = final.tasks.filter((t) => t.agent === "Verdict" && t.status === "superseded" && /while reasoning/.test(t.note || ""));
  check(pushed && discarded.length > 0, `stale LLM answers discarded: ${discarded.map((t) => t.label).join("; ")}`, failures);
  const waited = final.tasks.filter((t) => t.interception?.waitedMs > 0).length;
  console.log(`info  ${waited} Verdict loop(s) paused in interception waiting for ShopTrust`);
} catch (e) { failures.push(String(e)); console.error(e); }
finally { srv.stop(); mock.close(); }
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
