import { invoke } from "@tauri-apps/api/core";
import { DriveInfo, FileEntry, ScanSummary } from "../types";

/** Error from `getNode` when a path isn't part of the current scan. */
export const NOT_IN_SCAN = "NOT_IN_SCAN";

export const api = {
  getDrives: () => invoke<DriveInfo[]>("get_drives"),
  scan: (path: string) => invoke<ScanSummary>("scan_directory", { path }),
  cancelScan: () => invoke<void>("cancel_scan"),
  getNode: (path: string, depth: number) => invoke<FileEntry>("get_node", { path, depth }),
  largestFiles: (path: string, limit = 100) =>
    invoke<FileEntry[]>("get_largest_files", { path, limit }),
  foldersWithMostFiles: (path: string, limit = 100) =>
    invoke<FileEntry[]>("get_folders_most_files", { path, limit }),
  openInExplorer: (path: string) => invoke<void>("open_in_explorer", { path }),
  deleteItem: (path: string, permanent: boolean) =>
    invoke<void>("delete_item", { path, permanent }),
};

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
