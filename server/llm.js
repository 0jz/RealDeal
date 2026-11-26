// Inference configuration for the Mozaik runtime.
//  * With a key: Mozaik's own DefaultInferenceRunner + provider endpoints (OpenAI Responses, Anthropic,
//    Gemini, or any OpenAI-compatible /chat/completions endpoint via LLM_BASE_URL).
//  * Without a key: TemplateInferenceRunner — a deterministic, clearly-labelled stand-in that implements
//    Mozaik's InferenceRunner interface. It drives the SAME agent loops (inference -> tool call -> inference
//    -> answer) but writes its answers from fixed templates. It does no network I/O.
import { randomUUID } from "node:crypto";
import {
  defineRuntime, RuntimeState, supportedModels, OpenAIChatCompletions, FunctionCallItem, ModelMessageItem,
  UserMessageItem, SemanticEvent,
} from "@mozaik-ai/core";
import { templates } from "./templates.js";

const PROVIDER_KEYS = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", google: "GEMINI_API_KEY", gemini: "GEMINI_API_KEY", deepseek: "OPENAI_API_KEY" };

export function resolveLlmConfig(env = process.env) {
  const model = env.LLM_MODEL || "gpt-5.4-mini";
  if ((env.LLM_MODE || "").toLowerCase() === "template") return { mode: "template", reason: "LLM_MODE=template", model: null };
  if (env.LLM_BASE_URL) {
    const apiKey = env.LLM_API_KEY || env.OPENAI_API_KEY || "not-needed";
    const custom = {
      endpoint: new OpenAIChatCompletions(undefined, { baseURL: env.LLM_BASE_URL, apiKey }),
      specification: {
        name: model, provider: "openai-compatible", supportsReasoningEffort: false, supportedReasoningEfforts: [],
        supportsStreaming: false, contextWindowSize: 128000, maxOutputTokens: 4096, supportsFunctionCalling: true,
        supportsStructuredOutput: false,
        supportedContextItemTypes: ["user_message", "system_message", "developer_message", "function_call", "function_call_output", "model_message"],
      },
    };
    return { mode: "llm", model, provider: `openai-compatible (${env.LLM_BASE_URL})`, supportedModels: [custom, ...supportedModels], reasoningEffort: undefined };
  }
  const builtIn = supportedModels.find((m) => m.specification.name === model);
  if (!builtIn) return { mode: "template", reason: `LLM_MODEL "${model}" is not a built-in Mozaik model; set LLM_BASE_URL for OpenAI-compatible endpoints`, model: null };
  const provider = builtIn.specification.provider;
  const keyVar = PROVIDER_KEYS[provider] || "OPENAI_API_KEY";
  if (!env[keyVar]) return { mode: "template", reason: `${keyVar} is not set`, model: null };
  const effort = env.LLM_REASONING_EFFORT || "low";
  const reasoningEffort = builtIn.specification.supportsReasoningEffort && builtIn.specification.supportedReasoningEfforts.includes(effort) ? effort : undefined;
  return { mode: "llm", model, provider, supportedModels, reasoningEffort };
}

/** No-key stand-in implementing Mozaik's InferenceRunner. Template decisions only; real work happens in tools. */
export class TemplateInferenceRunner {
  async run(input) {
    const items = input.context.getItems();
    const tool = input.tools?.[0];
    const outputs = items.filter((i) => i.type === "function_call_output");
    const user = [...items].reverse().find((i) => i instanceof UserMessageItem);
    if (tool && outputs.length === 0) {
      const m = /TOOL_ARGS:\s*(\{.*\})/.exec(user?.content?.text || "");
      return { items: [FunctionCallItem.rehydrate({ callId: "tpl_" + randomUUID(), name: tool.name, args: m ? m[1] : "{}" })], tokenUsage: undefined, rowResponse: { template: true } };
    }
    let out = {};
    try { out = JSON.parse(outputs.at(-1)?.output?.text || "{}"); } catch { out = { error: outputs.at(-1)?.output?.text }; }
    const write = templates[tool?.name] || (() => "No template available.");
    return { items: [ModelMessageItem.rehydrate({ text: write(out) })], tokenUsage: undefined, rowResponse: { template: true } };
  }
  async *stream(input) {
    yield new SemanticEvent("inference.output", "template-runner", new Date(), await this.run(input));
  }
}

/** Wraps the real runner: if a provider call fails, the loop continues with the template answer (and says so). */
export class ResilientInferenceRunner {
  constructor(primary, fallback, onFallback) { this.primary = primary; this.fallback = fallback; this.onFallback = onFallback; }
  async run(input) {
    try { return await this.primary.run(input); }
    catch (e) { this.onFallback?.(e, input); const out = await this.fallback.run(input); out.rowResponse = { ...out.rowResponse, fallbackFrom: String(e?.message || e) }; return out; }
  }
  async *stream(input) { yield new SemanticEvent("inference.output", "resilient-runner", new Date(), await this.run(input)); }
}

export function buildInferenceRunnerConfig(cfg, onFallback) {
  const template = new TemplateInferenceRunner();
  if (cfg.mode !== "llm") return { runner: template };
  // Mozaik does not export its request validator, so we let a private, throwaway runtime build the
  // DefaultInferenceRunner (with validation) for us, then wrap it.
  class ProbeState extends RuntimeState {}
  const probe = defineRuntime().initializeRuntime({ state: new ProbeState(), inferenceRunnerConfig: { supportedModels: cfg.supportedModels } });
  const primary = probe.getInferenceRunner();
  return { runner: new ResilientInferenceRunner(primary, template, onFallback) };
}

/** InferenceInput for a loop: a fresh, isolated context per task (so products never share memory). */
export function inferenceInput(cfg, context, tools) {
  const input = { model: cfg.mode === "llm" ? cfg.model : "template-runner", context, tools, maxOutputTokens: 900 };
  if (cfg.reasoningEffort) input.reasoningEffort = cfg.reasoningEffort;
  return input;
}
