const PLAN_READY_TAG_PREFIX = "[[cm_plan_ready:";

export function isPlanReadyTaggedMessage(text: string) {
  return text.trimStart().startsWith(PLAN_READY_TAG_PREFIX);
}

export function makePlanReadyAcceptMessage() {
  return `${PLAN_READY_TAG_PREFIX}accept]] Implement this plan.`;
}
