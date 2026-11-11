//! A file the webview made (the budget's backup, its spreadsheet), as the
//! save dialog offers it: the name it suggests, and the kind of file it
//! filters for.

use crate::platform::SaveFile;

/// `name` and `contents` as a file to save; refused for a name that isn't
/// one plain file's (no folders: the dialog chooses where).
pub fn to_save(name: &str, contents: String) -> Result<SaveFile, String> {
    let plain = !name.is_empty()
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':'])
        && name.chars().all(|c| !c.is_control());
    if !plain {
        return Err(format!("Can't save a file named {:?}", name));
    }
    let extension = name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    let kind = match extension.as_str() {
        "json" => "BudgetMint backup",
        "csv" => "Spreadsheet (CSV)",
        _ => "File",
    };
    Ok(SaveFile {
        name: name.to_string(),
        contents,
        kind: kind.to_string(),
        extension,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_kind_of_file_by_its_extension() {
        let backup = to_save("budgetmint-2026-11-10.json", "{}".into()).unwrap();
        assert_eq!(
            backup,
            SaveFile {
                name: "budgetmint-2026-11-10.json".into(),
                contents: "{}".into(),
                kind: "BudgetMint backup".into(),
                extension: "json".into(),
            }
        );
        assert_eq!(
            to_save("a.CSV", String::new()).unwrap().kind,
            "Spreadsheet (CSV)"
        );
        let plain = to_save("notes", String::new()).unwrap();
        assert_eq!(
            (plain.kind.as_str(), plain.extension.as_str()),
            ("File", "")
        );
    }

    #[test]
    fn refuses_a_name_with_a_folder_in_it() {
        for name in [
            "",
            ".hidden",
            "../up.json",
            "a/b.json",
            "c:\\x.csv",
            "C:x",
            "line\nbreak",
        ] {
            assert_eq!(
                to_save(name, String::new()),
                Err(format!("Can't save a file named {:?}", name)),
                "{}",
                name
            );
        }
    }
}
