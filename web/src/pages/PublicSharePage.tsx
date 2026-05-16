import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Cloud, Download, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { iconForContentType } from "@/components/files/FileIcon";
import { getShareInfo, requestPublicDownload, type ShareInfo } from "@/lib/api/public";
import { apiErrorMessage } from "@/lib/axios";
import { formatBytes, formatRelativeDate } from "@/lib/utils";

export function PublicSharePage() {
  const { token = "" } = useParams<{ token: string }>();
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getShareInfo(token)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, "Share not found"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onDownload() {
    setError(null);
    setDownloading(true);
    try {
      const { download_url } = await requestPublicDownload(token, password || null);
      // Same-origin navigation (nginx reverse-proxies /files/* to MinIO) means
      // a plain location change triggers the browser's native download UI
      // without leaving the SPA, on both desktop and mobile.
      window.location.href = download_url;
    } catch (err) {
      setError(apiErrorMessage(err, "Could not start download"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Cloud className="h-4 w-4" />
          </div>
          <CardTitle className="text-base">Shared file</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loading && (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {!loading && error && !info && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
              {error}
            </p>
          )}

          {info && (
            <>
              <FileInfoBlock info={info} />
              {info.password_protected && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="password" className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" />
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Required"
                    autoFocus
                  />
                </div>
              )}
              {error && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button onClick={onDownload} disabled={downloading} size="lg">
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Download
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FileInfoBlock({ info }: { info: ShareInfo }) {
  const Icon = iconForContentType(info.content_type, info.filename);
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card/50 p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{info.filename}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(info.size_bytes)}
          {info.expires_at && ` · expires ${formatRelativeDate(info.expires_at)}`}
        </p>
      </div>
    </div>
  );
}
