import { useCallback, useRef, useState } from "react";
import { FolderUp, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { collectFilesFromDataTransfer } from "@/lib/collectFiles";
import { cn } from "@/lib/utils";

interface Props {
  onFiles: (files: File[]) => void;
  compact?: boolean;
}

export function UploadDropzone({ onFiles, compact = false }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [collecting, setCollecting] = useState(false);

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);
  const openFolderPicker = useCallback(() => folderInputRef.current?.click(), []);

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (collecting) return;
    setCollecting(true);
    try {
      const files = await collectFilesFromDataTransfer(event.dataTransfer);
      if (files.length === 0) {
        toast.info("No files to upload (empty or system-only).");
        return;
      }
      onFiles(files);
    } catch {
      toast.error("Could not read dropped folder. Try the folder picker instead.");
    } finally {
      setCollecting(false);
    }
  }

  function onInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files && event.target.files.length > 0) {
      onFiles(Array.from(event.target.files));
      event.target.value = "";
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
        collecting && "pointer-events-none opacity-70",
        compact ? "gap-2 p-4" : "gap-3 p-10"
      )}
    >
      <UploadCloud className={cn("text-muted-foreground", compact ? "h-5 w-5" : "h-8 w-8")} />
      <div className={cn(compact ? "text-xs" : "text-sm")}>
        <span className="font-medium">Drop files or folders</span>{" "}
        <span className="text-muted-foreground">or</span>{" "}
        <button
          type="button"
          onClick={openFilePicker}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          browse files
        </button>
        {!compact && (
          <>
            {" "}
            <span className="text-muted-foreground">·</span>{" "}
            <button
              type="button"
              onClick={openFolderPicker}
              className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
            >
              <FolderUp className="h-3.5 w-3.5" />
              upload folder
            </button>
          </>
        )}
      </div>
      {!compact && (
        <p className="max-w-md text-xs text-muted-foreground">
          Folders upload file-by-file (2 at a time). Single files up to 5 GB; larger files use
          multipart. Keep this tab open until finished.
        </p>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onInputChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={onInputChange}
      />
      {compact && (
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={openFilePicker}>
            Files
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={openFolderPicker}>
            <FolderUp className="h-4 w-4" />
            Folder
          </Button>
        </div>
      )}
    </div>
  );
}