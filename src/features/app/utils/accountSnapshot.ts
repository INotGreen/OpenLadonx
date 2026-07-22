import type { AccountSnapshot } from "@/types";

export function normalizeAccountSnapshot(
  response: Record<string, unknown> | null,
): AccountSnapshot {
  const result =
    response?.result && typeof response.result === "object"
      ? (response.result as Record<string, unknown>)
      : null;
  const accountValue = result?.account ?? response?.account;
  const account =
    accountValue && typeof accountValue === "object"
      ? (accountValue as Record<string, unknown>)
      : null;
  const requiresOpenaiAuthRaw =
    result?.requiresOpenaiAuth ??
    result?.requires_openai_auth ??
    response?.requiresOpenaiAuth ??
    response?.requires_openai_auth;
  const requiresOpenaiAuth =
    typeof requiresOpenaiAuthRaw === "boolean" ? requiresOpenaiAuthRaw : null;

  if (!account) {
    return {
      type: "unknown",
      email: null,
      planType: null,
      requiresOpenaiAuth,
    };
  }

  const typeRaw =
    typeof account.type === "string" ? account.type.toLowerCase() : "unknown";
  const type = typeRaw === "chatgpt" || typeRaw === "apikey" ? typeRaw : "unknown";
  const emailRaw = typeof account.email === "string" ? account.email.trim() : "";
  const planRaw =
    typeof account.planType === "string" ? account.planType.trim() : "";

  return {
    type,
    email: emailRaw ? emailRaw : null,
    planType: planRaw ? planRaw : null,
    requiresOpenaiAuth,
  };
}

export function hasUsableAccountSnapshot(
  account: AccountSnapshot | null | undefined,
): boolean {
  if (!account) {
    return false;
  }

  return (
    account.type !== "unknown" ||
    Boolean(account.email?.trim()) ||
    Boolean(account.planType?.trim())
  );
}
