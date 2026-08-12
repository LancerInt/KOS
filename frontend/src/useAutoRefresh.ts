import { useEffect, useRef } from "react";

/**
 * Keep a page's data live without a manual reload.
 *
 * Calls `refresh` on a timer, and again whenever the tab regains focus, so a
 * page left open (or switched back to) shows current data. It deliberately does
 * NOT fire while the tab is hidden — no point hammering the server for a screen
 * nobody's looking at — and fires once immediately on becoming visible again.
 *
 * Only use it on read-only / list screens. Do not attach it to a page with an
 * open form: a refresh mid-edit would throw away what the user is typing.
 *
 * The callback is held in a ref so passing a fresh inline function each render
 * doesn't restart the timer.
 */
export function useAutoRefresh(
  refresh: () => void,
  { intervalMs = 30000, enabled = true }: { intervalMs?: number; enabled?: boolean } = {},
) {
  const cb = useRef(refresh);
  cb.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    const tick = () => { if (document.visibilityState !== "hidden") cb.current(); };
    const onVisible = () => { if (document.visibilityState === "visible") cb.current(); };

    const timer = window.setInterval(tick, intervalMs);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, enabled]);
}
