type Translate = (key: string, options?: Record<string, unknown>) => unknown;

export const REASONING_EFFORT_OPTIONS = [
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffortOption = (typeof REASONING_EFFORT_OPTIONS)[number];

const reasoningEffortOptions = new Set<string>(REASONING_EFFORT_OPTIONS);

const reasoningEffortLabelKeys: Record<ReasoningEffortOption, string> = {
  low: "composer.reasoningEfforts.low",
  medium: "composer.reasoningEfforts.medium",
  high: "composer.reasoningEfforts.high",
  xhigh: "composer.reasoningEfforts.xhigh",
};

export function normalizeReasoningEffortOption(
  effort: string | null | undefined,
): ReasoningEffortOption | null {
  const normalized = effort?.trim().toLowerCase();
  if (!normalized || !reasoningEffortOptions.has(normalized)) {
    return null;
  }
  return normalized as ReasoningEffortOption;
}

export function formatReasoningEffortLabel(
  t: Translate,
  effort: string | null | undefined,
) {
  const normalized = effort?.trim().toLowerCase();
  if (!normalized) {
    return String(t("composer.reasoningEfforts.default"));
  }

  const normalizedOption = normalizeReasoningEffortOption(normalized);
  if (!normalizedOption) {
    return effort;
  }

  const key = reasoningEffortLabelKeys[normalizedOption];
  const translated = t(key);
  return typeof translated === "string" && translated !== key
    ? translated
    : effort;
}
