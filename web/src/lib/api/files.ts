import { api } from "../axios";

export interface StoredFile {
  id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  status: "pending" | "ready" | "failed";
  created_at: string;
  expires_at: string | null;
}

export interface FileCreateResponse {
  file_id: string;
  object_key: string;
  upload_url: string;
  upload_method: "PUT";
  upload_headers: Record<string, string>;
  expires_in: number;
}

export interface FileDownloadResponse {
  download_url: string;
  expires_in: number;
}

export async function createFile(input: {
  filename: string;
  content_type: string;
  size_bytes: number;
}): Promise<FileCreateResponse> {
  const { data } = await api.post<FileCreateResponse>("/api/files", input);
  return data;
}

export async function completeFile(fileId: string): Promise<StoredFile> {
  const { data } = await api.post<StoredFile>(`/api/files/${fileId}/complete`);
  return data;
}

export async function listFiles(params: { limit?: number; offset?: number } = {}): Promise<
  StoredFile[]
> {
  const { data } = await api.get<StoredFile[]>("/api/files", { params });
  return data;
}

export async function getFile(fileId: string): Promise<StoredFile> {
  const { data } = await api.get<StoredFile>(`/api/files/${fileId}`);
  return data;
}

export async function getDownloadUrl(fileId: string): Promise<FileDownloadResponse> {
  const { data } = await api.get<FileDownloadResponse>(`/api/files/${fileId}/download`);
  return data;
}

export async function deleteFile(fileId: string): Promise<void> {
  await api.delete(`/api/files/${fileId}`);
}
