import { api } from "../../api/client";

/**
 * Per-user saved view presets. `config` is an opaque object owned by the calling
 * screen (the Dashboard stores {filter, query, sort, layout}); the API keeps it
 * verbatim. `surface` scopes a preset to one screen so the same store can serve
 * other views later.
 */
export interface SavedView {
  id: number;
  surface: string;
  name: string;
  config: Record<string, unknown>;
  created_at?: string;
}

interface Paginated<T> {
  results?: T[];
}

export async function listSavedViews(surface: string): Promise<SavedView[]> {
  const { data } = await api.get<Paginated<SavedView> | SavedView[]>(
    `/saved-views/?surface=${encodeURIComponent(surface)}`,
  );
  return Array.isArray(data) ? data : data.results ?? [];
}

export async function createSavedView(
  surface: string,
  name: string,
  config: Record<string, unknown>,
): Promise<SavedView> {
  const { data } = await api.post<SavedView>("/saved-views/", { surface, name, config });
  return data;
}

export async function deleteSavedView(id: number): Promise<void> {
  await api.delete(`/saved-views/${id}/`);
}
