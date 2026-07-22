import type { ModelOption } from "../../../types";

const PROVIDER_PREFIXES: Array<{ id: string; prefixes: string[] }> = [
  { id: "gpt", prefixes: ["gpt-"] },
  { id: "deepseek", prefixes: ["deepseek-"] },
  { id: "claude", prefixes: ["claude-"] },
  { id: "qwen", prefixes: ["qwen-"] },
  { id: "zhipu", prefixes: ["zhipu-", "glm-"] },
  { id: "minimax", prefixes: ["minimax-"] },
  { id: "gemini", prefixes: ["gemini-"] },
  { id: "grok", prefixes: ["grok-"] },
  { id: "kimi", prefixes: ["kimi-", "moonshot-"] },
];

function deriveProvider(modelName: string): string {
  const lower = modelName.trim().toLowerCase();
  for (const entry of PROVIDER_PREFIXES) {
    if (entry.prefixes.some((prefix) => lower.startsWith(prefix))) {
      return entry.id;
    }
  }
  return "other";
}

/**
 * 把用户在自定义 API 配置里填写的模型字符串列表，转换成 Composer 可用的 ModelOption。
 * 与 ComposerInput 的 getModelProviderId 前缀启发式保持一致，便于按厂商分组展示。
 */
export function buildCustomModelOptions(models: string[]): ModelOption[] {
  const seen = new Set<string>();
  const result: ModelOption[] = [];
  for (const raw of models) {
    const model = raw.trim();
    if (!model || seen.has(model)) {
      continue;
    }
    seen.add(model);
    result.push({
      id: model,
      model,
      displayName: model,
      description: "",
      provider: deriveProvider(model),
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null,
      isDefault: result.length === 0,
    });
  }
  return result;
}
