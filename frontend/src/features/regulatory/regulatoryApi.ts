import { api } from "../../api/client";

interface Paginated<T> { results: T[]; }
const unwrap = <T>(data: Paginated<T> | T[]) =>
  (data as Paginated<T>).results ?? (data as T[]);

export type RegStatus =
  | "draft" | "submitted" | "under_review" | "query_raised"
  | "approved" | "rejected" | "renewal_due" | "expired";
export type Authority = "cibrc" | "epa" | "state" | "other";

export interface Registration {
  id: number;
  product_name: string;
  registration_number: string;
  authority: Authority;
  authority_display: string;
  category: string;
  status: RegStatus;
  status_display: string;
  owner: number | null;
  owner_name: string;
  project: number | null;
  documents: number[];
  document_titles: { id: number; title: string }[];
  submission_date: string | null;
  approval_date: string | null;
  expiry_date: string | null;
  reminder_lead_days: number;
  is_expired: boolean;
  expires_in_days: number | null;
  next_stages: RegStatus[];
  notes: string;
  created_at: string;
}

export const listRegistrations = () =>
  api.get<Paginated<Registration>>("/regulatory/registrations/").then((r) => unwrap(r.data));

export const createRegistration = (payload: Partial<Registration>) =>
  api.post<Registration>("/regulatory/registrations/", payload).then((r) => r.data);

export const updateRegistration = (id: number, payload: Partial<Registration>) =>
  api.patch<Registration>(`/regulatory/registrations/${id}/`, payload).then((r) => r.data);

export const transitionRegistration = (id: number, to: RegStatus) =>
  api.post<Registration>(`/regulatory/registrations/${id}/transition/`, { to }).then((r) => r.data);
