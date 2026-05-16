import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Download,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { iconForContentType } from "./FileIcon";
import { FolderBreadcrumbs } from "./FolderBreadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateFolder, useDeleteFolder, useFilesystemList } from "@/hooks/useFilesystem";
import { startDownload, useDeleteFile, useDeleteFiles } from "@/hooks/useFiles";
import type { Folder as FolderType } from "@/lib/api/filesystem";
import type { StoredFile } from "@/lib/api/files";
import { apiErrorMessage } from "@/lib/axios";
import { cn, formatBytes, formatRelativeDate } from "@/lib/utils";

const checkboxClass =
  "h-4 w-4 rounded border border-input accent-primary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

interface Props {
  folderId?: string | null;
  onNavigateFolder: (folderId: string | null) => void;
}

export function FileBrowser({ folderId, onNavigateFolder }: Props) {
  const listing = useFilesystemList(folderId);
  const createFolder = useCreateFolder(listing.data?.folder_id);
  const deleteFolder = useDeleteFolder();
  const deleteFile = useDeleteFile();
  const deleteFiles = useDeleteFiles();
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);

  const data = listing.data;
  const folders = data?.folders ?? [];
  const files = data?.files ?? [];
  const fileIds = files.map((f) => f.id);
  const selectedCount = selectedFileIds.size;
  const allSelected = files.length > 0 && selectedCount === files.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const isEmpty = !listing.isLoading && folders.length === 0 && files.length === 0;

  useEffect(() => {
    setSelectedFileIds((prev) => {
      const next = new Set([...prev].filter((id) => fileIds.includes(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [fileIds]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  function toggleOne(id: string, checked: boolean) {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedFileIds(checked ? new Set(fileIds) : new Set());
  }

  async function onNewFolder() {
    const name = window.prompt("New folder name");
    if (!name?.trim()) return;
    createFolder.mutate(name.trim(), {
      onSuccess: () => toast.success("Folder created"),
      onError: (err) => toast.error(apiErrorMessage(err, "Could not create folder")),
    });
  }

  function onOpenFolder(folder: FolderType) {
    onNavigateFolder(folder.id);
  }

  function onDeleteFolderItem(folder: FolderType) {
    if (
      !window.confirm(
        `Delete folder "${folder.name}" and everything inside it? This cannot be undone.`
      )
    ) {
      return;
    }
    deleteFolder.mutate(folder.id, {
      onSuccess: () => toast.success("Folder deleted"),
      onError: (err) => toast.error(apiErrorMessage(err, "Could not delete folder")),
    });
  }

  async function onDownload(file: StoredFile) {
    if (file.status !== "ready") {
      toast.warning("File isn't ready yet.");
      return;
    }
    try {
      await startDownload(file.id);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not start download"));
    }
  }

  function onDeleteOne(file: StoredFile) {
    if (!window.confirm(`Delete "${file.original_filename}"? This cannot be undone.`)) return;
    deleteFile.mutate(file.id, {
      onSuccess: () => {
        toast.success("File deleted");
        setSelectedFileIds((prev) => {
          const next = new Set(prev);
          next.delete(file.id);
          return next;
        });
      },
      onError: (err) => toast.error(apiErrorMessage(err, "Delete failed")),
    });
  }

  function onDeleteSelected() {
    const ids = [...selectedFileIds];
    if (ids.length === 0) return;
    const label = ids.length === 1 ? "this file" : `${ids.length} files`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    deleteFiles.mutate(ids, {
      onSuccess: () => {
        toast.success(ids.length === 1 ? "File deleted" : `${ids.length} files deleted`);
        setSelectedFileIds(new Set());
      },
      onError: (err) => toast.error(apiErrorMessage(err, "Delete failed")),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {data ? (
          <FolderBreadcrumbs items={data.breadcrumbs} onNavigate={onNavigateFolder} />
        ) : (
          <Skeleton className="h-5 w-48" />
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={createFolder.isPending || listing.isLoading}
          onClick={onNewFolder}
        >
          <Folder className="mr-2 h-4 w-4" />
          New folder
        </Button>
      </div>

      {listing.isLoading ? (
        <ListingSkeleton />
      ) : isEmpty ? null : (
        <div className="flex flex-col gap-2">
          {selectedCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-2.5">
              <span className="text-sm font-medium">{selectedCount} selected</span>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedFileIds(new Set())}>
                  Clear
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={deleteFiles.isPending}
                  onClick={onDeleteSelected}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete selected
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border bg-card/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 px-4 py-2.5">
                    <label className="sr-only">Select all files</label>
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      className={checkboxClass}
                      checked={allSelected}
                      disabled={files.length === 0}
                      onChange={(e) => toggleAll(e.target.checked)}
                      aria-label="Select all files"
                    />
                  </th>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Size</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Status</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Created</th>
                  <th className="px-4 py-2.5" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {folders.map((folder) => (
                  <FolderRow
                    key={folder.id}
                    folder={folder}
                    onOpen={onOpenFolder}
                    onDelete={onDeleteFolderItem}
                  />
                ))}
                {files.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    checked={selectedFileIds.has(file.id)}
                    onToggle={toggleOne}
                    onDownload={onDownload}
                    onDelete={onDeleteOne}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FolderRow({
  folder,
  onOpen,
  onDelete,
}: {
  folder: FolderType;
  onOpen: (folder: FolderType) => void;
  onDelete: (folder: FolderType) => void;
}) {
  return (
    <tr
      className="group cursor-pointer border-b transition-colors hover:bg-accent/40"
      onDoubleClick={() => onOpen(folder)}
    >
      <td className="px-4 py-3" />
      <td className="px-4 py-3" colSpan={4}>
        <button
          type="button"
          className="flex w-full items-center gap-3 text-left outline-none focus-visible:underline"
          onClick={() => onOpen(folder)}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400">
            <FolderOpen className="h-4 w-4" />
          </span>
          <span className="truncate font-medium">{folder.name}</span>
        </button>
      </td>
      <td className="px-4 py-3 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="More"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onDelete(folder)}
            >
              <Trash2 className="h-4 w-4" />
              Delete folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function FileRow({
  file,
  checked,
  onToggle,
  onDownload,
  onDelete,
}: {
  file: StoredFile;
  checked: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onDownload: (file: StoredFile) => void;
  onDelete: (file: StoredFile) => void;
}) {
  const Icon = iconForContentType(file.content_type, file.original_filename);
  return (
    <tr
      className={cn(
        "group border-b last:border-b-0 transition-colors hover:bg-accent/40",
        checked && "bg-accent/30"
      )}
    >
      <td className="px-4 py-3 align-middle">
        <input
          type="checkbox"
          className={checkboxClass}
          checked={checked}
          onChange={(e) => onToggle(file.id, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${file.original_filename}`}
        />
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/file/${file.id}`}
          className="flex items-center gap-3 outline-none focus-visible:underline"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="h-4 w-4" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{file.original_filename}</span>
            <span className="truncate text-xs text-muted-foreground md:hidden">
              {formatBytes(file.size_bytes)} · {formatRelativeDate(file.created_at)}
            </span>
          </span>
        </Link>
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
        {formatBytes(file.size_bytes)}
      </td>
      <td className="hidden px-4 py-3 md:table-cell">
        <StatusBadge status={file.status} />
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
        {formatRelativeDate(file.created_at)}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onDownload(file)}
            title="Download"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" asChild title="Share">
            <Link to={`/file/${file.id}`} aria-label="Share">
              <Share2 className="h-4 w-4" />
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" title="More">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => onDelete(file)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  );
}

function ListingSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-1 divide-y">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-8 w-8 rounded" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-3 w-1/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function StatusBadge({ status }: { status: StoredFile["status"] }) {
  if (status === "ready") return <Badge variant="success">Ready</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="warning">Uploading…</Badge>;
}
