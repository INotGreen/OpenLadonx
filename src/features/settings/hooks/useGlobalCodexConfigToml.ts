import { readGlobalCodexConfigToml, writeGlobalCodexConfigToml } from "@services/tauri";
import { useFileEditor } from "@/features/shared/hooks/useFileEditor";

export function useGlobalCodexConfigToml(onSaved?: () => void | Promise<void>) {
  const editor = useFileEditor({
    key: "global-config",
    read: readGlobalCodexConfigToml,
    write: writeGlobalCodexConfigToml,
    readErrorTitle: "Couldn’t load global config.toml",
    writeErrorTitle: "Couldn’t save global config.toml",
  });

  return {
    ...editor,
    save: async () => {
      const saved = await editor.save();
      if (saved) {
        await onSaved?.();
      }
      return saved;
    },
  };
}
