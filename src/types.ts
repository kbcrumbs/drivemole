export interface FileEntry {
  name: string;
  path: string;
  /** Space allocated on disk. */
  size: number;
  /** Nominal file length. */
  logical_size: number;
  is_dir: boolean;
  has_children: boolean;
  /** Present only when requested with enough depth. */
  children?: FileEntry[];
  /** Children left out of `children` (too many or too small). */
  omitted_children?: number;
  /** Files anywhere below this folder. */
  file_count?: number;
  dir_count?: number;
  /** Files directly inside this folder. */
  direct_file_count?: number;
  extension?: string;
}

export interface ScanProgress {
  current_path: string;
  files_scanned: number;
  total_size: number;
}

export interface ScanSummary {
  root_path: string;
  scanned_path: string;
  inaccessible: number;
  elapsed_ms: number;
}

export interface DriveInfo {
  name: string;
  mount_point: string;
  total_space: number;
  available_space: number;
  used_space: number;
}

export type SortBy = "size" | "name" | "files";
export type ViewMode = "tree" | "treemap" | "sunburst";
export type AnalysisTab = "none" | "largest" | "mostFiles";
