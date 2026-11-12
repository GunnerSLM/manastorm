use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Window};

const SAVE_FILE_NAME: &str = "save_v1.json";
const SETTINGS_FILE_NAME: &str = "settings_v1.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeInfo {
    pub runtime: String,
    pub platform: String,
    pub version: String,
    pub app_data_dir: String,
    pub fullscreen: bool,
}

#[derive(Serialize)]
pub struct WriteStatus {
    pub ok: bool,
    pub bytes: usize,
}

#[derive(Serialize)]
pub struct FullscreenStatus {
    pub fullscreen: bool,
}

fn resolve_app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app_data_dir: {e}"))?;
    Ok(dir)
}

fn atomic_write_file(target_path: &PathBuf, content: &str) -> Result<usize, String> {
    let tmp_path = target_path.with_extension("json.tmp");
    fs::write(&tmp_path, content.as_bytes())
        .map_err(|e| format!("Failed writing temp file: {e}"))?;
    fs::rename(&tmp_path, target_path)
        .map_err(|e| format!("Failed committing atomic rename: {e}"))?;
    Ok(content.len())
}

#[tauri::command]
fn desktop_get_info(app: AppHandle, window: Window) -> Result<DesktopRuntimeInfo, String> {
    let dir = resolve_app_data_dir(&app)?;
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    Ok(DesktopRuntimeInfo {
        runtime: "tauri".to_string(),
        platform: std::env::consts::OS.to_string(),
        version: app.package_info().version.to_string(),
        app_data_dir: dir.to_string_lossy().to_string(),
        fullscreen,
    })
}

#[tauri::command]
fn desktop_load_save(app: AppHandle) -> Result<Option<String>, String> {
    let path = resolve_app_data_dir(&app)?.join(SAVE_FILE_NAME);
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(&path).map_err(|e| format!("Failed reading save file: {e}"))?;
    Ok(Some(data))
}

#[tauri::command]
fn desktop_write_save(app: AppHandle, payload: String) -> Result<WriteStatus, String> {
    let path = resolve_app_data_dir(&app)?.join(SAVE_FILE_NAME);
    let bytes = atomic_write_file(&path, &payload)?;
    Ok(WriteStatus { ok: true, bytes })
}

#[tauri::command]
fn desktop_clear_save(app: AppHandle) -> Result<WriteStatus, String> {
    let path = resolve_app_data_dir(&app)?.join(SAVE_FILE_NAME);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed removing save file: {e}"))?;
    }
    Ok(WriteStatus { ok: true, bytes: 0 })
}

#[tauri::command]
fn desktop_load_settings(app: AppHandle) -> Result<Option<String>, String> {
    let path = resolve_app_data_dir(&app)?.join(SETTINGS_FILE_NAME);
    if !path.exists() {
        return Ok(None);
    }
    let data =
        fs::read_to_string(&path).map_err(|e| format!("Failed reading settings file: {e}"))?;
    Ok(Some(data))
}

#[tauri::command]
fn desktop_write_settings(app: AppHandle, payload: String) -> Result<WriteStatus, String> {
    let path = resolve_app_data_dir(&app)?.join(SETTINGS_FILE_NAME);
    let bytes = atomic_write_file(&path, &payload)?;
    Ok(WriteStatus { ok: true, bytes })
}

#[tauri::command]
fn desktop_toggle_fullscreen(window: Window) -> Result<FullscreenStatus, String> {
    let current = window.is_fullscreen().unwrap_or(false);
    let next = !current;
    window
        .set_fullscreen(next)
        .map_err(|e| format!("Failed setting fullscreen: {e}"))?;
    Ok(FullscreenStatus { fullscreen: next })
}

#[tauri::command]
fn desktop_set_fullscreen(window: Window, fullscreen: bool) -> Result<FullscreenStatus, String> {
    window
        .set_fullscreen(fullscreen)
        .map_err(|e| format!("Failed setting fullscreen: {e}"))?;
    Ok(FullscreenStatus { fullscreen })
}

#[tauri::command]
fn desktop_set_title(window: Window, title: String) -> Result<WriteStatus, String> {
    window
        .set_title(&title)
        .map_err(|e| format!("Failed setting window title: {e}"))?;
    Ok(WriteStatus {
        ok: true,
        bytes: title.len(),
    })
}

#[tauri::command]
fn desktop_quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            desktop_get_info,
            desktop_load_save,
            desktop_write_save,
            desktop_clear_save,
            desktop_load_settings,
            desktop_write_settings,
            desktop_toggle_fullscreen,
            desktop_set_fullscreen,
            desktop_set_title,
            desktop_quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running MANASTORM Tauri desktop application");
}
