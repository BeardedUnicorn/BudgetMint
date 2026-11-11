fn main() {
    // The app's one command gets permissions of its own (allow-dispatch), so
    // the webview reaches it only through capabilities/default.json
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["dispatch"])),
    )
    .expect("failed to run tauri-build");
}
