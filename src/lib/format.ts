import { FileEntry, SortBy } from "../types";

export function formatSize(bytes: number, digits = 1): string {
  if (!bytes || bytes < 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(digits)) + " " + sizes[i];
}

export function formatPercent(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "0.0%";
}

export function sortEntries(entries: FileEntry[], sortBy: SortBy): FileEntry[] {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name, undefined, { numeric: true });
    if (sortBy === "files") return (b.file_count ?? 0) - (a.file_count ?? 0) || b.size - a.size;
    return b.size - a.size;
  });
  return sorted;
}

export interface PathSegment {
  label: string;
  path: string;
}

/** Splits a path into clickable breadcrumb segments, from the root down. */
export function pathSegments(path: string): PathSegment[] {
  const isUnc = path.startsWith("\\\\");
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const segments: PathSegment[] = [];

  let current: string;
  if (isUnc && parts.length >= 2) {
    current = `\\\\${parts[0]}\\${parts[1]}\\`;
    segments.push({ label: `\\\\${parts[0]}\\${parts[1]}`, path: current });
    parts.splice(0, 2);
  } else if (path.startsWith("/")) {
    current = "/";
    segments.push({ label: "/", path: current });
  } else if (/^[A-Za-z]:$/.test(parts[0] ?? "")) {
    current = `${parts[0]}\\`;
    segments.push({ label: parts[0], path: current });
    parts.shift();
  } else {
    current = "";
  }

  for (const part of parts) {
    current = current === "" || current.endsWith(sep) ? current + part : current + sep + part;
    segments.push({ label: part, path: current });
  }
  return segments;
}

export function parentPath(path: string): string | null {
  const segments = pathSegments(path);
  return segments.length >= 2 ? segments[segments.length - 2].path : null;
}

function normalizePath(path: string): string {
  return path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

export function isWithin(path: string, root: string): boolean {
  const p = normalizePath(path);
  const r = normalizePath(root);
  return p === r || p.startsWith(r + "\\");
}
