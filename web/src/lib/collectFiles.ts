/** Collect files from a drop or picker, including folders (recursive). */

export type FileWithPath = File & { webkitRelativePath?: string };

function withRelativePath(file: File, relativePath: string): FileWithPath {
  if (file.webkitRelativePath === relativePath) {
    return file as FileWithPath;
  }
  try {
    Object.defineProperty(file, "webkitRelativePath", {
      value: relativePath,
      configurable: true,
    });
  } catch {
    // Some browsers freeze the property; use as-is.
  }
  return file as FileWithPath;
}

async function readAllDirectoryEntries(
  reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = [];
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    entries.push(...batch);
  } while (batch.length > 0);
  return entries;
}

async function entryToFiles(entry: FileSystemEntry, basePath: string): Promise<FileWithPath[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject);
    });
    const rel = basePath ? `${basePath}/${file.name}` : file.name;
    if (shouldSkipFile(rel, file.size)) return [];
    return [withRelativePath(file, rel)];
  }

  if (entry.isDirectory) {
    const dir = entry as FileSystemDirectoryEntry;
    const reader = dir.createReader();
    const children = await readAllDirectoryEntries(reader);
    const dirPath = basePath ? `${basePath}/${dir.name}` : dir.name;
    const nested = await Promise.all(children.map((child) => entryToFiles(child, dirPath)));
    return nested.flat();
  }

  return [];
}

function shouldSkipFile(relativePath: string, size: number): boolean {
  const name = relativePath.split("/").pop() ?? relativePath;
  if (size === 0) return true;
  if (name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini") return true;
  return false;
}

export interface UploadPathParts {
  displayName: string;
  basename: string;
  folderSegments: string[];
}

/** Relative path for UI; basename + folder segments for filesystem placement. */
export function uploadPathParts(file: File): UploadPathParts {
  const rel = file.webkitRelativePath?.replace(/\\/g, "/").replace(/^\/+/, "") ?? file.name;
  const parts = rel.split("/").filter((p) => p && p !== "." && p !== "..");
  if (parts.length <= 1) {
    return {
      displayName: rel,
      basename: parts[0] ?? file.name,
      folderSegments: [],
    };
  }
  return {
    displayName: rel,
    basename: parts[parts.length - 1]!,
    folderSegments: parts.slice(0, -1),
  };
}

/** @deprecated Use uploadPathParts for filesystem-aware uploads. */
export function uploadFilename(file: File): string {
  return uploadPathParts(file).displayName;
}

export async function collectFilesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<FileWithPath[]> {
  const items = dataTransfer.items;
  if (items && items.length > 0) {
    const entries: FileSystemEntry[] = [];
    for (const item of Array.from(items)) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      const groups = await Promise.all(entries.map((e) => entryToFiles(e, "")));
      return groups.flat();
    }
  }

  return Array.from(dataTransfer.files)
    .filter((f) => !shouldSkipFile(uploadFilename(f), f.size))
    .map((f) => f as FileWithPath);
}

export function collectFilesFromFileList(fileList: FileList | File[]): FileWithPath[] {
  return Array.from(fileList)
    .filter((f) => !shouldSkipFile(uploadFilename(f), f.size))
    .map((f) => f as FileWithPath);
}
