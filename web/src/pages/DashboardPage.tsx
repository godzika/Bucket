import { FilePlus2 } from "lucide-react";

import { FileTable } from "@/components/files/FileTable";
import { UploadDropzone } from "@/components/files/UploadDropzone";
import { UploadProgressList } from "@/components/files/UploadProgressList";
import { useFilesList } from "@/hooks/useFiles";
import { useUpload } from "@/hooks/useUpload";

export function DashboardPage() {
  const filesQuery = useFilesList();
  const upload = useUpload();
  const files = filesQuery.data ?? [];
  const hasFiles = files.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My files</h1>
          <p className="text-sm text-muted-foreground">
            {hasFiles ? `${files.length} file${files.length === 1 ? "" : "s"}` : "Start by uploading something."}
          </p>
        </div>
      </div>

      <UploadDropzone onFiles={upload.enqueue} compact={hasFiles} />

      {filesQuery.isLoading ? (
        <FileTable files={[]} isLoading />
      ) : hasFiles ? (
        <FileTable files={files} isLoading={false} />
      ) : (
        <EmptyState />
      )}

      <UploadProgressList
        items={upload.items}
        onRemove={upload.remove}
        onClearFinished={upload.clear}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <FilePlus2 className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-base font-medium">No files yet</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Drag a file onto the area above, or click "browse" to pick from your computer.
        </p>
      </div>
    </div>
  );
}
