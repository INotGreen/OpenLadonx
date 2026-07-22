import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginOption } from "../../../types";
import { getConfiguredPlugins } from "../../../services/tauri";

export function useConfiguredPlugins() {
  const [plugins, setPlugins] = useState<PluginOption[]>([]);
  const inFlight = useRef(false);
  const lastFetchedAt = useRef(0);
  const hasFetched = useRef(false);

  const refreshPlugins = useCallback(async (options?: { force?: boolean }) => {
    if (inFlight.current) {
      return;
    }
    const force = options?.force === true;
    if (!force && hasFetched.current && Date.now() - lastFetchedAt.current < 5_000) {
      return;
    }
    inFlight.current = true;
    try {
      const data = await getConfiguredPlugins();
      setPlugins(Array.isArray(data) ? data : []);
      hasFetched.current = true;
      lastFetchedAt.current = Date.now();
    } catch (error) {
      console.error("[useConfiguredPlugins] failed to load", error);
      if (force) {
        setPlugins([]);
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshPlugins({ force: !hasFetched.current });
  }, [refreshPlugins]);

  return {
    plugins,
    refreshPlugins,
  };
}
