import { api } from "../axios";

export interface StoredFile {
  id: string;
  parent_folder_id: string | null;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  status: "pending" | "ready" | "failed";
  created_at: string;
  expires_at: string | null;
}

interface FileCreateBase {
  file_id: string;
  object_key: string;
  expires_in: number;
}

export interface FileCreatePutResponse extends FileCreateBase {
  upload_method: "PUT";
  upload_url: string;
  upload_headers: Record<string, string>;
}

export interface FileCreateMultipartResponse extends FileCreateBase {
  upload_method: "multipart";
  part_size_bytes: number;
  total_parts: number;
}

export type FileCreateResponse = FileCreatePutResponse | FileCreateMultipartResponse;

export interface MultipartPartComplete {
  part_number: number;
  etag: string;
}

export interface UploadPartPresign {
  part_number: number;
  upload_url: string;
  upload_headers: Record<string, string>;
}

export interface FileDownloadResponse {
  download_url: string;
  expires_in: number;
}

const PRESIGN_BATCH = 16;

export async function createFile(input: {
  filename: string;
  content_type: string;
  size_bytes: number;
}): Promise<FileCreateResponse> {
  const { data } = await api.post<FileCreateResponse>("/api/files", input);
  return data;
}

export async function createFilesBatch(
  items: Array<{
    filename: string;
    parent_folder_id?: string | null;
    content_type: string;
    size_bytes: number;
  }>
): Promise<FileCreateResponse[]> {
  const { data } = await api.post<{ items: FileCreateResponse[] }>("/api/files/batch", {
    items,
  });
  return data.items;
}

export async function presignUploadParts(
  fileId: string,
  partNumbers: number[]
): Promise<UploadPartPresign[]> {
  const { data } = await api.post<{ parts: UploadPartPresign[] }>(
    `/api/files/${fileId}/upload-parts`,
    { part_numbers: partNumbers }
  );
  return data.parts;
}

export async function completeFile(
  fileId: string,
  parts?: MultipartPartComplete[]
): Promise<StoredFile> {
  const { data } = await api.post<StoredFile>(`/api/files/${fileId}/complete`, {
    parts: parts ?? [],
  });
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

export { PRESIGN_BATCH };
