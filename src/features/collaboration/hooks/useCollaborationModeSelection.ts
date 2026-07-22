import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CollaborationModeOption } from "../../../types";
import {
  appendGoalModeInstruction,
  appendPlanLanguageInstruction,
} from "../utils/developerInstructions";

type UseCollaborationModeSelectionOptions = {
  selectedCollaborationMode: CollaborationModeOption | null;
  selectedCollaborationModeId: string | null;
  selectedEffort: string | null;
  resolvedModel: string | null;
};

export function useCollaborationModeSelection({
  selectedCollaborationMode,
  selectedCollaborationModeId,
  selectedEffort,
  resolvedModel,
}: UseCollaborationModeSelectionOptions) {
  const { i18n } = useTranslation();
  const collaborationModePayload = useMemo(() => {
    if (!selectedCollaborationModeId || !selectedCollaborationMode) {
      return null;
    }

    const rawModeValue = selectedCollaborationMode.mode || selectedCollaborationMode.id;
    const normalizedModeValue = rawModeValue.trim().toLowerCase();
    const isGoalMode =
      normalizedModeValue === "goal" ||
      selectedCollaborationMode.id.trim().toLowerCase() === "goal";
    const modeValue = isGoalMode ? "custom" : rawModeValue;
    if (!modeValue) {
      return null;
    }

    const settings: Record<string, unknown> = {
      id: selectedCollaborationMode.id,
      developer_instructions: isGoalMode
        ? appendGoalModeInstruction(
            selectedCollaborationMode.developerInstructions,
            i18n.language,
          )
        : appendPlanLanguageInstruction(
            selectedCollaborationMode.developerInstructions,
            i18n.language,
          ),
    };

    if (resolvedModel) {
      settings.model = resolvedModel;
    }

    if (selectedEffort !== null) {
      settings.reasoning_effort = selectedEffort;
    }

    return {
      mode: modeValue,
      settings,
    };
  }, [
    resolvedModel,
    selectedCollaborationMode,
    selectedCollaborationModeId,
    selectedEffort,
    i18n.language,
  ]);

  return { collaborationModePayload };
}
