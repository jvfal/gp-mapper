import { useEffect, useState } from "react";

export function useMapFullscreen(ref) {
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const isFullscreen = nativeFullscreen || focusMode;

  useEffect(() => {
    const element = ref.current;
    const sync = () =>
      setNativeFullscreen(document.fullscreenElement === element);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      if (document.fullscreenElement === element)
        document.exitFullscreen().catch(() => {});
    };
  }, [ref]);

  useEffect(() => {
    if (!isFullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!focusMode) return;
    const escape = (event) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]"))
        setFocusMode(false);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [focusMode]);

  async function toggleFullscreen() {
    if (focusMode) {
      setFocusMode(false);
      return;
    }
    if (document.fullscreenElement === ref.current) {
      await document.exitFullscreen();
      return;
    }
    try {
      await ref.current.requestFullscreen();
    } catch {
      // Keep the editor usable when fullscreen is unavailable or disallowed.
      setFocusMode(true);
    }
  }

  return { isFullscreen, toggleFullscreen };
}
