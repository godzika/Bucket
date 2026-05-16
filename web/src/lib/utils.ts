import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatRelativeDate(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  const absSeconds = Math.floor(Math.abs(diffMs) / 1000);
  const future = diffMs < 0;
  const pick = (value: number, unit: string) =>
    future ? `in ${value}${unit}` : `${value}${unit} ago`;
  if (absSeconds < 45) return future ? "in a moment" : "just now";
  const minutes = Math.floor(absSeconds / 60);
  if (minutes < 60) return pick(minutes, "m");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return pick(hours, "h");
  const days = Math.floor(hours / 24);
  if (days < 7) return pick(days, "d");
  return date.toLocaleDateString();
}
