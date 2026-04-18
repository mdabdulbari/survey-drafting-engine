//! External tool discovery.
//!
//! Searches `PATH` first, then a set of well-known conda/mamba installation
//! prefixes.  Adding support for a new tool is a one-line call to
//! [`find_tool`].

use std::path::{Path, PathBuf};

// ── Public API ───────────────────────────────────────────────────────────────

/// Locate the `pdal` executable.
pub fn find_pdal() -> Option<PathBuf> {
    find_tool(if cfg!(windows) { "pdal.exe" } else { "pdal" })
}

// ── Internal ─────────────────────────────────────────────────────────────────

/// Locate any named tool by searching PATH then conda prefixes.
fn find_tool(name: &str) -> Option<PathBuf> {
    if let Ok(path) = which::which(name) {
        return Some(path);
    }
    conda_roots()
        .into_iter()
        .flatten()
        .find_map(|root| {
            let candidate = conda_bin(&root, name);
            candidate.exists().then_some(candidate)
        })
}

/// Returns all candidate conda/mamba installation roots to search.
///
/// Home-directory paths are `None` when there is no home directory; they are
/// filtered out by the `flatten()` call in [`find_tool`].
fn conda_roots() -> Vec<Option<PathBuf>> {
    let home = dirs_next::home_dir();
    let mut roots = vec![
        home.as_deref().map(|h| h.join("miniforge3")),
        home.as_deref().map(|h| h.join("miniconda3")),
        home.as_deref().map(|h| h.join("anaconda3")),
    ];
    roots.extend(platform_conda_roots());
    roots
}

// ── Platform-specific helpers ────────────────────────────────────────────────

#[cfg(windows)]
fn platform_conda_roots() -> Vec<Option<PathBuf>> {
    vec![
        Some(PathBuf::from(r"C:\ProgramData\miniforge3")),
        Some(PathBuf::from(r"C:\ProgramData\miniconda3")),
    ]
}

#[cfg(windows)]
fn conda_bin(root: &Path, name: &str) -> PathBuf {
    root.join("Library").join("bin").join(name)
}

#[cfg(not(windows))]
fn platform_conda_roots() -> Vec<Option<PathBuf>> {
    vec![
        Some(PathBuf::from("/opt/conda")),
        Some(PathBuf::from("/opt/homebrew")),
    ]
}

#[cfg(not(windows))]
fn conda_bin(root: &Path, name: &str) -> PathBuf {
    root.join("bin").join(name)
}
