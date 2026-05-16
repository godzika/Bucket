import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { completeFile, createFile } from "@/lib/api/files";
import { apiErrorMessage } from "@/lib/axios";

export interface UploadItem {
  id: string;
  file: File;
  fileId: string | null;
  status: "queued" | "creating" | "uploading" | "completing" | "done" | "error";
  progress: number;
  error: string | null;
}

let nextId = 0;
function makeId(): string {
  nextId += 1;
  return `${Date.now()}-${nextId}`;
}

export function useUpload() {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef<UploadItem[]>([]);
  itemsRef.current = items;

  const patch = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => {
    setItems((current) => current.filter((item) => item.status === "uploading" || item.status === "creating" || item.status === "completing"));
  }, []);

  const uploadOne = useCallback(
    async (item: UploadItem) => {
      try {
        patch(item.id, { status: "creating", progress: 0 });
        const created = await createFile({
          filename: item.file.name,
          content_type: item.file.type || "application/octet-stream",
          size_bytes: item.file.size,
        });
        patch(item.id, { status: "uploading", fileId: created.file_id });

        await axios.put(created.upload_url, item.file, {
          headers: created.upload_headers,
          onUploadProgress: (event) => {
            if (!event.total) return;
            const pct = Math.round((event.loaded / event.total) * 100);
            patch(item.id, { progress: pct });
          },
          // Bypass any global default that adds auth headers.
          transformRequest: [(data) => data],
        });

        patch(item.id, { status: "completing", progress: 100 });
        await completeFile(created.file_id);
        patch(item.id, { status: "done" });
        await queryClient.invalidateQueries({ queryKey: ["files"] });
      } catch (err) {
        patch(item.id, { status: "error", error: apiErrorMessage(err, "Upload failed") });
      }
    },
    [patch, queryClient]
  );

  const enqueue = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const newItems: UploadItem[] = list.map((file) => ({
        id: makeId(),
        file,
        fileId: null,
        status: "queued",
        progress: 0,
        error: null,
      }));
      setItems((current) => [...newItems, ...current]);
      // Fire-and-forget; UI tracks state.
      for (const item of newItems) {
        void uploadOne(item);
      }
    },
    [uploadOne]
  );

  return { items, enqueue, remove, clear };
}
