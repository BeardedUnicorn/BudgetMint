fn main() {
    // Which BudgetMint this is (src/environment.rs): BUDGETMINT_ENV,
    // "production" for a release and "dev" (also when unset) for any other
    // build, the variable that picks the webview's Firebase projects too
    // (scripts/environment.mjs).
    println!("cargo:rerun-if-env-changed=BUDGETMINT_ENV");
    let environment = std::env::var("BUDGETMINT_ENV")
        .ok()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "dev".to_string());
    if environment != "production" && environment != "dev" {
        panic!(
            "BUDGETMINT_ENV is \"{environment}\", but it can only be \"production\" or \"dev\" (unset means \"dev\")."
        );
    }
    println!("cargo:rustc-env=BUDGETMINT_ENV={environment}");

    // The app's one command gets permissions of its own (allow-dispatch), so
    // the webview reaches it only through capabilities/default.json
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["dispatch"])),
    )
    .expect("failed to run tauri-build");
}
