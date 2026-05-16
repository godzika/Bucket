import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteFile, getDownloadUrl, getFile, listFiles } from "@/lib/api/files";
import {
  createShare,
  deleteShare,
  listShares,
  type ShareLink,
} from "@/lib/api/shares";

export const filesKeys = {
  all: ["files"] as const,
  detail: (id: string) => ["files", "detail", id] as const,
  shares: (id: string) => ["files", "shares", id] as const,
};

export function useFilesList() {
  return useQuery({
    queryKey: filesKeys.all,
    queryFn: () => listFiles({ limit: 100, offset: 0 }),
  });
}

export function useFile(id: string) {
  return useQuery({
    queryKey: filesKeys.detail(id),
    queryFn: () => getFile(id),
    enabled: Boolean(id),
  });
}

export function useShares(fileId: string) {
  return useQuery({
    queryKey: filesKeys.shares(fileId),
    queryFn: () => listShares(fileId),
    enabled: Boolean(fileId),
  });
}

export function useDeleteFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => deleteFile(fileId),
    onSuccess: async (_data, fileId) => {
      await queryClient.invalidateQueries({ queryKey: filesKeys.all });
      queryClient.removeQueries({ queryKey: filesKeys.detail(fileId) });
      queryClient.removeQueries({ queryKey: filesKeys.shares(fileId) });
    },
  });
}

export function useCreateShare(fileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { expires_in_seconds?: number | null; password?: string | null }) =>
      createShare(fileId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: filesKeys.shares(fileId) }),
  });
}

export function useDeleteShare(fileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => deleteShare(fileId, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: filesKeys.shares(fileId) }),
  });
}

export async function startDownload(fileId: string): Promise<void> {
  const { download_url } = await getDownloadUrl(fileId);
  window.location.href = download_url;
}

export type { ShareLink };
