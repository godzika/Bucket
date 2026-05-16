import { useCallback, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  onFiles: (files: FileList | File[]) => void;
  compact?: boolean;
}

export function UploadDropzone({ onFiles, compact = false }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files.length > 0) {
      onFiles(event.dataTransfer.files);
    }
  }

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed bg-card/40 text-center transition-colors",
        dragOver ? "border-primary bg-accent/40" : "border-border",
        compact ? "gap-2 p-4" : "gap-3 p-10"
      )}
    >
      <UploadCloud className={cn("text-muted-foreground", compact ? "h-5 w-5" : "h-8 w-8")} />
      <div className={cn(compact ? "text-xs" : "text-sm")}>
        <span className="font-medium">Drop files</span>{" "}
        <span className="text-muted-foreground">to upload, or</span>{" "}
        <button
          type="button"
          onClick={openPicker}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          browse
        </button>
      </div>
      {!compact && (
        <p className="max-w-md text-xs text-muted-foreground">
          Any file type, up to 5 GB. Uploads go directly to S3-compatible storage; the API only signs them.
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files && event.target.files.length > 0) {
            onFiles(event.target.files);
            event.target.value = "";
          }
        }}
      />
      {compact && (
        <Button type="button" variant="outline" size="sm" onClick={openPicker}>
          Upload
        </Button>
      )}
    </div>
  );
}
