import { useEffect, useState } from "react";

import { queueSize } from "./queue";
import { flushQueue } from "./sync";

/** Online status + pending-op count, auto-flushing on reconnect (PRD §25). */
export function useOffline() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(queueSize());

  useEffect(() => {
    const refresh = () => setPending(queueSize());
    const goOnline = () => {
      setOnline(true);
      flushQueue().then(refresh);
    };
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("kos-queue-changed", refresh);
    window.addEventListener("kos-synced", refresh);

    if (navigator.onLine) flushQueue().then(refresh);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("kos-queue-changed", refresh);
      window.removeEventListener("kos-synced", refresh);
    };
  }, []);

  const syncNow = async () => {
    await flushQueue();
    setPending(queueSize());
  };

  return { online, pending, syncNow };
}
