import { ChevronRight } from "lucide-react";

import type { Breadcrumb } from "@/lib/api/filesystem";
import { cn } from "@/lib/utils";

interface Props {
  items: Breadcrumb[];
  onNavigate: (folderId: string | null) => void;
}

export function FolderBreadcrumbs({ items, onNavigate }: Props) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={item.id} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <button
              type="button"
              disabled={isLast}
              onClick={() => onNavigate(item.is_root ? null : item.id)}
              className={cn(
                "rounded px-1 py-0.5 transition-colors",
                isLast
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:underline"
              )}
            >
              {item.name}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
