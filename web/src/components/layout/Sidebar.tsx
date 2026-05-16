import { NavLink } from "react-router-dom";
import { FolderOpen, Share2, Cloud } from "lucide-react";

import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "My files", icon: FolderOpen, end: true },
  { to: "/shared", label: "Shared", icon: Share2, disabled: true },
];

export function Sidebar() {
  return (
    <aside className="hidden w-[220px] shrink-0 border-r bg-card/40 md:flex md:flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Cloud className="h-4 w-4" />
        </div>
        <span className="text-sm font-semibold">File Share</span>
      </div>
      <nav className="flex flex-col gap-1 p-2">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            aria-disabled={link.disabled}
            onClick={(event) => {
              if (link.disabled) event.preventDefault();
            }}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                link.disabled
                  ? "cursor-not-allowed text-muted-foreground/70"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                isActive && !link.disabled && "bg-accent text-accent-foreground"
              )
            }
          >
            <link.icon className="h-4 w-4" />
            {link.label}
            {link.disabled && (
              <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground/70">
                soon
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto p-4 text-xs text-muted-foreground">
        <p>5 GB max per file</p>
        <p className="mt-1 opacity-75">FastAPI + MinIO</p>
      </div>
    </aside>
  );
}
