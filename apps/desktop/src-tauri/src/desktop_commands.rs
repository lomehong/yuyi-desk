use std::collections::HashSet;
use std::fs;
use std::path::Path;

fn idle_milliseconds(now: u32, last_input: u32) -> u64 {
    u64::from(now.wrapping_sub(last_input))
}

#[cfg(windows)]
#[tauri::command]
pub fn desktop_get_system_idle_time() -> Result<u64, String> {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    if unsafe { GetLastInputInfo(&mut info) } == 0 {
        return Err("GetLastInputInfo failed".to_string());
    }
    Ok(idle_milliseconds(unsafe { GetTickCount() }, info.dwTime))
}

#[cfg(not(windows))]
#[tauri::command]
pub fn desktop_get_system_idle_time() -> Result<u64, String> {
    Ok(0)
}

fn garbage_collect_attachments_in(
    directory: &Path,
    referenced_ids: &[String],
) -> Result<usize, String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let referenced: HashSet<&str> = referenced_ids.iter().map(String::as_str).collect();
    let mut removed = 0;
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().map_err(|error| error.to_string())?.is_file() {
            continue;
        }
        let file_name = entry.file_name();
        let attachment_id = Path::new(&file_name)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default();
        if referenced.contains(attachment_id) {
            continue;
        }
        fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
        removed += 1;
    }
    Ok(removed)
}

#[tauri::command]
pub fn garbage_collect_attachment_files(
    referenced_ids: Option<Vec<String>>,
) -> Result<usize, String> {
    let directory = super::daemon_home().join("desktop-attachments");
    garbage_collect_attachments_in(&directory, &referenced_ids.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::{garbage_collect_attachments_in, idle_milliseconds};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn idle_time_uses_milliseconds_and_handles_tick_wraparound() {
        assert_eq!(idle_milliseconds(1_000, 400), 600);
        assert_eq!(idle_milliseconds(3, u32::MAX - 1), 5);
    }

    #[test]
    fn attachment_garbage_collection_removes_only_unreferenced_files() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "yuyi-desk-attachments-test-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("keep.txt"), b"keep").unwrap();
        fs::write(directory.join("remove.txt"), b"remove").unwrap();

        let removed = garbage_collect_attachments_in(&directory, &["keep".to_string()]).unwrap();

        assert_eq!(removed, 1);
        assert!(directory.join("keep.txt").exists());
        assert!(!directory.join("remove.txt").exists());
        fs::remove_dir_all(directory).unwrap();
    }
}
