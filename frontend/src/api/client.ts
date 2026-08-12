import axios, { type AxiosRequestConfig } from "axios";

/**
 * Central API client. Injects the JWT access token and transparently refreshes
 * it (with rotation) on a 401, replaying the original request once (PRD §32).
 */

const ACCESS_KEY = "kos_access";
const REFRESH_KEY = "kos_refresh";

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh?: string) {
    localStorage.setItem(ACCESS_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

const baseURL = import.meta.env.VITE_API_BASE_URL ?? "/api";

// No default Content-Type: axios sets "application/json" for plain objects and
// "multipart/form-data" (with the correct boundary) for FormData uploads.
export const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as AxiosRequestConfig & { _retry?: boolean };
    const status = error.response?.status;

    if (status === 401 && original && !original._retry && tokenStore.refresh) {
      original._retry = true;
      try {
        if (!refreshing) {
          refreshing = axios
            .post(`${baseURL}/auth/refresh/`, { refresh: tokenStore.refresh })
            .then((res) => {
              tokenStore.set(res.data.access, res.data.refresh);
              return res.data.access as string;
            });
        }
        const newAccess = await refreshing;
        refreshing = null;
        original.headers = { ...original.headers, Authorization: `Bearer ${newAccess}` };
        return api(original);
      } catch (refreshError) {
        refreshing = null;
        tokenStore.clear();
        if (window.location.pathname !== "/login") window.location.assign("/login");
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  },
);

/**
 * Pull every row from a DRF-paginated list endpoint, following `next` by page
 * number until it runs out. Also handles endpoints that return a bare array
 * (no pagination). Bounded so a runaway can't loop forever.
 *
 * Used where the UI needs the whole set to bucket/filter it (e.g. Notifications
 * split into "Needs action" vs "Recent updates") and then pages it client-side.
 */
export async function fetchAll<T>(
  path: string,
  params: Record<string, unknown> = {},
  maxPages = 40,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await api.get(path, { params: { ...params, page } });
    if (Array.isArray(data)) return data as T[]; // endpoint isn't paginated
    out.push(...((data.results ?? []) as T[]));
    if (!data.next) break;
  }
  return out;
}

export interface HealthResponse {
  service: string;
  status: string;
  database: string;
  version: string;
}

export async function getHealth(): Promise<HealthResponse> {
  const { data } = await api.get<HealthResponse>("/health/");
  return data;
}
