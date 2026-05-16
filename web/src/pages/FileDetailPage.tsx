import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  Download,
  KeyRound,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { iconForContentType } from "@/components/files/FileIcon";
import { ShareDialog } from "@/components/files/ShareDialog";
import {
  startDownload,
  useDeleteFile,
  useDeleteShare,
  useFile,
  useShares,
} from "@/hooks/useFiles";
import { apiErrorMessage } from "@/lib/axios";
import { formatBytes, formatRelativeDate } from "@/lib/utils";

export function FileDetailPage() {
  const { fileId = "" } = useParams<{ fileId: string }>();
  const fileQuery = useFile(fileId);
  const sharesQuery = useShares(fileId);
  const deleteFile = useDeleteFile();
  const deleteShare = useDeleteShare(fileId);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  if (fileQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (fileQuery.isError || !fileQuery.data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          File not found.
          <div className="mt-4">
            <Button variant="outline" asChild>
              <Link to="/">Back to my files</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  const file = fileQuery.data;
  const Icon = iconForContentType(file.content_type, file.original_filename);

  async function onDownload() {
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

  function onDelete() {
    if (!window.confirm(`Delete "${file.original_filename}"?`)) return;
    deleteFile.mutate(file.id, {
      onSuccess: () => {
        toast.success("File deleted");
        window.history.back();
      },
      onError: (err) => toast.error(apiErrorMessage(err, "Delete failed")),
    });
  }

  function publicLink(token: string): string {
    return `${window.location.origin}/s/${token}`;
  }

  async function copyShare(token: string) {
    try {
      await navigator.clipboard.writeText(publicLink(token));
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy link");
    }
  }

  function revokeShare(token: string) {
    if (!window.confirm("Revoke this share link?")) return;
    deleteShare.mutate(token, {
      onSuccess: () => toast.success("Share revoked"),
      onError: (err) => toast.error(apiErrorMessage(err, "Revoke failed")),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/" className="text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex-row items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">{file.original_filename}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatBytes(file.size_bytes)} · {file.content_type}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onDownload}>
              <Download className="h-4 w-4" />
              Download
            </Button>
            <Button onClick={() => setShareDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              New share
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <Field label="Status">
              <Badge variant={file.status === "ready" ? "success" : file.status === "failed" ? "destructive" : "warning"}>
                {file.status}
              </Badge>
            </Field>
            <Field label="Created">{formatRelativeDate(file.created_at)}</Field>
            <Field label="Expires">
              {file.expires_at ? formatRelativeDate(file.expires_at) : "never"}
            </Field>
            <Field label="ID">
              <span className="font-mono text-xs text-muted-foreground">{file.id.slice(0, 8)}…</span>
            </Field>
          </dl>
          <div className="mt-6 flex justify-end">
            <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive">
              <Trash2 className="h-4 w-4" />
              Delete file
            </Button>
          </div>
        </CardContent>
      </Card>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Share links</h2>
        {sharesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (sharesQuery.data?.length ?? 0) === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            No share links yet. Create one to let others download this file.
          </div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border bg-card/50">
            {sharesQuery.data!.map((share) => (
              <li key={share.token} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-xs">/s/{share.token.slice(0, 12)}…</span>
                    {share.password_protected && (
                      <Badge variant="outline" className="gap-1">
                        <KeyRound className="h-3 w-3" />
                        Password
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Created {formatRelativeDate(share.created_at)}
                    {share.expires_at ? ` · expires ${formatRelativeDate(share.expires_at)}` : " · no expiry"}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => copyShare(share.token)}>
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => revokeShare(share.token)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ShareDialog
        fileId={file.id}
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        onCreated={(token) => copyShare(token)}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
