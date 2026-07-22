import { useEffect, useState } from "react";
import { getResolvedAppTheme, type ResolvedAppTheme } from "./shiki";

export function useResolvedAppTheme(): ResolvedAppTheme {
  const [theme, setTheme] = useState<ResolvedAppTheme>(getResolvedAppTheme);
  useEffect(() => {
    const update = () => setTheme(getResolvedAppTheme());
    const root = document.documentElement;
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    let media: MediaQueryList | null = null;
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      media = window.matchMedia("(prefers-color-scheme: light)");
      media.addEventListener("change", update);
    }
    return () => {
      observer.disconnect();
      if (media) {
        media.removeEventListener("change", update);
      }
    };
  }, []);
  return theme;
}
