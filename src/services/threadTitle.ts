import { getLadonxApiBaseUrl } from "./runtimeDefaults";
import {
  getLadonxAuthStatus,
  readAnthropicApiKeyEnv,
  readOpenAiApiKeyEnv,
} from "./tauri";

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export async function readThreadTitleAccountApiKey(): Promise<string | null> {
  const authStatus = await getLadonxAuthStatus();
  const user = authStatus?.account?.user;
  const apiKey =
    user?.apiKey?.codex?.trim?.() ||
    user?.apiKey?.trim?.() ||
    user?.apiKeycodex?.trim?.() ||
    user?.api_key?.trim?.() ||
    "";
  return apiKey || null;
}

async function readThreadTitleApiKey(): Promise<string> {
  try {
    const apiKey = await readThreadTitleAccountApiKey();
    if (apiKey) {
      return apiKey;
    }
  } catch {
    // Fall back to legacy env-based lookup for compatibility.
  }

  const [openaiApiKey, anthropicApiKey] = await Promise.all([
    readOpenAiApiKeyEnv(),
    readAnthropicApiKeyEnv(),
  ]);
  const apiKey = openaiApiKey?.trim() || anthropicApiKey?.trim() || "";
  if (!apiKey) {
    throw new Error("No API key configured for thread title generation");
  }
  return apiKey;
}

export async function generateThreadTitle(
  prompt: string,
  workspaceId?: string | null,
  options?: { apiKey?: string | null },
) {
  const [baseUrl, apiKey] = await Promise.all([
    getLadonxApiBaseUrl(),
    options?.apiKey?.trim() ? Promise.resolve(options.apiKey.trim()) : readThreadTitleApiKey(),
  ]);
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/v1/api/thread-title`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      workspaceId: workspaceId ?? null,
    }),
  });
  const payload = (await response.json()) as {
    message?: string;
    data?: { title?: string | null };
  };
  if (!response.ok) {
    throw new Error(payload?.message || `Failed to generate thread title: ${response.status}`);
  }
  return {
    title: payload?.data?.title ?? "",
  };
}
