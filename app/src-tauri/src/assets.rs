use std::fs;
use std::io::Read;

use tauri::AppHandle;
use base64::Engine;

use crate::paths::{get_images_dir, get_voices_dir};

#[tauri::command]
pub async fn download_voice(app: AppHandle, voice_id: String) -> Result<String, String> {
    let url = format!(
        "https://pub-6b92949063b142d59fc3478c56ec196c.r2.dev/{}.wav",
        voice_id
    );

    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to download: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Failed to download: HTTP {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let dir = get_voices_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.wav", voice_id));
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn save_voice_wav_base64(
    app: AppHandle,
    voice_id: String,
    base64_wav: String,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_wav)
        .map_err(|e| format!("Failed to decode base64 wav: {}", e))?;

    let dir = get_voices_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.wav", voice_id));
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn save_personality_image_base64(
    app: AppHandle,
    personality_id: String,
    base64_image: String,
    ext: Option<String>,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_image)
        .map_err(|e| format!("Failed to decode base64 image: {}", e))?;

    let safe_ext = ext
        .unwrap_or_else(|| "png".to_string())
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>();

    let safe_ext = if safe_ext.is_empty() {
        "png".to_string()
    } else {
        safe_ext
    };

    let dir = get_images_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("personality_{}.{}", personality_id, safe_ext));
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_voice_base64(app: AppHandle, voice_id: String) -> Result<Option<String>, String> {
    let path = get_voices_dir(&app).join(format!("{}.wav", voice_id));
    if !path.exists() {
        return Ok(None);
    }
    let mut f = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf: Vec<u8> = vec![];
    f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(buf);
    Ok(Some(encoded))
}

#[tauri::command]
pub fn list_downloaded_voices(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = get_voices_dir(&app);
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut out: Vec<String> = vec![];
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(v) => v,
            None => continue,
        };
        if !name.ends_with(".wav") {
            continue;
        }
        let voice_id = name.trim_end_matches(".wav");
        if !voice_id.is_empty() {
            out.push(voice_id.to_string());
        }
    }
    out.sort();
    Ok(out)
}

