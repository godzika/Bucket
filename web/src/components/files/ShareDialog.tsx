import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateShare } from "@/hooks/useFiles";
import { apiErrorMessage } from "@/lib/axios";

interface Props {
  fileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (token: string) => void;
}

const EXPIRY_OPTIONS = [
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "24 hours" },
  { value: "604800", label: "7 days" },
  { value: "2592000", label: "30 days" },
  { value: "0", label: "Never (until revoked)" },
];

export function ShareDialog({ fileId, open, onOpenChange, onCreated }: Props) {
  const [expiry, setExpiry] = useState("86400");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const createShare = useCreateShare(fileId);

  function reset() {
    setExpiry("86400");
    setPassword("");
    setUsePassword(false);
  }

  async function onSubmit() {
    const seconds = expiry === "0" ? null : Number(expiry);
    const pwd = usePassword && password.trim() ? password.trim() : null;
    if (usePassword && (!pwd || pwd.length < 4)) {
      toast.error("Password must be at least 4 characters");
      return;
    }
    try {
      const share = await createShare.mutateAsync({
        expires_in_seconds: seconds,
        password: pwd,
      });
      toast.success("Share link created");
      onCreated?.(share.token);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not create share"));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create share link</DialogTitle>
          <DialogDescription>
            Anyone with the link can download the file until it expires or you revoke access.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expiry">Expires</Label>
            <Select value={expiry} onValueChange={setExpiry}>
              <SelectTrigger id="expiry">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={usePassword}
              onChange={(e) => setUsePassword(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border"
            />
            Protect with a password
          </label>
          {usePassword && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-password">Password</Label>
              <Input
                id="share-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 4 characters"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={createShare.isPending}>
            {createShare.isPending ? "Creating…" : "Create link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
