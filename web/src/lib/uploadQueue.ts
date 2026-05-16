import {
  completeFile,
  createFilesBatch,
  deleteFile,
  type FileCreateMultipartResponse,
  type FileCreateResponse,
  type MultipartPartComplete,
  PRESIGN_BATCH,
  presignUploadParts,
} from "@/lib/api/files";
import { apiErrorMessage } from "@/lib/axios";
import { uploadPathParts } from "@/lib/collectFiles";
import { ensureFolderPaths } from "@/lib/api/filesystem";
import { putWithRetry } from "@/lib/uploadClient";

export const MAX_PARALLEL_UPLOADS = 4;
export const BATCH_CREATE_SIZE = 50;

export type UploadItemStatus =
  | "queued"
  | "creating"
  | "uploading"
  | "completing"
  | "done"
  | "error"
  | "cancelled";

export interface UploadItemSnapshot {
  id: string;
  displayName: string;
  status: UploadItemStatus;
  progress: number;
  error: string | null;
  sizeBytes: number;
  uploadedBytes: number;
}

export interface UploadSummary {
  total: number;
  queued: number;
  active: number;
  done: number;
  error: number;
  cancelled: number;
  totalBytes: number;
  uploadedBytes: number;
  overallProgress: number;
}

export interface UploadQueueSnapshot {
  items: UploadItemSnapshot[];
  summary: UploadSummary;
}

type Listener = () => void;

interface InternalEntry {
  id: string;
  file: File;
  displayName: string;
  basename: string;
  folderSegments: string[];
  targetParentFolderId: string | null;
  status: UploadItemStatus;
  progress: number;
  error: string | null;
  fileId: string | null;
  createOut: FileCreateResponse | null;
  abortController: AbortController | null;
  bytesUploaded: number;
}

let nextId = 0;
function makeId(): string {
  nextId += 1;
  return `u-${Date.now()}-${nextId}`;
}

function etagFromResponse(headers: Record<string, string | undefined>): string {
  const raw = headers.etag ?? headers.ETag;
  if (!raw) throw new Error("Storage did not return an ETag for uploaded part");
  return raw;
}

function isActiveStatus(status: UploadItemStatus): boolean {
  return status === "creating" || status === "uploading" || status === "completing";
}

export class UploadQueue {
  private entries = new Map<string, InternalEntry>();
  private listeners = new Set<Listener>();
  private snapshot: UploadQueueSnapshot = { items: [], summary: emptySummary() };
  private snapshotDirty = true;
  private notifyScheduled = false;
  private pumpRunning = false;
  private activeSlots = 0;
  private waiters: Array<() => void> = [];
  private onInvalidate: (() => void) | null = null;
  private onFirstError: ((message: string) => void) | null = null;
  private errorToastShown = false;
  private speedBytes = 0;
  private speedSampleAt = 0;
  private speedSampleUploaded = 0;
  private baseFolderId: string | null = null;

  setBaseFolderId(folderId: string | null) {
    this.baseFolderId = folderId;
  }

  setCallbacks(callbacks: { onInvalidate?: () => void; onFirstError?: (msg: string) => void }) {
    this.onInvalidate = callbacks.onInvalidate ?? null;
    this.onFirstError = callbacks.onFirstError ?? null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): UploadQueueSnapshot {
    if (this.snapshotDirty) {
      this.snapshot = this.buildSnapshot();
      this.snapshotDirty = false;
    }
    return this.snapshot;
  }

  enqueue(files: File[], baseFolderId?: string | null): number {
    const base = baseFolderId ?? this.baseFolderId;
    let added = 0;
    for (const file of files) {
      const parts = uploadPathParts(file);
      const id = makeId();
      this.entries.set(id, {
        id,
        file,
        displayName: parts.displayName,
        basename: parts.basename,
        folderSegments: parts.folderSegments,
        targetParentFolderId: base,
        status: "queued",
        progress: 0,
        error: null,
        fileId: null,
        createOut: null,
        abortController: null,
        bytesUploaded: 0,
      });
      added += 1;
    }
    if (added > 0) {
      this.errorToastShown = false;
      this.markDirty();
      void this.ensurePump();
    }
    return added;
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (isActiveStatus(entry.status)) {
      this.cancel(id);
      return;
    }
    this.entries.delete(id);
    this.markDirty();
  }

  clearFinished(): void {
    for (const [id, entry] of this.entries) {
      if (entry.status === "done" || entry.status === "error" || entry.status === "cancelled") {
        this.entries.delete(id);
      }
    }
    this.markDirty();
  }

  cancel(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.abortController?.abort();
    entry.status = "cancelled";
    entry.error = null;
    this.markDirty();
  }

  retry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.status !== "error") return;
    entry.status = "queued";
    entry.progress = 0;
    entry.error = null;
    entry.bytesUploaded = 0;
    entry.createOut = null;
    entry.fileId = null;
    entry.abortController = null;
    this.markDirty();
    void this.ensurePump();
  }

  private markDirty(): void {
    this.snapshotDirty = true;
    this.scheduleNotify();
  }

  private scheduleNotify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    requestAnimationFrame(() => {
      this.notifyScheduled = false;
      this.updateSpeedSample();
      for (const listener of this.listeners) {
        listener();
      }
    });
  }

  private updateSpeedSample(): void {
    const now = Date.now();
    const uploaded = this.snapshotDirty
      ? this.computeUploadedBytes()
      : this.snapshot.summary.uploadedBytes;
    if (this.speedSampleAt === 0) {
      this.speedSampleAt = now;
      this.speedSampleUploaded = uploaded;
      this.speedBytes = 0;
      return;
    }
    const dt = (now - this.speedSampleAt) / 1000;
    if (dt >= 0.25) {
      this.speedBytes = Math.max(0, (uploaded - this.speedSampleUploaded) / dt);
      this.speedSampleAt = now;
      this.speedSampleUploaded = uploaded;
    }
  }

  getSpeedBytesPerSec(): number {
    return this.speedBytes;
  }

  private computeUploadedBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === "done") {
        total += entry.file.size;
      } else {
        total += entry.bytesUploaded;
      }
    }
    return total;
  }

  private buildSnapshot(): UploadQueueSnapshot {
    const items: UploadItemSnapshot[] = [];
    let queued = 0;
    let active = 0;
    let done = 0;
    let error = 0;
    let cancelled = 0;
    let totalBytes = 0;
    let uploadedBytes = 0;

    for (const entry of this.entries.values()) {
      items.push({
        id: entry.id,
        displayName: entry.displayName,
        status: entry.status,
        progress: entry.progress,
        error: entry.error,
        sizeBytes: entry.file.size,
        uploadedBytes: entry.bytesUploaded,
      });
      totalBytes += entry.file.size;
      if (entry.status === "done") {
        done += 1;
        uploadedBytes += entry.file.size;
      } else if (entry.status === "error") {
        error += 1;
        uploadedBytes += entry.bytesUploaded;
      } else if (entry.status === "cancelled") {
        cancelled += 1;
      } else if (entry.status === "queued" && !entry.createOut) {
        queued += 1;
      } else if (isActiveStatus(entry.status) || (entry.status === "queued" && entry.createOut)) {
        active += 1;
        uploadedBytes += entry.bytesUploaded;
      }
    }

    const total = items.length;
    const overallProgress =
      totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0;

    return {
      items,
      summary: {
        total,
        queued,
        active,
        done,
        error,
        cancelled,
        totalBytes,
        uploadedBytes,
        overallProgress,
      },
    };
  }

  private async ensurePump(): Promise<void> {
    if (this.pumpRunning) return;
    this.pumpRunning = true;
    try {
      while (this.hasPendingWork()) {
        await this.runBatchCreates();
        this.startUploads();
        await this.sleep(25);
      }
    } finally {
      this.pumpRunning = false;
      if (this.hasPendingWork()) {
        void this.ensurePump();
      }
    }
  }

  private hasPendingWork(): boolean {
    for (const entry of this.entries.values()) {
      if (entry.status === "cancelled" || entry.status === "done" || entry.status === "error") {
        continue;
      }
      if (entry.status === "queued") return true;
      if (isActiveStatus(entry.status)) return true;
    }
    return this.activeSlots > 0;
  }

  private async runBatchCreates(): Promise<void> {
    const pending = [...this.entries.values()].filter(
      (e) => e.status === "queued" && !e.createOut && !e.fileId
    );
    if (pending.length === 0) return;

    const batch = pending.slice(0, BATCH_CREATE_SIZE);
    for (const entry of batch) {
      entry.status = "creating";
    }
    this.markDirty();

    try {
      const folderIds = await ensureFolderPaths(
        batch[0]?.targetParentFolderId ?? this.baseFolderId,
        batch.map((e) => e.folderSegments)
      );
      const results = await createFilesBatch(
        batch.map((e, index) => ({
          filename: e.basename,
          parent_folder_id: folderIds[index],
          content_type: e.file.type || "application/octet-stream",
          size_bytes: e.file.size,
        }))
      );
      for (let i = 0; i < batch.length; i += 1) {
        const entry = batch[i];
        const created = results[i];
        if (!created) continue;
        entry.createOut = created;
        entry.fileId = created.file_id;
        entry.status = "queued";
      }
    } catch (err) {
      const message = apiErrorMessage(err, "Failed to prepare uploads");
      for (const entry of batch) {
        if (entry.status === "creating") {
          entry.status = "error";
          entry.error = message;
          this.notifyFirstError(message);
        }
      }
    }
    this.markDirty();
  }

  private startUploads(): void {
    while (this.activeSlots < MAX_PARALLEL_UPLOADS) {
      const next = [...this.entries.values()].find(
        (e) => e.status === "queued" && e.createOut && e.fileId
      );
      if (!next) break;
      next.status = "uploading";
      next.abortController = new AbortController();
      this.activeSlots += 1;
      void this.uploadEntry(next).finally(() => {
        this.activeSlots = Math.max(0, this.activeSlots - 1);
        const waiter = this.waiters.shift();
        if (waiter) waiter();
        void this.ensurePump();
      });
    }
  }

  private async uploadEntry(entry: InternalEntry): Promise<void> {
    const signal = entry.abortController?.signal;
    if (!entry.createOut || !entry.fileId) return;

    try {
      if (signal?.aborted) {
        entry.status = "cancelled";
        return;
      }

      const created = entry.createOut;
      const onProgress = (pct: number, loaded: number) => {
        entry.progress = pct;
        entry.bytesUploaded = loaded;
        this.markDirty();
      };

      if (created.upload_method === "multipart") {
        const parts = await this.uploadMultipart(entry, created, onProgress, signal);
        if (signal?.aborted) {
          entry.status = "cancelled";
          return;
        }
        entry.status = "completing";
        entry.progress = 100;
        this.markDirty();
        await completeFile(entry.fileId, parts);
      } else {
        await this.uploadSinglePut(entry, created, onProgress, signal);
        if (signal?.aborted) {
          entry.status = "cancelled";
          return;
        }
        entry.status = "completing";
        entry.progress = 100;
        entry.bytesUploaded = entry.file.size;
        this.markDirty();
        await completeFile(entry.fileId);
      }

      entry.status = "done";
      entry.progress = 100;
      entry.bytesUploaded = entry.file.size;
      this.onInvalidate?.();
    } catch (err) {
      if (
        signal?.aborted ||
        (err instanceof Error &&
          (err.name === "CanceledError" || err.name === "AbortError"))
      ) {
        entry.status = "cancelled";
        return;
      }
      const fileId = entry.fileId;
      if (fileId) {
        try {
          await deleteFile(fileId);
          this.onInvalidate?.();
        } catch {
          // best-effort
        }
      }
      const message = apiErrorMessage(err, "Upload failed");
      entry.status = "error";
      entry.error = message.includes("Network Error")
        ? `${message} — check connection and keep this tab open`
        : message;
      this.notifyFirstError(message);
    } finally {
      entry.abortController = null;
      this.markDirty();
    }
  }

  private async uploadSinglePut(
    entry: InternalEntry,
    created: FileCreateResponse,
    onProgress: (pct: number, loaded: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (created.upload_method !== "PUT") {
      throw new Error("Expected single PUT upload");
    }
    await putWithRetry(created.upload_url, entry.file, {
      headers: created.upload_headers,
      signal,
      onUploadProgress: (event) => {
        if (!event.total) return;
        const loaded = event.loaded ?? 0;
        onProgress(Math.round((loaded / event.total) * 100), loaded);
      },
      transformRequest: [(data) => data],
    });
  }

  private async uploadMultipart(
    entry: InternalEntry,
    created: FileCreateMultipartResponse,
    onProgress: (pct: number, loaded: number) => void,
    signal?: AbortSignal
  ): Promise<MultipartPartComplete[]> {
    const partSize = created.part_size_bytes;
    const totalParts = created.total_parts;
    const completed: MultipartPartComplete[] = [];
    let uploadedBytes = 0;

    for (let batchStart = 1; batchStart <= totalParts; batchStart += PRESIGN_BATCH) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const batchEnd = Math.min(batchStart + PRESIGN_BATCH - 1, totalParts);
      const partNumbers: number[] = [];
      for (let n = batchStart; n <= batchEnd; n += 1) {
        partNumbers.push(n);
      }
      const presignedParts = await presignUploadParts(created.file_id, partNumbers);
      for (const part of presignedParts) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const index = part.part_number - 1;
        const begin = index * partSize;
        const end = Math.min(begin + partSize, entry.file.size);
        const chunk = entry.file.slice(begin, end);
        const chunkBytes = chunk.size;
        const response = await putWithRetry(part.upload_url, chunk, {
          headers: part.upload_headers,
          signal,
          transformRequest: [(data) => data],
          onUploadProgress: (event) => {
            const loaded = uploadedBytes + (event.loaded ?? 0);
            onProgress(Math.min(99, Math.round((loaded / entry.file.size) * 100)), loaded);
          },
        });
        uploadedBytes += chunkBytes;
        onProgress(Math.min(99, Math.round((uploadedBytes / entry.file.size) * 100)), uploadedBytes);
        completed.push({
          part_number: part.part_number,
          etag: etagFromResponse(response.headers as Record<string, string | undefined>),
        });
      }
    }
    return completed;
  }

  private notifyFirstError(message: string): void {
    if (!this.errorToastShown) {
      this.errorToastShown = true;
      this.onFirstError?.(message);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function emptySummary(): UploadSummary {
  return {
    total: 0,
    queued: 0,
    active: 0,
    done: 0,
    error: 0,
    cancelled: 0,
    totalBytes: 0,
    uploadedBytes: 0,
    overallProgress: 0,
  };
}

export const uploadQueue = new UploadQueue();
