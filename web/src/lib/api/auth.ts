import { api } from "../axios";
import type { CurrentUser } from "../auth-store";

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export async function register(email: string, password: string): Promise<CurrentUser> {
  const { data } = await api.post<CurrentUser>("/api/auth/register", { email, password });
  return data;
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  const form = new URLSearchParams();
  form.set("username", email);
  form.set("password", password);
  const { data } = await api.post<TokenResponse>("/api/auth/login", form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return data;
}

export async function me(): Promise<CurrentUser> {
  const { data } = await api.get<CurrentUser>("/api/auth/me");
  return data;
}
