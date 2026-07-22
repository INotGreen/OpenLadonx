const PLAN_LANGUAGE_INSTRUCTION_ZH =
  "调用 update_plan 时，explanation 和所有 step 必须使用用户主要使用的语言；如果用户用中文提问或界面语言是中文，所有计划步骤都用中文。不要翻译代码标识符、文件路径、命令或专有名词。";

const PLAN_LANGUAGE_INSTRUCTION_EN =
  "When calling update_plan, write the explanation and every step in the user's primary language. If the user writes Chinese or the UI language is Chinese, use Chinese for every plan step. Do not translate code identifiers, file paths, commands, or proper nouns.";

const GOAL_MODE_INSTRUCTION_ZH =
  "目标模式：将用户本轮请求作为持续目标处理。开始实际工作前，若 create_goal 可用，先调用 create_goal 创建目标；后续围绕该目标推进。只有在目标完全完成且已验证时，才调用 update_goal 将状态标记为 complete；不要仅因为本轮回复结束就完成目标。面向用户的进度、说明和目标内容优先使用用户主要语言；如果用户用中文提问或界面语言是中文，则使用中文。不要翻译代码标识符、文件路径、命令或专有名词。";

const GOAL_MODE_INSTRUCTION_EN =
  "Goal mode: treat the user's current request as a persistent goal. Before doing the substantive work, call create_goal if it is available to create the goal, then continue working toward it. Only call update_goal with status complete when the full goal is finished and verified; do not complete the goal merely because the current reply is ending. Write user-facing progress, explanations, and goal content in the user's primary language. If the user writes Chinese or the UI language is Chinese, use Chinese. Do not translate code identifiers, file paths, commands, or proper nouns.";

export function appendPlanLanguageInstruction(
  developerInstructions: string | null | undefined,
  language: string | null | undefined,
) {
  const normalizedLanguage = language?.trim().toLowerCase() ?? "";
  const instruction = normalizedLanguage.startsWith("zh")
    ? PLAN_LANGUAGE_INSTRUCTION_ZH
    : PLAN_LANGUAGE_INSTRUCTION_EN;
  const base = developerInstructions?.trim() ?? "";
  if (!base) {
    return instruction;
  }
  if (base.includes("update_plan") && base.includes("所有计划步骤")) {
    return base;
  }
  if (base.includes("update_plan") && base.includes("every plan step")) {
    return base;
  }
  return `${base}\n\n${instruction}`;
}

export function appendGoalModeInstruction(
  developerInstructions: string | null | undefined,
  language: string | null | undefined,
) {
  const normalizedLanguage = language?.trim().toLowerCase() ?? "";
  const instruction = normalizedLanguage.startsWith("zh")
    ? GOAL_MODE_INSTRUCTION_ZH
    : GOAL_MODE_INSTRUCTION_EN;
  const base = developerInstructions?.trim() ?? "";
  if (!base) {
    return instruction;
  }
  if (base.includes("目标模式") || base.includes("Goal mode")) {
    return base;
  }
  return `${base}\n\n${instruction}`;
}
