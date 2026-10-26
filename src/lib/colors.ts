import { FileEntry } from "../types";

export const CATEGORIES = {
  folder: { label: "Folders", color: "#3b82f6" },
  video: { label: "Video", color: "#a855f7" },
  image: { label: "Images", color: "#22c55e" },
  audio: { label: "Audio", color: "#ec4899" },
  document: { label: "Documents", color: "#ef4444" },
  archive: { label: "Archives & images", color: "#eab308" },
  code: { label: "Code", color: "#06b6d4" },
  executable: { label: "Programs", color: "#f97316" },
  other: { label: "Other", color: "#64748b" },
} as const;

export type Category = keyof typeof CATEGORIES;

const EXTENSIONS: Record<string, Category> = {};
const register = (category: Category, exts: string) =>
  exts.split(" ").forEach((ext) => (EXTENSIONS[ext] = category));

register("video", "mp4 mkv avi mov wmv webm m4v flv mpg mpeg");
register("image", "jpg jpeg png gif bmp webp svg tif tiff heic raw psd ico");
register("audio", "mp3 wav flac aac ogg m4a wma opus");
register("document", "pdf doc docx xls xlsx ppt pptx txt rtf odt ods md csv epub");
register("archive", "zip rar 7z tar gz bz2 xz iso cab vhd vhdx img dmp");
register("code", "js ts tsx jsx py rs java cpp c h hpp cs go rb php html css json xml");
register("executable", "exe msi dll sys bin app dmg so");

export function getCategory(entry: FileEntry): Category {
  if (entry.is_dir) return "folder";
  return EXTENSIONS[entry.extension?.toLowerCase() ?? ""] ?? "other";
}

export function getEntryColor(entry: FileEntry): string {
  return CATEGORIES[getCategory(entry)].color;
}
