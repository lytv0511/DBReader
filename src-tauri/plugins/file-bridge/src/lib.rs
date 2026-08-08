use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, plugin::PluginHandle};

const PLUGIN_IDENTIFIER: &str = "com.vincentleong.dbreader";
const PLUGIN_CLASS: &str = "FileBridgePlugin";

struct FileBridgeState(Mutex<Option<PluginHandle<tauri::Wry>>>);

impl Default for FileBridgeState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

#[derive(Serialize)]
struct CopyArgs<'a> {
    uri: &'a str,
    file_name: &'a str,
}

#[derive(Deserialize)]
struct CopyResponse {
    path: Option<String>,
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("filebridge")
        .invoke_handler(tauri::generate_handler![copy_uri_to_cache, export_to_document])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, PLUGIN_CLASS)?;
                app.manage(FileBridgeState(Mutex::new(Some(handle))));
            }
            Ok(())
        })
        .build()
}

#[tauri::command]
fn copy_uri_to_cache(
    uri: String,
    file_name: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<FileBridgeState>();
        let handle = state
            .0
            .lock()
            .unwrap()
            .clone()
            .ok_or("file-bridge plugin not started")?;
        let response: CopyResponse = handle
            .run_mobile_plugin(
                "copyToCache",
                CopyArgs {
                    uri: &uri,
                    file_name: &file_name,
                },
            )
            .map_err(|e| e.to_string())?;
        response.path.ok_or_else(|| "Copy failed, no path returned".into())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (uri, file_name, app);
        Err("File import is only supported on Android".into())
    }
}

#[tauri::command]
fn export_to_document(
    path: String,
    file_name: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<FileBridgeState>();
        let handle = state
            .0
            .lock()
            .unwrap()
            .clone()
            .ok_or("file-bridge plugin not started")?;
        handle
            .run_mobile_plugin::<serde_json::Value>(
                "exportDocument",
                CopyArgs {
                    uri: &path,
                    file_name: &file_name,
                },
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (path, file_name, app);
        Err("File export is only supported on Android".into())
    }
}
