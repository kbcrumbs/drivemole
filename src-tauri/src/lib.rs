use rayon::prelude::*;
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use sysinfo::Disks;
use tauri::{AppHandle, Emitter, Manager, State};

/// Error returned by `get_node` when a path lies outside the current scan,
/// so the frontend knows to start a new scan instead.
const NOT_IN_SCAN: &str = "NOT_IN_SCAN";

/// Max children returned for the requested node itself.
const MAX_DIRECT_CHILDREN: usize = 20_000;
/// Max children returned per folder below the requested node (for the sunburst).
const MAX_NESTED_CHILDREN: usize = 100;

// ---------------------------------------------------------------------------
// In-memory scan tree
// ---------------------------------------------------------------------------

struct Node {
    name: Box<str>,
    /// Space allocated on disk.
    size: u64,
    /// Nominal file length.
    logical_size: u64,
    is_dir: bool,
    /// Files anywhere below this folder.
    file_count: u64,
    /// Folders anywhere below this folder.
    dir_count: u64,
    /// Files directly inside this folder.
    direct_files: u64,
    /// Sorted by size, largest first.
    children: Vec<Node>,
}

impl Node {
    fn dir(name: Box<str>) -> Self {
        Node {
            name,
            size: 0,
            logical_size: 0,
            is_dir: true,
            file_count: 0,
            dir_count: 0,
            direct_files: 0,
            children: Vec::new(),
        }
    }

    fn file(name: Box<str>, size: u64, logical_size: u64) -> Self {
        Node {
            name,
            size,
            logical_size,
            is_dir: false,
            file_count: 0,
            dir_count: 0,
            direct_files: 0,
            children: Vec::new(),
        }
    }

    fn sort_children(&mut self) {
        self.children.sort_unstable_by(|a, b| b.size.cmp(&a.size));
    }
}

/// What a child node contributes to its parent's totals.
#[derive(Default, Clone, Copy)]
struct Contribution {
    size: u64,
    logical_size: u64,
    files: u64,
    dirs: u64,
    direct_files: u64,
}

impl Contribution {
    fn of(node: &Node) -> Self {
        if node.is_dir {
            Contribution {
                size: node.size,
                logical_size: node.logical_size,
                files: node.file_count,
                dirs: node.dir_count + 1,
                direct_files: 0,
            }
        } else {
            Contribution {
                size: node.size,
                logical_size: node.logical_size,
                files: 1,
                dirs: 0,
                direct_files: 1,
            }
        }
    }
}

fn apply_change(node: &mut Node, old: Contribution, new: Contribution) {
    node.size = node.size - old.size + new.size;
    node.logical_size = node.logical_size - old.logical_size + new.logical_size;
    node.file_count = node.file_count - old.files + new.files;
    node.dir_count = node.dir_count - old.dirs + new.dirs;
    node.direct_files = node.direct_files - old.direct_files + new.direct_files;
}

fn name_eq(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

/// Replaces (or with `None`, removes) the descendant at `comps`, updating the
/// totals of every folder on the way. Returns false if the path wasn't found.
fn replace_at(node: &mut Node, comps: &[String], new: Option<Node>) -> bool {
    let Some(idx) = node.children.iter().position(|c| name_eq(&c.name, &comps[0])) else {
        return false;
    };
    let old = Contribution::of(&node.children[idx]);
    let updated = if comps.len() == 1 {
        match new {
            Some(mut n) => {
                n.name = node.children[idx].name.clone();
                let c = Contribution::of(&n);
                node.children[idx] = n;
                c
            }
            None => {
                node.children.remove(idx);
                Contribution::default()
            }
        }
    } else {
        if !replace_at(&mut node.children[idx], &comps[1..], new) {
            return false;
        }
        Contribution::of(&node.children[idx])
    };
    apply_change(node, old, updated);
    node.sort_children();
    true
}

struct ScanTree {
    root_path: PathBuf,
    root: Node,
}

impl ScanTree {
    /// Path components of `path` relative to the scan root, or None if outside it.
    fn relative(&self, path: &Path) -> Option<Vec<String>> {
        fn norm(p: &Path) -> String {
            let s = p.to_string_lossy();
            let s = if cfg!(windows) { s.replace('/', "\\") } else { s.into_owned() };
            s.trim_end_matches(std::path::MAIN_SEPARATOR).to_string()
        }
        let root = norm(&self.root_path);
        let target = norm(path);
        if target.len() < root.len() || !name_eq(&target[..root.len()], &root) {
            return None;
        }
        let rest = &target[root.len()..];
        if !rest.is_empty() && !rest.starts_with(std::path::MAIN_SEPARATOR) {
            return None;
        }
        Some(
            rest.split(std::path::MAIN_SEPARATOR)
                .filter(|c| !c.is_empty())
                .map(String::from)
                .collect(),
        )
    }

    /// Finds the node for `path`, returning it with its canonical path.
    fn find(&self, path: &Path) -> Option<(&Node, PathBuf)> {
        let comps = self.relative(path)?;
        let mut node = &self.root;
        let mut full = self.root_path.clone();
        for comp in &comps {
            node = node.children.iter().find(|c| name_eq(&c.name, comp))?;
            full.push(&*node.name);
        }
        Some((node, full))
    }
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

#[derive(Default)]
struct AppState {
    tree: Mutex<Option<ScanTree>>,
    scanning: AtomicBool,
    cancel: Arc<AtomicBool>,
}

impl AppState {
    fn tree(&self) -> MutexGuard<'_, Option<ScanTree>> {
        self.tree.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Clears the `scanning` flag when a scan ends, however it ends.
struct ScanGuard<'a>(&'a AtomicBool);

impl Drop for ScanGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------
// Serialized types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub logical_size: u64,
    pub is_dir: bool,
    pub has_children: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileEntry>>,
    /// Number of children left out of `children`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub omitted_children: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dir_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direct_file_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ScanProgress {
    pub current_path: String,
    pub files_scanned: u64,
    pub total_size: u64,
}

#[derive(Debug, Serialize)]
pub struct ScanSummary {
    pub root_path: String,
    pub scanned_path: String,
    pub inaccessible: u64,
    pub elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct DriveInfo {
    pub name: String,
    pub mount_point: String,
    pub total_space: u64,
    pub available_space: u64,
    pub used_space: u64,
}

fn to_entry(node: &Node, path: &Path, depth: u32, top_size: u64, nested: bool) -> FileEntry {
    let children = (node.is_dir && depth > 0).then(|| {
        let iter = node.children.iter();
        let picked: Vec<&Node> = if nested {
            // Only folders big enough to be visible in a chart.
            iter.filter(|c| c.size.saturating_mul(1000) >= top_size)
                .take(MAX_NESTED_CHILDREN)
                .collect()
        } else {
            iter.take(MAX_DIRECT_CHILDREN).collect()
        };
        picked
            .into_iter()
            .map(|c| to_entry(c, &path.join(&*c.name), depth - 1, top_size, true))
            .collect::<Vec<_>>()
    });
    let omitted = children
        .as_ref()
        .map(|c| (node.children.len() - c.len()) as u64)
        .filter(|&n| n > 0);

    FileEntry {
        name: node.name.to_string(),
        path: path.to_string_lossy().into_owned(),
        size: node.size,
        logical_size: node.logical_size,
        is_dir: node.is_dir,
        has_children: !node.children.is_empty(),
        children,
        omitted_children: omitted,
        file_count: node.is_dir.then_some(node.file_count),
        dir_count: node.is_dir.then_some(node.dir_count),
        direct_file_count: node.is_dir.then_some(node.direct_files),
        extension: if node.is_dir {
            None
        } else {
            Path::new(&*node.name)
                .extension()
                .map(|e| e.to_string_lossy().into_owned())
        },
    }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

struct ScanCtx {
    files_scanned: AtomicU64,
    total_size: AtomicU64,
    inaccessible: AtomicU64,
    current_path: Mutex<String>,
    cancel: Arc<AtomicBool>,
    cluster_size: u64,
}

fn scan_dir(path: &Path, name: Box<str>, ctx: &ScanCtx) -> Node {
    let mut node = Node::dir(name);
    if ctx.cancel.load(Ordering::Relaxed) {
        return node;
    }
    if let Ok(mut current) = ctx.current_path.try_lock() {
        *current = path.to_string_lossy().into_owned();
    }

    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => {
            ctx.inaccessible.fetch_add(1, Ordering::Relaxed);
            return node;
        }
    };

    let mut subdirs: Vec<(PathBuf, Box<str>)> = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else { continue };
        // Symlinks and junctions point at data counted elsewhere (or outside
        // the scanned folder), so following them would double count it.
        if file_type.is_symlink() {
            continue;
        }
        let name: Box<str> = entry.file_name().to_string_lossy().into();
        if file_type.is_dir() {
            subdirs.push((entry.path(), name));
        } else {
            let metadata = entry.metadata().ok();
            let logical = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
            let size = allocated_size(&entry.path(), metadata.as_ref(), logical, ctx.cluster_size);
            node.size += size;
            node.logical_size += logical;
            node.direct_files += 1;
            node.children.push(Node::file(name, size, logical));
        }
    }
    node.file_count = node.direct_files;
    ctx.files_scanned.fetch_add(node.direct_files, Ordering::Relaxed);
    ctx.total_size.fetch_add(node.size, Ordering::Relaxed);

    let dirs: Vec<Node> = subdirs
        .into_par_iter()
        .map(|(p, n)| scan_dir(&p, n, ctx))
        .collect();
    for d in &dirs {
        node.size += d.size;
        node.logical_size += d.logical_size;
        node.file_count += d.file_count;
        node.dir_count += d.dir_count + 1;
    }
    node.children.extend(dirs);
    node.sort_children();
    node.children.shrink_to_fit();
    node
}

fn round_up(size: u64, cluster: u64) -> u64 {
    if cluster == 0 {
        size
    } else {
        size.div_ceil(cluster) * cluster
    }
}

#[cfg(windows)]
fn wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn allocated_size(path: &Path, metadata: Option<&fs::Metadata>, logical: u64, cluster: u64) -> u64 {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_SPARSE_FILE: u32 = 0x200;
    const FILE_ATTRIBUTE_COMPRESSED: u32 = 0x800;
    const FILE_ATTRIBUTE_OFFLINE: u32 = 0x1000;
    const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x40000;
    const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x400000;
    const NEEDS_QUERY: u32 = FILE_ATTRIBUTE_SPARSE_FILE
        | FILE_ATTRIBUTE_COMPRESSED
        | FILE_ATTRIBUTE_OFFLINE
        | FILE_ATTRIBUTE_RECALL_ON_OPEN
        | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS;

    let attributes = metadata.map(|m| m.file_attributes()).unwrap_or(0);
    // Only compressed, sparse and cloud placeholder files differ from their
    // length enough to justify an extra system call per file.
    if attributes & NEEDS_QUERY == 0 {
        return round_up(logical, cluster);
    }
    use windows_sys::Win32::Foundation::{GetLastError, NO_ERROR};
    use windows_sys::Win32::Storage::FileSystem::{GetCompressedFileSizeW, INVALID_FILE_SIZE};
    let name = wide(path);
    let mut high: u32 = 0;
    let low = unsafe { GetCompressedFileSizeW(name.as_ptr(), &mut high) };
    if low == INVALID_FILE_SIZE && unsafe { GetLastError() } != NO_ERROR {
        return round_up(logical, cluster);
    }
    round_up(((high as u64) << 32) | low as u64, cluster)
}

#[cfg(unix)]
fn allocated_size(_path: &Path, metadata: Option<&fs::Metadata>, logical: u64, _cluster: u64) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.map(|m| m.blocks() * 512).unwrap_or(logical)
}

#[cfg(not(any(windows, unix)))]
fn allocated_size(_path: &Path, _metadata: Option<&fs::Metadata>, logical: u64, _cluster: u64) -> u64 {
    logical
}

#[cfg(windows)]
fn cluster_size(path: &Path) -> u64 {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceW;
    let Some(root) = path.ancestors().last() else { return 4096 };
    let root = wide(root);
    let (mut sectors, mut bytes, mut free, mut total) = (0u32, 0u32, 0u32, 0u32);
    let ok = unsafe { GetDiskFreeSpaceW(root.as_ptr(), &mut sectors, &mut bytes, &mut free, &mut total) };
    if ok != 0 && sectors > 0 && bytes > 0 {
        sectors as u64 * bytes as u64
    } else {
        4096
    }
}

#[cfg(not(windows))]
fn cluster_size(_path: &Path) -> u64 {
    0
}

fn run_scan(app: &AppHandle, path: String) -> Result<ScanSummary, String> {
    let state = app.state::<AppState>();
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err("A scan is already running".into());
    }
    let _guard = ScanGuard(&state.scanning);
    state.cancel.store(false, Ordering::SeqCst);

    let scan_path = PathBuf::from(&path);
    if !scan_path.exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    if !scan_path.is_dir() {
        return Err(format!("Not a folder: {path}"));
    }

    let started = Instant::now();
    let ctx = Arc::new(ScanCtx {
        files_scanned: AtomicU64::new(0),
        total_size: AtomicU64::new(0),
        inaccessible: AtomicU64::new(0),
        current_path: Mutex::new(path.clone()),
        cancel: state.cancel.clone(),
        cluster_size: cluster_size(&scan_path),
    });

    let done = Arc::new(AtomicBool::new(false));
    let reporter = {
        let (ctx, done, app) = (ctx.clone(), done.clone(), app.clone());
        std::thread::spawn(move || {
            while !done.load(Ordering::Relaxed) {
                let current_path = ctx.current_path.lock().map(|p| p.clone()).unwrap_or_default();
                let _ = app.emit(
                    "scan-progress",
                    ScanProgress {
                        current_path,
                        files_scanned: ctx.files_scanned.load(Ordering::Relaxed),
                        total_size: ctx.total_size.load(Ordering::Relaxed),
                    },
                );
                std::thread::sleep(Duration::from_millis(150));
            }
        })
    };

    let name: Box<str> = scan_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone())
        .into();
    let root = scan_dir(&scan_path, name, &ctx);

    done.store(true, Ordering::Relaxed);
    let _ = reporter.join();

    if state.cancel.load(Ordering::SeqCst) {
        return Err("Scan cancelled".into());
    }

    // Rescanning a folder inside the current scan splices the fresh result
    // into the existing tree; anything else replaces it.
    let mut tree = state.tree();
    let splice_at = tree
        .as_ref()
        .and_then(|t| {
            t.find(&scan_path)?;
            t.relative(&scan_path)
        })
        .filter(|comps| !comps.is_empty());
    let root_path = match splice_at {
        Some(comps) => {
            let t = tree.as_mut().expect("splice target implies a tree");
            replace_at(&mut t.root, &comps, Some(root));
            t.root_path.clone()
        }
        None => {
            *tree = Some(ScanTree { root_path: scan_path.clone(), root });
            scan_path
        }
    };

    Ok(ScanSummary {
        root_path: root_path.to_string_lossy().into_owned(),
        scanned_path: path,
        inaccessible: ctx.inaccessible.load(Ordering::Relaxed),
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_drives() -> Vec<DriveInfo> {
    let disks = Disks::new_with_refreshed_list();

    disks
        .iter()
        .map(|disk| {
            let total = disk.total_space();
            let available = disk.available_space();
            DriveInfo {
                name: disk.name().to_string_lossy().to_string(),
                mount_point: disk.mount_point().to_string_lossy().to_string(),
                total_space: total,
                available_space: available,
                used_space: total.saturating_sub(available),
            }
        })
        .collect()
}

#[tauri::command]
async fn scan_directory(path: String, app: AppHandle) -> Result<ScanSummary, String> {
    tauri::async_runtime::spawn_blocking(move || run_scan(&app, path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_scan(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// Returns the node at `path` with `depth` levels of children.
#[tauri::command]
fn get_node(path: String, depth: u32, state: State<'_, AppState>) -> Result<FileEntry, String> {
    let tree = state.tree();
    let (node, full) = tree
        .as_ref()
        .and_then(|t| t.find(Path::new(&path)))
        .ok_or(NOT_IN_SCAN)?;
    Ok(to_entry(node, &full, depth.min(6), node.size, false))
}

/// Keeps the `limit` highest-ranked items seen, ranked by `key`.
struct TopN {
    limit: usize,
    heap: BinaryHeap<Reverse<(u64, String)>>,
}

impl TopN {
    fn new(limit: usize) -> Self {
        TopN { limit, heap: BinaryHeap::new() }
    }

    fn wants(&self, key: u64) -> bool {
        self.heap.len() < self.limit || self.heap.peek().is_some_and(|Reverse((min, _))| key > *min)
    }

    fn push(&mut self, key: u64, path: String) {
        self.heap.push(Reverse((key, path)));
        if self.heap.len() > self.limit {
            self.heap.pop();
        }
    }

    fn into_paths(self) -> Vec<String> {
        let mut items: Vec<_> = self.heap.into_iter().map(|Reverse(x)| x).collect();
        items.sort_unstable_by(|a, b| b.0.cmp(&a.0));
        items.into_iter().map(|(_, p)| p).collect()
    }
}

fn collect_top(node: &Node, path: &Path, top: &mut TopN, key: &dyn Fn(&Node) -> Option<u64>) {
    if let Some(k) = key(node) {
        if top.wants(k) {
            top.push(k, path.to_string_lossy().into_owned());
        }
    }
    for child in &node.children {
        if child.is_dir || key(child).is_some() {
            collect_top(child, &path.join(&*child.name), top, key);
        }
    }
}

fn top_entries(
    state: &AppState,
    path: &str,
    limit: usize,
    key: &dyn Fn(&Node) -> Option<u64>,
) -> Result<Vec<FileEntry>, String> {
    let tree = state.tree();
    let tree = tree.as_ref().ok_or(NOT_IN_SCAN)?;
    let (node, full) = tree.find(Path::new(path)).ok_or(NOT_IN_SCAN)?;
    let mut top = TopN::new(limit);
    collect_top(node, &full, &mut top, key);
    Ok(top
        .into_paths()
        .into_iter()
        .filter_map(|p| tree.find(Path::new(&p)).map(|(n, full)| to_entry(n, &full, 0, 0, false)))
        .collect())
}

#[tauri::command]
fn get_largest_files(path: String, limit: usize, state: State<'_, AppState>) -> Result<Vec<FileEntry>, String> {
    top_entries(&state, &path, limit, &|n| (!n.is_dir).then_some(n.size))
}

/// Folders ranked by the files directly inside them, so a cache folder with
/// thousands of files isn't outranked by every folder above it.
#[tauri::command]
fn get_folders_most_files(path: String, limit: usize, state: State<'_, AppState>) -> Result<Vec<FileEntry>, String> {
    top_entries(&state, &path, limit, &|n| (n.is_dir && n.direct_files > 0).then_some(n.direct_files))
}

#[tauri::command]
async fn open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(Path::new(&path).parent().unwrap_or(Path::new(&path)))
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Deletes an item inside the current scan, sending it to the Recycle Bin
/// unless `permanent` is set, and removes it from the scan tree.
#[tauri::command]
async fn delete_item(path: String, permanent: bool, app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let target = PathBuf::from(&path);
        let comps = state
            .tree()
            .as_ref()
            .and_then(|t| {
                t.find(&target)?;
                t.relative(&target)
            })
            .ok_or("Only items inside the current scan can be deleted")?;
        if comps.is_empty() || target.parent().is_none() {
            return Err("Refusing to delete the scanned folder itself".to_string());
        }

        if permanent {
            if target.is_dir() {
                fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(&target).map_err(|e| e.to_string())?;
            }
        } else {
            trash::delete(&target).map_err(|e| e.to_string())?;
        }

        if let Some(t) = state.tree().as_mut() {
            replace_at(&mut t.root, &comps, None);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_drives,
            scan_directory,
            cancel_scan,
            get_node,
            get_largest_files,
            get_folders_most_files,
            open_in_explorer,
            delete_item
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_ctx(cancel: bool) -> ScanCtx {
        ScanCtx {
            files_scanned: AtomicU64::new(0),
            total_size: AtomicU64::new(0),
            inaccessible: AtomicU64::new(0),
            current_path: Mutex::new(String::new()),
            cancel: Arc::new(AtomicBool::new(cancel)),
            cluster_size: 0,
        }
    }

    /// root/{a.bin(100), sub/{b.bin(50), c.bin(25), deep/{d.bin(10)}}}
    fn fixture() -> (tempdir::Dir, ScanTree) {
        let dir = tempdir::Dir::new();
        let root = dir.path().to_path_buf();
        fs::write(root.join("a.bin"), vec![0u8; 100]).unwrap();
        fs::create_dir_all(root.join("sub").join("deep")).unwrap();
        fs::write(root.join("sub").join("b.bin"), vec![0u8; 50]).unwrap();
        fs::write(root.join("sub").join("c.bin"), vec![0u8; 25]).unwrap();
        fs::write(root.join("sub").join("deep").join("d.bin"), vec![0u8; 10]).unwrap();
        let node = scan_dir(&root, "root".into(), &test_ctx(false));
        (dir, ScanTree { root_path: root, root: node })
    }

    mod tempdir {
        use std::path::{Path, PathBuf};
        pub struct Dir(PathBuf);
        impl Dir {
            pub fn new() -> Self {
                use std::sync::atomic::{AtomicU32, Ordering};
                static N: AtomicU32 = AtomicU32::new(0);
                let p = std::env::temp_dir().join(format!(
                    "drivemole-test-{}-{}",
                    std::process::id(),
                    N.fetch_add(1, Ordering::SeqCst)
                ));
                std::fs::create_dir_all(&p).unwrap();
                Dir(p)
            }
            pub fn path(&self) -> &Path {
                &self.0
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn scan_totals_include_every_level() {
        let (_dir, tree) = fixture();
        let root = &tree.root;
        assert_eq!(root.logical_size, 185);
        assert_eq!(root.file_count, 4);
        assert_eq!(root.dir_count, 2);
        assert_eq!(root.direct_files, 1);
        // Largest first.
        assert_eq!(&*root.children[0].name, "a.bin");
        let sub = root.children.iter().find(|c| &*c.name == "sub").unwrap();
        assert_eq!((sub.logical_size, sub.file_count, sub.direct_files), (85, 3, 2));
    }

    #[test]
    fn relative_and_find_resolve_paths() {
        let (_dir, tree) = fixture();
        let deep = tree.root_path.join("sub").join("deep");
        assert_eq!(tree.relative(&deep).unwrap(), vec!["sub", "deep"]);
        assert_eq!(tree.relative(&tree.root_path).unwrap(), Vec::<String>::new());
        assert!(tree.relative(&tree.root_path.join("..")).is_some_and(|c| c == vec![".."]));
        let sibling = PathBuf::from(format!("{}x", tree.root_path.display()));
        assert!(tree.relative(&sibling).is_none());
        let (node, full) = tree.find(&deep.join("d.bin")).unwrap();
        assert_eq!(node.logical_size, 10);
        assert_eq!(full, deep.join("d.bin"));
        assert!(tree.find(&deep.join("missing")).is_none());
    }

    #[test]
    fn largest_files_reach_deep_folders() {
        let (_dir, tree) = fixture();
        let mut top = TopN::new(2);
        collect_top(&tree.root, &tree.root_path, &mut top, &|n| (!n.is_dir).then_some(n.logical_size));
        let names: Vec<_> = top
            .into_paths()
            .iter()
            .map(|p| Path::new(p).file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["a.bin", "b.bin"]);

        let mut all = TopN::new(10);
        collect_top(&tree.root, &tree.root_path, &mut all, &|n| (!n.is_dir).then_some(n.logical_size));
        assert_eq!(all.into_paths().len(), 4);
    }

    #[test]
    fn most_files_ranks_by_direct_files() {
        let (_dir, tree) = fixture();
        let mut top = TopN::new(10);
        collect_top(&tree.root, &tree.root_path, &mut top, &|n| {
            (n.is_dir && n.direct_files > 0).then_some(n.direct_files)
        });
        let paths = top.into_paths();
        // "sub" has 2 files directly inside; the root (4 recursive, 1 direct) ranks below it.
        assert_eq!(Path::new(&paths[0]).file_name().unwrap(), "sub");
    }

    #[test]
    fn removing_a_node_updates_every_ancestor() {
        let (_dir, mut tree) = fixture();
        let comps = vec!["sub".to_string(), "deep".to_string(), "d.bin".to_string()];
        assert!(replace_at(&mut tree.root, &comps, None));
        assert_eq!(tree.root.logical_size, 175);
        assert_eq!(tree.root.file_count, 3);
        let sub = tree.root.children.iter().find(|c| &*c.name == "sub").unwrap();
        assert_eq!((sub.logical_size, sub.file_count, sub.dir_count), (75, 2, 1));
        let deep = &sub.children.iter().find(|c| &*c.name == "deep").unwrap();
        assert_eq!((deep.direct_files, deep.file_count, deep.children.len()), (0, 0, 0));

        assert!(replace_at(&mut tree.root, &["sub".to_string()], None));
        assert_eq!((tree.root.logical_size, tree.root.file_count, tree.root.dir_count), (100, 1, 0));
        assert!(!replace_at(&mut tree.root, &["sub".to_string()], None));
    }

    #[test]
    fn splicing_a_rescan_updates_totals() {
        let (_dir, mut tree) = fixture();
        let sub_path = tree.root_path.join("sub");
        fs::write(sub_path.join("new.bin"), vec![0u8; 1000]).unwrap();
        let rescanned = scan_dir(&sub_path, "sub".into(), &test_ctx(false));
        assert!(replace_at(&mut tree.root, &["sub".to_string()], Some(rescanned)));
        assert_eq!(tree.root.logical_size, 1185);
        assert_eq!(tree.root.file_count, 5);
        // Re-sorted: "sub" is now the largest child.
        assert_eq!(&*tree.root.children[0].name, "sub");
    }

    #[test]
    fn cancelled_scan_stops_early() {
        let (dir, _) = fixture();
        let node = scan_dir(dir.path(), "root".into(), &test_ctx(true));
        assert_eq!(node.file_count, 0);
    }

    #[test]
    fn nested_entries_drop_tiny_children() {
        let (_dir, tree) = fixture();
        let entry = to_entry(&tree.root, &tree.root_path, 2, 1_000_000, false);
        let children = entry.children.unwrap();
        // Direct children are always complete...
        assert_eq!(children.len(), 2);
        // ...but nested ones below 0.1% of the top size are omitted.
        let sub = children.iter().find(|c| c.name == "sub").unwrap();
        assert!(sub.children.as_ref().unwrap().is_empty());
        assert_eq!(sub.omitted_children, Some(3));
    }

    #[test]
    fn rounds_up_to_cluster() {
        assert_eq!(round_up(0, 4096), 0);
        assert_eq!(round_up(1, 4096), 4096);
        assert_eq!(round_up(4096, 4096), 4096);
        assert_eq!(round_up(4097, 4096), 8192);
        assert_eq!(round_up(123, 0), 123);
    }
}
