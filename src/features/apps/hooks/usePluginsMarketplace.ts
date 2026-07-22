import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginMarketItem } from "../../../types";
import { getPluginsMarketplace } from "../../../services/tauri";

export function usePluginsMarketplace() {
  const [plugins, setPlugins] = useState<PluginMarketItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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
    setIsLoading(true);
    try {
      const data = await getPluginsMarketplace();
      setPlugins(Array.isArray(data) ? data : []);
      hasFetched.current = true;
      lastFetchedAt.current = Date.now();
    } catch (error) {
      console.error("[usePluginsMarketplace] failed to load", error);
      if (force) {
        setPlugins([]);
      }
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPlugins({ force: !hasFetched.current });
  }, [refreshPlugins]);

  return {
    plugins,
    isLoading,
    refreshPlugins,
  };
}
