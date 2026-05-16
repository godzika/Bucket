import {
  Archive,
  File,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  type LucideIcon,
} from "lucide-react";

export function iconForContentType(contentType: string, filename: string): LucideIcon {
  const ct = contentType.toLowerCase();
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (ct.startsWith("image/")) return FileImage;
  if (ct.startsWith("video/")) return FileVideo;
  if (ct.startsWith("audio/")) return FileAudio;
  if (ct.startsWith("text/")) return FileText;
  if (ct === "application/pdf") return FileText;
  if (
    ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext) ||
    ct.includes("zip") ||
    ct.includes("compressed")
  ) {
    return Archive;
  }
  if (["js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "json", "html", "css"].includes(ext)) {
    return FileCode;
  }
  return File;
}
