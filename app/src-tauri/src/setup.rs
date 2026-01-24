use std::fs;
use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::paths::{
    bootstrap_python_if_needed, get_bootstrap_python, get_elato_dir, get_venv_path, get_venv_pip,
    get_venv_python,
};
use crate::python_setup;

fn pip_has_package(python: &PathBuf, name: &str) -> bool {
    Command::new(python.to_str().unwrap())
        .arg("-m")
        .arg("pip")
        .arg("show")
        .arg(name)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn deps_installed_from_pyproject(app: &AppHandle, python: &PathBuf) -> bool {
    let deps = python_setup::pyproject_dependency_names(app).unwrap_or_default();
    if deps.is_empty() {
        return false;
    }
    deps.iter().all(|dep| pip_has_package(python, dep))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupStatus {
    pub python_installed: bool,
    pub python_version: Option<String>,
    pub python_path: Option<String>,
    pub venv_exists: bool,
    pub venv_path: Option<String>,
    pub deps_installed: bool,
}

#[tauri::command]
pub async fn check_setup_status(app: AppHandle) -> Result<SetupStatus, String> {
    let venv_path = get_venv_path(&app);
    let venv_python = get_venv_python(&app);
    let venv_exists = venv_python.exists();

    let bootstrap_python = get_bootstrap_python(&app);

    let (python_installed, python_version, python_path) = if venv_exists {
        let output = Command::new(venv_python.to_str().unwrap())
            .arg("--version")
            .output()
            .ok();
        let v = output.as_ref().and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });
        (true, v, Some(venv_python.to_string_lossy().to_string()))
    } else if bootstrap_python.exists() {
        let output = Command::new(bootstrap_python.to_str().unwrap())
            .arg("--version")
            .output()
            .ok();
        let v = output.as_ref().and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });
        (true, v, Some(bootstrap_python.to_string_lossy().to_string()))
    } else {
        (false, None, None)
    };

    let deps_installed = if venv_exists {
        deps_installed_from_pyproject(&app, &venv_python)
    } else {
        false
    };

    Ok(SetupStatus {
        python_installed,
        python_version,
        python_path,
        venv_exists,
        venv_path: if venv_exists {
            Some(venv_path.to_string_lossy().to_string())
        } else {
            None
        },
        deps_installed,
    })
}

#[tauri::command]
pub async fn create_python_venv(app: AppHandle) -> Result<String, String> {
    let venv_path = get_venv_path(&app);
    let venv_python = get_venv_python(&app);

    app.emit("setup-progress", "Using bundled Python runtime...")
        .ok();
    let python_for_venv = bootstrap_python_if_needed(&app)?;

    if venv_python.exists() {
        app.emit("setup-progress", "Virtual environment already exists...")
            .ok();
        return Ok(venv_path.to_string_lossy().to_string());
    }

    if venv_path.exists() || fs::symlink_metadata(&venv_path).is_ok() {
        app.emit("setup-progress", "Cleaning up existing invalid environment...")
            .ok();
        if venv_path.is_dir() {
            fs::remove_dir_all(&venv_path).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(&venv_path).map_err(|e| e.to_string())?;
        }
    }

    if let Some(parent) = venv_path.parent() {
        fs::create_dir_all(parent).map_err(|e: std::io::Error| e.to_string())?;
    }

    app.emit("setup-progress", "Creating Python virtual environment...")
        .ok();

    let output = Command::new(python_for_venv.to_str().unwrap())
        .arg("-m")
        .arg("venv")
        .arg("--clear")
        .arg(&venv_path)
        .output()
        .map_err(|e| format!("Failed to create venv: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to create venv: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(venv_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn install_python_deps(app: AppHandle) -> Result<String, String> {
    let pip = get_venv_pip(&app);

    app.emit(
        "setup-progress",
        "Installing Python dependencies (this may take a few minutes)...",
    )
    .ok();

    let result = python_setup::install_python_deps(&app, pip)?;
    app.emit("setup-progress", "Dependencies installed successfully!")
        .ok();
    Ok(result)
}

#[tauri::command]
pub async fn mark_setup_complete(app: AppHandle) -> Result<(), String> {
    let elato_dir = get_elato_dir(&app);
    let marker_file = elato_dir.join(".setup_complete");
    fs::create_dir_all(&elato_dir).map_err(|e: std::io::Error| e.to_string())?;
    fs::write(&marker_file, "1").map_err(|e: std::io::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn is_first_launch(app: AppHandle) -> Result<bool, String> {
    let elato_dir = get_elato_dir(&app);
    let marker_file = elato_dir.join(".setup_complete");
    let venv_python = get_venv_python(&app);

    Ok(!marker_file.exists() || !venv_python.exists())
}
