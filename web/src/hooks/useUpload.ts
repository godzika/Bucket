import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { filesystemKeys } from "@/hooks/useFilesystem";
import { collectFilesFromFileList } from "@/lib/collectFiles";
import {
  uploadQueue,
  type UploadItemSnapshot,
  type UploadItemStatus,
  type UploadSummary,
} from "@/lib/uploadQueue";

export type { UploadItemSnapshot as UploadItem, UploadItemStatus, UploadSummary };

const INVALIDATE_DEBOUNCE_MS = 1000;

function useDebouncedInvalidate() {
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidate = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ["files"] });
      void queryClient.invalidateQueries({ queryKey: filesystemKeys.all });
    }, INVALIDATE_DEBOUNCE_MS);
  }, [queryClient]);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    []
  );

  return invalidate;
}

export function useUpload(currentFolderId?: string | null) {
  const invalidateFiles = useDebouncedInvalidate();

  useEffect(() => {
    uploadQueue.setBaseFolderId(currentFolderId ?? null);
  }, [currentFolderId]);

  useEffect(() => {
    uploadQueue.setCallbacks({
      onInvalidate: invalidateFiles,
      onFirstError: (message) => toast.error(message),
    });
    return () => uploadQueue.setCallbacks({});
  }, [invalidateFiles]);

  const snapshot = useSyncExternalStore(
    (onStoreChange) => uploadQueue.subscribe(onStoreChange),
    () => uploadQueue.getSnapshot(),
    () => uploadQueue.getSnapshot()
  );

  const active = useMemo(
    () =>
      snapshot.items.filter(
        (item) =>
          item.status === "creating" ||
          item.status === "uploading" ||
          item.status === "completing"
      ),
    [snapshot.items]
  );

  const errors = useMemo(
    () => snapshot.items.filter((item) => item.status === "error"),
    [snapshot.items]
  );

  const doneRecent = useMemo(
    () => snapshot.items.filter((item) => item.status === "done").slice(-5),
    [snapshot.items]
  );

  const enqueue = useCallback(
    (files: FileList | File[]) => {
    const list = collectFilesFromFileList(files);
    if (list.length === 0) {
      toast.info("No files to upload (empty files and system files are skipped).");
      return;
    }
    const added = uploadQueue.enqueue(list, currentFolderId ?? null);
    if (added > 1) {
      toast.info(`Uploading ${added} files. Keep this tab open.`);
    }
  },
    [currentFolderId]
  );

  const remove = useCallback((id: string) => {
    uploadQueue.remove(id);
  }, []);

  const cancel = useCallback((id: string) => {
    uploadQueue.cancel(id);
  }, []);

  const retry = useCallback((id: string) => {
    uploadQueue.retry(id);
  }, []);

  const clearFinished = useCallback(() => {
    uploadQueue.clearFinished();
  }, []);

  return {
    summary: snapshot.summary,
    items: snapshot.items,
    active,
    errors,
    doneRecent,
    speedBytesPerSec: uploadQueue.getSpeedBytesPerSec(),
    enqueue,
    remove,
    cancel,
    retry,
    clearFinished,
  };
}
