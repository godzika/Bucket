import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createFolder,
  deleteFolder,
  listFilesystem,
  updateFolder,
  type FilesystemListing,
} from "@/lib/api/filesystem";

export const filesystemKeys = {
  all: ["filesystem"] as const,
  list: (folderId?: string | null) =>
    ["filesystem", "list", folderId ?? "root"] as const,
};

export function useFilesystemList(folderId?: string | null) {
  return useQuery({
    queryKey: filesystemKeys.list(folderId),
    queryFn: () => listFilesystem(folderId),
  });
}

export function useCreateFolder(currentFolderId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      createFolder({ parent_folder_id: currentFolderId ?? null, name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: filesystemKeys.all });
    },
  });
}

export function useDeleteFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (folderId: string) => deleteFolder(folderId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: filesystemKeys.all });
    },
  });
}

export function useRenameFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      updateFolder(folderId, { name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: filesystemKeys.all });
    },
  });
}

export type { FilesystemListing };
