import { getLadonxApiBaseUrl, getRuntimeDefaults } from "@/services/runtimeDefaults";
import {
  readAnthropicApiKeyEnv,
  readCodexBaseUrl,
  readOpenAiApiKeyEnv,
} from "@/services/tauri";
import type { ModelOption } from "@/types";
import { parseModelListResponse } from "./modelListResponse";

type RemoteModelProvider = "openai" | "anthropic";
export type ModelEndpointType = "response" | "message";

type FetchRemoteModelListOptions = {
  preferLadonxBaseUrl?: boolean;
};

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : null;
}

async function resolveModelsBaseUrl(options: FetchRemoteModelListOptions = {}): Promise<string> {
  if (options.preferLadonxBaseUrl) {
    const codexBaseUrl = normalizeBaseUrl((await getRuntimeDefaults()).codexBaseUrl);
    if (codexBaseUrl) {
      return codexBaseUrl;
    }
  }
  const [codexBaseUrl, ladonxApiBaseUrl] = await Promise.all([
    readCodexBaseUrl(),
    getLadonxApiBaseUrl(),
  ]);
  const baseUrl =
    normalizeBaseUrl(codexBaseUrl) ?? normalizeBaseUrl(ladonxApiBaseUrl);
  if (!baseUrl) {
    throw new Error("No model base URL configured");
  }
  return baseUrl;
}

async function readProviderApiKey(provider: RemoteModelProvider): Promise<string> {
  const apiKey =
    provider === "anthropic"
      ? await readAnthropicApiKeyEnv()
      : await readOpenAiApiKeyEnv();
  const trimmed = apiKey?.trim();
  if (!trimmed) {
    throw new Error(
      provider === "anthropic"
        ? "ANTHROPIC_AUTH_TOKEN is not configured"
        : "OPENAI_API_KEY is not configured",
    );
  }
  return trimmed;
}

export async function fetchRemoteModelList(
  provider: RemoteModelProvider,
  endpointType: ModelEndpointType = "response",
  options: FetchRemoteModelListOptions = {},
): Promise<ModelOption[]> {
  const [baseUrl, apiKey] = await Promise.all([
    resolveModelsBaseUrl(options),
    readProviderApiKey(provider),
  ]);
  const modelsUrl = new URL(`${baseUrl}/models`);
  modelsUrl.searchParams.set("type", endpointType);
  const response = await fetch(modelsUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${provider} models: ${response.status}`);
  }
  return parseModelListResponse(await response.json());
}
