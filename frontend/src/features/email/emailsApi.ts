import { api } from "../../api/client";

// Sending + the sent log already exist on the AI outbound path — reuse them.
export {
  sendEmail, listSentEmails, resendEmail,
  type SendEmailPayload, type SentEmail,
} from "../ai/aiApi";

/** A colleague to suggest in a recipient picker. */
export interface Person {
  id: number;
  name: string;
  email: string;
}

export const listPeople = () => api.get<Person[]>("/auth/people/").then((r) => r.data);
