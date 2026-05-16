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
import { startDownload, useDeleteFile } from "@/hooks/useFiles";
import type { StoredFile } from "@/lib/api/files";
import { apiErrorMessage } from "@/lib/axios";
import { formatBytes, formatRelativeDate } from "@/lib/utils";

interface Props {
  files: StoredFile[];
  isLoading: boolean;
}

export function FileTable({ files, isLoading }: Props) {
  const deleteFile = useDeleteFile();

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-1 divide-y">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="flex items-center gap-3 px-4 py-3">
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
    return null; // Empty state handled by parent.
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

  function onDelete(file: StoredFile) {
    if (!window.confirm(`Delete "${file.original_filename}"? This cannot be undone.`)) return;
    deleteFile.mutate(file.id, {
      onSuccess: () => toast.success("File deleted"),
      onError: (err) => toast.error(apiErrorMessage(err, "Delete failed")),
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card/50">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
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
            return (
              <tr
                key={file.id}
                className="group border-b last:border-b-0 transition-colors hover:bg-accent/40"
              >
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      asChild
                      title="Share"
                    >
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
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: StoredFile["status"] }) {
  if (status === "ready") return <Badge variant="success">Ready</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="warning">Uploading…</Badge>;
}
