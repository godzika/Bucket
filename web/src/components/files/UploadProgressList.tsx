import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { UploadItem } from "@/hooks/useUpload";
import { cn } from "@/lib/utils";

interface Props {
  items: UploadItem[];
  onRemove: (id: string) => void;
  onClearFinished: () => void;
}

export function UploadProgressList({ items, onRemove, onClearFinished }: Props) {
  if (items.length === 0) return null;

  const hasFinished = items.some((it) => it.status === "done" || it.status === "error");

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-full max-w-sm flex-col gap-2">
      <div className="pointer-events-auto flex items-center justify-between rounded-lg border bg-card/95 px-3 py-2 shadow-md backdrop-blur">
        <span className="text-xs font-medium">{items.length} upload{items.length === 1 ? "" : "s"}</span>
        {hasFinished && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onClearFinished}
          >
            Clear done
          </Button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-auto rounded-lg border bg-card/95 p-3 shadow-md backdrop-blur"
          >
            <div className="flex items-start gap-2">
              <StatusIcon status={item.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.file.name}</p>
                <p className={cn("mt-0.5 text-xs", item.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                  {labelForStatus(item)}
                </p>
                {item.status !== "done" && item.status !== "error" && (
                  <Progress value={item.progress} className="mt-2" />
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onRemove(item.id)}
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function StatusIcon({ status }: { status: UploadItem["status"] }) {
  if (status === "done") return <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />;
  if (status === "error") return <XCircle className="mt-0.5 h-4 w-4 text-destructive" />;
  return <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-muted-foreground" />;
}

function labelForStatus(item: UploadItem): string {
  switch (item.status) {
    case "queued":
      return "Queued";
    case "creating":
      return "Preparing upload…";
    case "uploading":
      return `Uploading… ${item.progress}%`;
    case "completing":
      return "Finalizing…";
    case "done":
      return "Uploaded";
    case "error":
      return item.error ?? "Upload failed";
  }
}
