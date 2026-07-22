import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const DESKTOP_MAX_TEXTAREA_HEIGHT = 360;

type UseComposerInputLayoutArgs = {
  isExpanded: boolean;
  text: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

export function useComposerInputLayout({
  isExpanded,
  text,
  textareaRef,
}: UseComposerInputLayoutArgs) {
  const [isPhoneLayout, setIsPhoneLayout] = useState(false);
  const [isPhoneTallInput, setIsPhoneTallInput] = useState(false);
  const syncHeightRef = useRef<(() => void) | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const appRoot = textarea.closest(".app");
    if (!(appRoot instanceof HTMLElement)) {
      setIsPhoneLayout(false);
      return;
    }

    const syncLayout = () => {
      const nextIsPhoneLayout = appRoot.classList.contains("layout-phone");
      setIsPhoneLayout((prev) => (prev === nextIsPhoneLayout ? prev : nextIsPhoneLayout));
    };

    syncLayout();
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.attributeName === "class")) {
        syncLayout();
      }
    });
    observer.observe(appRoot, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
    };
  }, [textareaRef]);

  const computeSyncHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const wrapper = textarea.closest<HTMLElement>(".composer-lexical-wrap");
    const editor = wrapper?.querySelector<HTMLElement>(".composer-lexical-editor");
    const minTextareaHeight = isExpanded ? (isPhoneLayout ? 152 : 180) : isPhoneLayout ? 52 : 22;
    const maxTextareaHeight = isPhoneLayout
      ? isExpanded
        ? 280
        : 168
      : DESKTOP_MAX_TEXTAREA_HEIGHT;

    textarea.style.minHeight = `${minTextareaHeight}px`;
    textarea.style.maxHeight = `${maxTextareaHeight}px`;
    textarea.style.height = `${minTextareaHeight}px`;
    wrapper?.style.setProperty("min-height", `${minTextareaHeight}px`);
    wrapper?.style.setProperty("max-height", `${maxTextareaHeight}px`);
    wrapper?.style.setProperty("height", `${minTextareaHeight}px`);

    // When the composer has just been cleared, relying on Lexical's scrollHeight
    // can briefly preserve the old expanded height on slower layout/update paths.
    if (text.length === 0) {
      textarea.style.overflowY = "hidden";
      editor?.style.setProperty("overflow-y", "hidden");
      if (isPhoneLayout) {
        setIsPhoneTallInput((prev) => (prev ? false : prev));
      }
      return;
    }

    editor?.style.setProperty("overflow-y", "hidden");
    const measuredScrollHeight = editor?.scrollHeight ?? textarea.scrollHeight;
    const nextHeight = Math.min(
      Math.max(measuredScrollHeight, minTextareaHeight),
      maxTextareaHeight,
    );
    textarea.style.height = `${nextHeight}px`;
    wrapper?.style.setProperty("height", `${nextHeight}px`);
    const isOverflowing = measuredScrollHeight > maxTextareaHeight;
    textarea.style.overflowY = isOverflowing ? "auto" : "hidden";
    editor?.style.setProperty("overflow-y", isOverflowing ? "auto" : "hidden");

    if (!isPhoneLayout) {
      setIsPhoneTallInput((prev) => (prev ? false : prev));
      return;
    }

    const computedStyle = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 20;
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
    const contentHeight = Math.max(0, nextHeight - paddingTop - paddingBottom);
    const estimatedLineCount = contentHeight / lineHeight;
    const nextIsPhoneTallInput = estimatedLineCount > 2.25;
    setIsPhoneTallInput((prev) => (prev === nextIsPhoneTallInput ? prev : nextIsPhoneTallInput));
  }, [isExpanded, isPhoneLayout, text, textareaRef]);

  syncHeightRef.current = computeSyncHeight;

  const scheduleSyncHeight = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      syncHeightRef.current?.();
    });
  }, []);

  useLayoutEffect(() => {
    syncHeightRef.current?.();
    scheduleSyncHeight();
  }, [scheduleSyncHeight, text]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const wrapper = textarea.closest<HTMLElement>(".composer-lexical-wrap");
    const editor = wrapper?.querySelector<HTMLElement>(".composer-lexical-editor");

    const triggerSync = () => {
      syncHeightRef.current?.();
      scheduleSyncHeight();
    };

    if (!wrapper || typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", triggerSync);
      return () => {
        window.removeEventListener("resize", triggerSync);
      };
    }

    const resizeObserver = new ResizeObserver(triggerSync);
    resizeObserver.observe(wrapper);
    if (editor) {
      resizeObserver.observe(editor);
    }
    window.addEventListener("resize", triggerSync);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", triggerSync);
    };
  }, [isExpanded, isPhoneLayout, scheduleSyncHeight, textareaRef]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return { isPhoneLayout, isPhoneTallInput };
}
