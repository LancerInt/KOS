import { api } from "../../api/client";
import type { CurrentUser, LoginResult } from "./types";

export async function loginRequest(
  username: string,
  password: string,
  otp?: string,
): Promise<LoginResult> {
  const { data } = await api.post<LoginResult>("/auth/login/", { username, password, otp });
  return data;
}

export async function fetchMe(): Promise<CurrentUser> {
  const { data } = await api.get<CurrentUser>("/auth/me/");
  return data;
}

export async function logoutRequest(refresh: string): Promise<void> {
  await api.post("/auth/logout/", { refresh });
}

export async function mfaSetup(): Promise<{ secret: string; otpauth_uri: string }> {
  const { data } = await api.post("/auth/mfa/setup/");
  return data;
}

export async function mfaVerify(code: string): Promise<void> {
  await api.post("/auth/mfa/verify/", { code });
}
