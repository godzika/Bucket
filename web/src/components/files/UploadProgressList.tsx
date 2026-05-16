import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, RotateCcw, X, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type { UploadItem, UploadSummary } from "@/hooks/useUpload";
import { cn, formatBytes } from "@/lib/utils";

const MAX_ACTIVE_ROWS = 8;
const MAX_ERROR_ROWS = 5;
const VIRTUAL_ROW_HEIGHT = 44;

interface Props {
  summary: UploadSummary;
  active: UploadItem[];
  errors: UploadItem[];
  doneRecent: UploadItem[];
  speedBytesPerSec: number;
  onRemove: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onClearFinished: () => void;
  allItems: UploadItem[];
}

export function UploadProgressList({
  summary,
  active,
  errors,
  doneRecent,
  speedBytesPerSec,
  onRemove,
  onCancel,
  onRetry,
  onClearFinished,
  allItems,
}: Props) {
  if (summary.total === 0) return null;

  const queuedOverflow = Math.max(0, summary.queued - Math.max(0, MAX_ACTIVE_ROWS - active.length));
  const visibleActive = active.slice(0, MAX_ACTIVE_ROWS);
  const activeOverflow = Math.max(0, active.length - visibleActive.length) + queuedOverflow;
  const visibleErrors = errors.slice(0, MAX_ERROR_ROWS);
  const errorOverflow = Math.max(0, errors.length - visibleErrors.length);
  const hasFinished = summary.done > 0 || summary.error > 0 || summary.cancelled > 0;
  const speedLabel = speedBytesPerSec > 0 ? `${formatBytes(speedBytesPerSec)}/s` : "—";

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 w-full max-w-sm">
      <UploadPanel>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">
              Uploaded {summary.done} of {summary.total} · {summary.overallProgress}% ·{" "}
              {speedLabel}
            </span>
            {summary.active > 0 && (
              <span className="text-muted-foreground">{summary.active} active</span>
            )}
          </div>
          <Progress value={summary.overallProgress} className="h-2" />
        </div>

        {visibleActive.length > 0 && (
          <div className="mt-3 space-y-2">
            {visibleActive.map((item) => (
              <ActiveRow key={item.id} item={item} onCancel={onCancel} />
            ))}
            {activeOverflow > 0 && (
              <p className="text-xs text-muted-foreground">+{activeOverflow} more in queue</p>
            )}
          </div>
        )}

        {doneRecent.map((item) => (
          <DoneRow key={item.id} item={item} onRemove={onRemove} />
        ))}

        {visibleErrors.map((item) => (
          <ErrorRow key={item.id} item={item} onRetry={onRetry} onRemove={onRemove} />
        ))}
        {errorOverflow > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">+{errorOverflow} more failed</p>
        )}

        <UploadFooter>
          <ShowAllDialog items={allItems} onRetry={onRetry} onCancel={onCancel} />
          {hasFinished && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onClearFinished}
            >
              Clear done
            </Button>
          )}
        </UploadFooter>
      </UploadPanel>
    </div>
  );
}

function UploadPanel({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-auto rounded-lg border bg-card/95 p-3 shadow-md backdrop-blur">
      {children}
    </div>
  );
}

function UploadFooter({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex items-center justify-between gap-2">{children}</div>;
}

function ActiveRow({
  item,
  onCancel,
}: {
  item: UploadItem;
  onCancel: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-background/50 px-2 py-1.5">
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
      <RowBody item={item} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={() => onCancel(item.id)}
        aria-label="Cancel upload"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function DoneRow({
  item,
  onRemove,
}: {
  item: UploadItem;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      <span className="min-w-0 flex-1 truncate" title={item.displayName}>
        {item.displayName}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={() => onRemove(item.id)}
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

function ErrorRow({
  item,
  onRetry,
  onRemove,
}: {
  item: UploadItem;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5">
      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={item.displayName}>
          {item.displayName}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs text-destructive">{item.error}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-1 h-6 px-2 text-xs"
          onClick={() => onRetry(item.id)}
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          Retry
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={() => onRemove(item.id)}
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

function RowBody({ item }: { item: UploadItem }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs font-medium" title={item.displayName}>
        {item.displayName}
      </p>
      <p className="text-xs text-muted-foreground">{labelForStatus(item)}</p>
      <Progress value={item.progress} className="mt-1 h-1.5" />
    </div>
  );
}

function ShowAllDialog({
  items,
  onRetry,
  onCancel,
}: {
  items: UploadItem[];
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs">
          Show all ({items.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-md overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>All uploads</DialogTitle>
        </DialogHeader>
        <VirtualizedUploadList items={items} onRetry={onRetry} onCancel={onCancel} />
      </DialogContent>
    </Dialog>
  );
}

function VirtualizedUploadList({
  items,
  onRetry,
  onCancel,
}: {
  items: UploadItem[];
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(320);
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = items.length * VIRTUAL_ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - 2);
  const visibleCount = Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT) + 4;
  const endIndex = Math.min(items.length, startIndex + visibleCount);
  const slice = items.slice(startIndex, endIndex);
  const offsetY = startIndex * VIRTUAL_ROW_HEIGHT;

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    ro.observe(el);
    setViewportHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={scrollRef}
      className="h-[min(60vh,420px)] overflow-y-auto px-6 pb-6"
      onScroll={onScroll}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {slice.map((item) => (
            <VirtualRow key={item.id} item={item} onRetry={onRetry} onCancel={onCancel} />
          ))}
        </div>
      </div>
    </div>
  );
}

function VirtualRow({
  item,
  onRetry,
  onCancel,
}: {
  item: UploadItem;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-2 border-b py-2 text-sm"
      style={{ height: VIRTUAL_ROW_HEIGHT }}
    >
      <StatusDot status={item.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={item.displayName}>
          {item.displayName}
        </p>
        <p
          className={cn(
            "truncate text-xs",
            item.status === "error" ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {labelForStatus(item)}
        </p>
      </div>
      {item.status === "error" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 text-xs"
          onClick={() => onRetry(item.id)}
        >
          Retry
        </Button>
      )}
      {(item.status === "uploading" ||
        item.status === "creating" ||
        item.status === "completing") && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 text-xs"
          onClick={() => onCancel(item.id)}
        >
          Cancel
        </Button>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: UploadItem["status"] }) {
  if (status === "done") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  }
  if (status === "error") {
    return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
  }
  if (status === "cancelled") {
    return <X className="h-4 w-4 shrink-0 text-muted-foreground" />;
  }
  return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />;
}

function labelForStatus(item: UploadItem): string {
  switch (item.status) {
    case "queued":
      return "Queued";
    case "creating":
      return "Preparing…";
    case "uploading":
      return `Uploading… ${item.progress}%`;
    case "completing":
      return "Finalizing…";
    case "done":
      return "Uploaded";
    case "error":
      return item.error ?? "Upload failed";
    case "cancelled":
      return "Cancelled";
  }
}
