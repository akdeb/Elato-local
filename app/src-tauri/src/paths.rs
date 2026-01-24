use std::path::PathBuf;

use tauri::{AppHandle, Manager};

pub(crate) fn get_elato_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Failed to resolve app data directory")
}

pub(crate) fn get_voices_dir(app: &AppHandle) -> PathBuf {
    get_elato_dir(app).join("voices")
}

pub(crate) fn get_images_dir(app: &AppHandle) -> PathBuf {
    get_elato_dir(app).join("images")
}

pub(crate) fn get_venv_path(app: &AppHandle) -> PathBuf {
    get_elato_dir(app).join("python_env")
}

pub(crate) fn get_bootstrap_python_root(app: &AppHandle) -> PathBuf {
    let resource_dir = app
        .path()
        .resource_dir()
        .expect("Failed to resolve resource directory");

    let direct = resource_dir.join("python_runtime");
    if direct.exists() {
        return direct;
    }

    let dev_resources = resource_dir
        .join("_up_")
        .join("_up_")
        .join("resources")
        .join("python_runtime");
    if dev_resources.exists() {
        return dev_resources;
    }

    direct
}

pub(crate) fn get_bootstrap_python(app: &AppHandle) -> PathBuf {
    let root = get_bootstrap_python_root(app);
    let bin = root.join("python").join("bin");
    let python = bin.join("python");
    if python.exists() {
        return python;
    }

    let python3 = bin.join("python3");
    if python3.exists() {
        return python3;
    }

    bin.join("python3.11")
}

pub(crate) fn bootstrap_python_if_needed(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(target_arch = "aarch64") == false {
        return Err("This build supports Apple Silicon only".to_string());
    }

    let python_path = get_bootstrap_python(app);
    if python_path.exists() {
        return Ok(python_path);
    }

    Err(format!(
        "Bundled Python runtime not found at {}. Ensure resources/python_runtime is included in the Tauri bundle.",
        python_path.display()
    ))
}

pub(crate) fn get_venv_python(app: &AppHandle) -> PathBuf {
    let venv = get_venv_path(app);
    if cfg!(target_os = "windows") {
        venv.join("Scripts").join("python.exe")
    } else {
        let bin = venv.join("bin");
        let python = bin.join("python");
        if python.exists() {
            return python;
        }
        bin.join("python3")
    }
}

pub(crate) fn get_venv_pip(app: &AppHandle) -> PathBuf {
    let venv = get_venv_path(app);
    if cfg!(target_os = "windows") {
        venv.join("Scripts").join("pip.exe")
    } else {
        let bin = venv.join("bin");
        let pip = bin.join("pip");
        if pip.exists() {
            return pip;
        }
        bin.join("pip3")
    }
}
