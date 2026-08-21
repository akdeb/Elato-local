use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use tauri::{AppHandle, Emitter};

/// Streamed to the UI while pip works, so the panel can show what it is doing
/// instead of a static "this may take a few minutes".
#[derive(Clone, serde::Serialize)]
pub struct DepsProgress {
    pub step: usize,
    pub steps: usize,
    pub phase: String,
    pub package: String,
    pub downloaded: usize,
    pub total: Option<usize>,
}

/// pip names the package on "Collecting x" / "Downloading x-1.2-....whl" lines,
/// and reveals the full install list once on "Installing collected packages: a, b".
fn parse_pip_line(line: &str, downloaded: &mut usize, total: &mut Option<usize>) -> Option<(String, String)> {
    let line = line.trim();

    if let Some(rest) = line.strip_prefix("Collecting ") {
        *downloaded += 1;
        let name = rest.split(['=', '<', '>', '!', '~', '[', ' ']).next().unwrap_or(rest);
        return Some(("downloading".to_string(), name.to_string()));
    }

    if let Some(rest) = line.strip_prefix("Installing collected packages: ") {
        *total = Some(rest.split(',').count());
        return Some(("installing".to_string(), String::new()));
    }

    if line.starts_with("Successfully installed") {
        return Some(("done".to_string(), String::new()));
    }

    None
}

/// Runs pip with its output streamed line by line, emitting progress as it goes.
/// `--progress-bar off` keeps pip from emitting carriage-return bars, which would
/// otherwise never terminate a line for the reader.
fn run_pip_streaming(
    app: &AppHandle,
    pip_path: &str,
    args: &[String],
    step: usize,
    steps: usize,
    downloaded: &mut usize,
) -> Result<(), String> {
    let mut child = Command::new(pip_path)
        .args(args)
        .arg("--progress-bar")
        .arg("off")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start pip: {e}"))?;

    let mut total: Option<usize> = None;
    let mut tail: Vec<String> = Vec::new();

    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some((phase, package)) = parse_pip_line(&line, downloaded, &mut total) {
                app.emit(
                    "deps-progress",
                    DepsProgress {
                        step,
                        steps,
                        phase,
                        package,
                        downloaded: *downloaded,
                        total,
                    },
                )
                .ok();
            }
            tail.push(line);
            if tail.len() > 40 {
                tail.remove(0);
            }
        }
    }

    let mut stderr_text = String::new();
    if let Some(stderr) = child.stderr.take() {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            stderr_text.push_str(&line);
            stderr_text.push('\n');
        }
    }

    let status = child.wait().map_err(|e| format!("pip failed: {e}"))?;
    if !status.success() {
        let detail = if stderr_text.trim().is_empty() {
            tail.join("\n")
        } else {
            stderr_text
        };
        // pip's failures are verbose; the tail is where the actual cause lives.
        let detail: String = detail.lines().rev().take(6).collect::<Vec<_>>().join(" ");
        return Err(format!("pip install failed: {detail}"));
    }

    Ok(())
}

const EMBEDDED_REQUIREMENTS: &str =
    include_str!("../../../resources/python-backend/requirements.lock");

fn parse_requirement_specs(requirements: &str) -> Vec<String> {
    requirements
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter(|line| !line.starts_with('-'))
        .map(|line| line.to_string())
        .collect()
}

fn normalize_dependency_name(spec: &str) -> Option<String> {
    let trimmed = spec.split(';').next().unwrap_or("").trim();
    if trimmed.is_empty() {
        return None;
    }

    let before_at = trimmed.split('@').next().unwrap_or("").trim();
    if before_at.is_empty() {
        return None;
    }

    let mut end = before_at.len();
    for (idx, ch) in before_at.char_indices() {
        if matches!(ch, '=' | '<' | '>' | '!' | '~') {
            end = idx;
            break;
        }
    }

    let name = &before_at[..end];
    let name = name.split('[').next().unwrap_or("").trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn load_requirements() -> Result<&'static str, String> {
    if EMBEDDED_REQUIREMENTS.trim().is_empty() {
        return Err("Embedded requirements.lock is empty".to_string());
    }
    Ok(EMBEDDED_REQUIREMENTS)
}

pub fn pyproject_dependency_names(_app: &AppHandle) -> Result<Vec<String>, String> {
    let requirements = load_requirements()?;
    let specs = parse_requirement_specs(requirements);

    let mut out: Vec<String> = specs
        .into_iter()
        .filter_map(|dep| normalize_dependency_name(&dep))
        .collect();
    out.sort();
    out.dedup();
    Ok(out)
}

pub fn install_python_deps(app: &AppHandle, pip_path: PathBuf) -> Result<String, String> {
    if !pip_path.exists() {
        return Err("Virtual environment not found. Please create it first.".to_string());
    }
    let pip = pip_path
        .to_str()
        .ok_or_else(|| "Invalid pip path".to_string())?
        .to_string();

    let _ = Command::new(&pip)
        .arg("install")
        .arg("--upgrade")
        .arg("pip")
        .output();

    let requirements = load_requirements()?;
    let specs = parse_requirement_specs(requirements);
    if specs.is_empty() {
        return Err("No dependencies found in requirements.lock".to_string());
    }

    // Install mlx-audio without deps to avoid resolver conflicts with mlx family versions.
    let mut mlx_audio_spec: Option<String> = None;
    let mut rest: Vec<String> = Vec::new();
    for dep in specs {
        if dep.starts_with("mlx-audio") {
            if mlx_audio_spec.is_some() {
                return Err("Multiple mlx-audio entries found in requirements.lock".to_string());
            }
            mlx_audio_spec = Some(dep);
        } else {
            rest.push(dep);
        }
    }

    let steps = if mlx_audio_spec.is_some() { 2 } else { 1 };
    let mut downloaded = 0usize;

    if let Some(spec) = mlx_audio_spec {
        let args: Vec<String> = vec![
            "install".into(),
            "--upgrade".into(),
            "--force-reinstall".into(),
            "--no-deps".into(),
            "--prefer-binary".into(),
            spec,
        ];
        run_pip_streaming(app, &pip, &args, 1, steps, &mut downloaded)
            .map_err(|e| format!("mlx-audio: {e}"))?;
    }

    let mut args: Vec<String> = vec![
        "install".into(),
        "--upgrade".into(),
        "--force-reinstall".into(),
        "--prefer-binary".into(),
    ];
    args.extend(rest);
    run_pip_streaming(app, &pip, &args, steps, steps, &mut downloaded)?;

    Ok("Dependencies installed successfully".to_string())
}
