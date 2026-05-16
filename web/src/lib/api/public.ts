import axios from "axios";

import { api } from "../axios";

export interface ShareInfo {
  filename: string;
  content_type: string;
  size_bytes: number;
  password_protected: boolean;
  expires_at: string | null;
}

export interface PublicDownloadResponse {
  download_url: string;
  expires_in: number;
}

// Public endpoints don't need our auth interceptor; use a clean axios instance.
const publicClient = axios.create({
  baseURL: api.defaults.baseURL,
  timeout: 30_000,
});

export async function getShareInfo(token: string): Promise<ShareInfo> {
  const { data } = await publicClient.get<ShareInfo>(`/api/public/${token}`);
  return data;
}

export async function requestPublicDownload(
  token: string,
  password?: string | null
): Promise<PublicDownloadResponse> {
  const { data } = await publicClient.post<PublicDownloadResponse>(
    `/api/public/${token}/download`,
    password ? { password } : {}
  );
  return data;
}
