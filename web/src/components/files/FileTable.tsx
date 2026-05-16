import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Download, MoreHorizontal, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { iconForContentType } from "./FileIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { startDownload, useDeleteFile, useDeleteFiles } from "@/hooks/useFiles";
import type { StoredFile } from "@/lib/api/files";
import { apiErrorMessage } from "@/lib/axios";
import { cn, formatBytes, formatRelativeDate } from "@/lib/utils";

interface Props {
  files: StoredFile[];
  isLoading: boolean;
}

const checkboxClass =
  "h-4 w-4 rounded border border-input accent-primary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function FileTable({ files, isLoading }: Props) {
  const deleteFile = useDeleteFile();
  const deleteFiles = useDeleteFiles();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);

  const fileIds = files.map((f) => f.id);
  const selectedCount = selectedIds.size;
  const allSelected = files.length > 0 && selectedCount === files.length;
  const someSelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => fileIds.includes(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [fileIds]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  if (isLoading) {
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
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
        </div>
    );
  }

  if (files.length === 0) {
    return null;
  }

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(fileIds) : new Set());
  }

  function clearSelection() {
    setSelectedIds(new Set());
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
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(file.id);
          return next;
        });
      },
      onError: (err) => toast.error(apiErrorMessage(err, "Delete failed")),
    });
  }

  function onDeleteSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const label = ids.length === 1 ? "this file" : `${ids.length} files`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    deleteFiles.mutate(ids, {
      onSuccess: () => {
        toast.success(ids.length === 1 ? "File deleted" : `${ids.length} files deleted`);
        clearSelection();
      },
      onError: (err) => toast.error(apiErrorMessage(err, "Delete failed")),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {selectedCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-2.5">
            <span className="text-sm font-medium">{selectedCount} selected</span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
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
                <label className="sr-only">Select all</label>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className={checkboxClass}
                  checked={allSelected}
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
            {files.map((file) => {
              const Icon = iconForContentType(file.content_type, file.original_filename);
              const checked = selectedIds.has(file.id);
              return (
                <tr
                  key={file.id}
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
                      onChange={(e) => toggleOne(file.id, e.target.checked)}
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
                            onSelect={() => onDeleteOne(file)}
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
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: StoredFile["status"] }) {
  if (status === "ready") return <Badge variant="success">Ready</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="warning">Uploading…</Badge>;
}
