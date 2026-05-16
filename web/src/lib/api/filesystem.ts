import { api } from "../axios";
import type { StoredFile } from "./files";

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  is_root: boolean;
  created_at: string;
}

export interface Breadcrumb {
  id: string;
  name: string;
  is_root: boolean;
}

export interface FilesystemListing {
  folder_id: string;
  root_folder_id: string;
  parent_folder_id: string | null;
  breadcrumbs: Breadcrumb[];
  folders: Folder[];
  files: StoredFile[];
}

export async function listFilesystem(folderId?: string | null): Promise<FilesystemListing> {
  const { data } = await api.get<FilesystemListing>("/api/filesystem", {
    params: folderId ? { folder_id: folderId } : undefined,
  });
  return data;
}

export async function getRootFolder(): Promise<Folder> {
  const { data } = await api.get<Folder>("/api/filesystem/root");
  return data;
}

export async function createFolder(input: {
  parent_folder_id?: string | null;
  name: string;
}): Promise<Folder> {
  const { data } = await api.post<Folder>("/api/filesystem/folders", input);
  return data;
}

export async function updateFolder(
  folderId: string,
  input: { name?: string; parent_folder_id?: string | null }
): Promise<Folder> {
  const { data } = await api.patch<Folder>(`/api/filesystem/folders/${folderId}`, input);
  return data;
}

export async function deleteFolder(folderId: string): Promise<void> {
  await api.delete(`/api/filesystem/folders/${folderId}`);
}

export async function ensureFolderPaths(
  parentFolderId: string | null | undefined,
  paths: string[][]
): Promise<string[]> {
  const { data } = await api.post<{ folder_ids: string[] }>(
    "/api/filesystem/folders/ensure-paths",
    {
      parent_folder_id: parentFolderId ?? null,
      paths,
    }
  );
  return data.folder_ids;
}
