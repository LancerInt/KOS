import { useEffect, useState } from "react";
import { api } from "../../api/client";

export type WsAccess = "view" | "edit";
export interface MyAccess {
  is_admin: boolean;
  access: Record<string, WsAccess>;
}

// Cache the current user's access for the session so the sidebar and every
// workspace page share one request. Cleared on a hard reload.
let cache: Promise<MyAccess> | null = null;

export function fetchMyAccess(force = false): Promise<MyAccess> {
  if (!cache || force) cache = api.get<MyAccess>("/workspace-permissions/mine/").then((r) => r.data);
  return cache;
}

export function clearMyAccessCache() {
  cache = null;
}

export type AccessLevel = "none" | "view" | "edit";

export function accessLevel(mine: MyAccess | null, ws: string): AccessLevel {
  if (!mine) return "none";
  if (mine.is_admin) return "edit";
  return mine.access[ws] ?? "none";
}

/** Hook: the current user's workspace access map (with an admin bypass flag). */
export function useMyAccess(): { loading: boolean; mine: MyAccess | null } {
  const [mine, setMine] = useState<MyAccess | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetchMyAccess()
      .then((m) => { if (alive) { setMine(m); setLoading(false); } })
      .catch(() => { if (alive) { setMine({ is_admin: false, access: {} }); setLoading(false); } });
    return () => { alive = false; };
  }, []);
  return { loading, mine };
}
