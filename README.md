<p align="center">
  <img src="https://raw.githubusercontent.com/kbcrumbs/drivemole/main/app-icon.png" alt="DriveMole" width="160" />
</p>

<h1 align="center">DriveMole</h1>

<p align="center">
  A fast disk analyzer. Find out what's eating your drive, then dig it out.
</p>

<p align="center">
  <a href="https://crates.io/crates/drivemole"><img src="https://img.shields.io/crates/v/drivemole.svg" alt="crates.io" /></a>
  <img src="https://img.shields.io/badge/built%20with-Tauri%202-blue" alt="Built with Tauri 2" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license" />
</p>

---

DriveMole is a disk analyzer. It scans a drive or folder in parallel, keeps the whole result in memory, and lets you explore it as a tree, a treemap, or a sunburst chart. Drilling into folders, finding the largest files and deleting things are all instant, with no rescans.

## Features

- **Fast parallel scanning.** Folders are scanned across all CPU cores; a full system drive with over a million files typically takes seconds.
- **Accurate sizes.** Shows real size on disk (cluster rounding, compressed, sparse and cloud placeholder files) and skips symlinks and junctions so nothing is counted twice.
- **Three views.** A sortable, filterable tree, a squarified treemap coloured by file type, and a four-level sunburst chart.
- **Top 100 largest files** from every level of the scan, not just the top folders.
- **Folders with the most files**, ranked by files directly inside them, which surfaces caches, logs and temp folders.
- **Safe deletes.** Items go to the Recycle Bin by default; permanent delete is opt-in. Totals update instantly.
- **Quick navigation.** Breadcrumbs, Back (Alt+←) and Up (Alt+↑), and refreshing a subfolder only rescans that subfolder.
- **Light and dark themes** that follow your system setting.

## Install

### From crates.io

```bash
cargo install drivemole
```

This needs a Rust toolchain plus the [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform (on Windows, WebView2, which ships with Windows 10 and 11).

### From source

```bash
git clone https://github.com/kbcrumbs/drivemole.git
cd drivemole
npm install
npm run app:build
```

The app is written to `src-tauri/target/release/drivemole(.exe)` and installers to `src-tauri/target/release/bundle/`.

## Development

Requires [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/) (stable) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run app:dev        # run with hot reload
cd src-tauri && cargo test
```

`app:dev` disables the `custom-protocol` Cargo feature so the window loads the Vite dev server. The feature is on by default so that plain `cargo build` and `cargo install` serve the bundled frontend.

### Publishing to crates.io

The crate ships the built frontend and Tauri's generated permission schemas, so build both first:

```bash
npm run build        # writes src-tauri/dist
cd src-tauri
cargo build          # refreshes gen/schemas
cargo publish --dry-run
cargo publish
```

## Tips

- Some system folders can't be read without administrator rights. DriveMole tells you how many it skipped; run it as administrator for complete totals.
- Hard-linked files (common in `C:\Windows\WinSxS`) are counted once per link, as Windows Explorer does.

## Tech stack

- **Backend:** Rust, Tauri 2, rayon
- **Frontend:** React 18, TypeScript, Tailwind CSS, Lucide icons
- **Charts:** custom SVG treemap and sunburst

DriveMole is developed and tested on Windows. The code builds for macOS and Linux but hasn't been tested there yet; reports are welcome.

## Contributing

Issues and pull requests are welcome.

## License

[MIT](LICENSE)
