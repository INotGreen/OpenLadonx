import type { AppRuntimeDefaults } from "@/types";
import { getAppRuntimeDefaults } from "./tauri";

let defaultsPromise: Promise<AppRuntimeDefaults> | null = null;

export function getRuntimeDefaults(): Promise<AppRuntimeDefaults> {
  defaultsPromise ??= getAppRuntimeDefaults();
  return defaultsPromise;
}

export async function getLadonxApiBaseUrl(): Promise<string> {
  return (await getRuntimeDefaults()).ladonxApiBaseUrl;
}

export async function getUpdateApiBaseUrl(): Promise<string> {
  return (await getRuntimeDefaults()).updateApiBaseUrl;
}

export async function getRelayHostUrl(): Promise<string> {
  return (await getRuntimeDefaults()).relayHostUrl;
}

export async function getRemoteBackendHost(): Promise<string> {
  return (await getRuntimeDefaults()).remoteBackendHost;
}
