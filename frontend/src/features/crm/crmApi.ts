import { api } from "../../api/client";

interface Paginated<T> { results: T[]; }
const unwrap = <T>(data: Paginated<T> | T[]) =>
  (data as Paginated<T>).results ?? (data as T[]);

export type Stage = "lead" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
export type CustomerStatus = "lead" | "prospect" | "active" | "inactive";
export type CustomerType = "company" | "individual" | "government" | "distributor";

export interface Contact {
  id: number; customer: number; name: string; title: string;
  email: string; phone: string; is_primary: boolean; created_at: string;
}

export interface Customer {
  id: number; name: string; customer_type: CustomerType; status: CustomerStatus;
  industry: string; region: string; website: string; notes: string;
  owner: number | null; owner_name: string; contacts: Contact[];
  open_opportunities: number; pipeline_value: number; created_at: string;
}

export interface Opportunity {
  id: number; customer: number; customer_name: string; title: string;
  stage: Stage; stage_display: string; amount: number; currency: string;
  expected_close_date: string | null; owner: number | null; owner_name: string;
  source: string; notes: string; lost_reason: string; project: number | null;
  probability: number; weighted_amount: number; is_open: boolean; created_at: string;
}

export const listCustomers = () =>
  api.get<Paginated<Customer>>("/crm/customers/").then((r) => unwrap(r.data));
export const createCustomer = (payload: Partial<Customer>) =>
  api.post<Customer>("/crm/customers/", payload).then((r) => r.data);
export const updateCustomer = (id: number, payload: Partial<Customer>) =>
  api.patch<Customer>(`/crm/customers/${id}/`, payload).then((r) => r.data);

export const listOpportunities = () =>
  api.get<Paginated<Opportunity>>("/crm/opportunities/").then((r) => unwrap(r.data));
export const createOpportunity = (payload: Partial<Opportunity>) =>
  api.post<Opportunity>("/crm/opportunities/", payload).then((r) => r.data);
export const updateOpportunity = (id: number, payload: Partial<Opportunity>) =>
  api.patch<Opportunity>(`/crm/opportunities/${id}/`, payload).then((r) => r.data);
export const convertToProject = (id: number) =>
  api.post<{ project: number; code: string }>(`/crm/opportunities/${id}/convert_to_project/`, {}).then((r) => r.data);
