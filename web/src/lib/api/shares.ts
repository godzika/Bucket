import { api } from "../axios";

export interface ShareLink {
  token: string;
  file_id: string;
  expires_at: string | null;
  password_protected: boolean;
  created_at: string;
}

export async function createShare(
  fileId: string,
  options: { expires_in_seconds?: number | null; password?: string | null } = {}
): Promise<ShareLink> {
  const body: Record<string, unknown> = {};
  if (options.expires_in_seconds != null) body.expires_in_seconds = options.expires_in_seconds;
  if (options.password) body.password = options.password;
  const { data } = await api.post<ShareLink>(`/api/files/${fileId}/shares`, body);
  return data;
}

export async function listShares(fileId: string): Promise<ShareLink[]> {
  const { data } = await api.get<ShareLink[]>(`/api/files/${fileId}/shares`);
  return data;
}

export async function deleteShare(fileId: string, token: string): Promise<void> {
  await api.delete(`/api/files/${fileId}/shares/${token}`);
}
