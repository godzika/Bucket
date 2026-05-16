import { FilePlus2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { FileBrowser } from "@/components/files/FileBrowser";
import { UploadDropzone } from "@/components/files/UploadDropzone";
import { UploadProgressList } from "@/components/files/UploadProgressList";
import { useFilesystemList } from "@/hooks/useFilesystem";
import { useUpload } from "@/hooks/useUpload";

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const folderParam = searchParams.get("folder");
  const folderId = folderParam || null;

  const listing = useFilesystemList(folderId);
  const currentFolderId = listing.data?.folder_id ?? null;
  const upload = useUpload(currentFolderId);

  const folders = listing.data?.folders ?? [];
  const files = listing.data?.files ?? [];
  const hasContent = folders.length > 0 || files.length > 0;

  function navigateFolder(id: string | null) {
    if (id) {
      setSearchParams({ folder: id });
    } else {
      setSearchParams({});
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My files</h1>
          <p className="text-sm text-muted-foreground">
            {listing.isLoading
              ? "Loading…"
              : hasContent
                ? `${folders.length} folder${folders.length === 1 ? "" : "s"}, ${files.length} file${files.length === 1 ? "" : "s"}`
                : "Start by uploading something or create a folder."}
          </p>
        </div>
      </div>

      <UploadDropzone onFiles={upload.enqueue} compact={hasContent} />

      <FileBrowser folderId={folderId} onNavigateFolder={navigateFolder} />

      {!listing.isLoading && !hasContent && <EmptyState />}

      <UploadProgressList
        summary={upload.summary}
        active={upload.active}
        errors={upload.errors}
        doneRecent={upload.doneRecent}
        speedBytesPerSec={upload.speedBytesPerSec}
        allItems={upload.items}
        onRemove={upload.remove}
        onCancel={upload.cancel}
        onRetry={upload.retry}
        onClearFinished={upload.clearFinished}
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
          <h2 className="text-base font-medium">This folder is empty</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Drag files or folders here, use browse, or create a new folder.
          </p>
        </div>
    </div>
  );
}

