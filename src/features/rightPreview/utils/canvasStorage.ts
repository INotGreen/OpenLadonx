import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";

const CANVAS_DIR_NAME = "canvas";
const CANVAS_FILE = "cowart-canvas.json";
const SELECTION_FILE = "cowart-selection.json";
const VIEW_STATE_FILE = "cowart-view-state.json";

export type CanvasSnapshotResponse = { snapshot: unknown };
export type ViewStateResponse = { viewState: unknown };
export type SelectionPayload = Record<string, unknown> & { updatedAt?: string };

async function canvasDir(workspacePath: string): Promise<string> {
  return await join(workspacePath, CANVAS_DIR_NAME);
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const text = await invoke<string>("read_text_file_path", { path: filePath });
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (error) {
    // File not found is expected on first load — return null silently.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("File not found") || message.includes("No such file")) {
      return null;
    }
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await invoke<void>("write_text_file", {
    path: filePath,
    content: typeof value === "string" ? value : JSON.stringify(value),
  });
}

export async function loadCanvasSnapshot(workspacePath: string): Promise<CanvasSnapshotResponse | null> {
  const file = await join(await canvasDir(workspacePath), CANVAS_FILE);
  return await readJson<CanvasSnapshotResponse>(file);
}

export async function saveCanvasSnapshot(workspacePath: string, snapshot: unknown): Promise<void> {
  const file = await join(await canvasDir(workspacePath), CANVAS_FILE);
  const payload: CanvasSnapshotResponse = { snapshot };
  await writeJson(file, payload);
}

export async function loadViewState(workspacePath: string): Promise<ViewStateResponse | null> {
  const file = await join(await canvasDir(workspacePath), VIEW_STATE_FILE);
  return await readJson<ViewStateResponse>(file);
}

export async function saveViewState(workspacePath: string, viewState: unknown): Promise<void> {
  const file = await join(await canvasDir(workspacePath), VIEW_STATE_FILE);
  const payload: ViewStateResponse = { viewState };
  await writeJson(file, payload);
}

export async function loadSelection(workspacePath: string): Promise<SelectionPayload | null> {
  const file = await join(await canvasDir(workspacePath), SELECTION_FILE);
  return await readJson<SelectionPayload>(file);
}

export async function saveSelection(workspacePath: string, selection: SelectionPayload): Promise<void> {
  const file = await join(await canvasDir(workspacePath), SELECTION_FILE);
  await writeJson(file, selection);
}
