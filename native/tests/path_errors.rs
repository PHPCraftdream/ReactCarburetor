use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU32, Ordering};

const OFFENDER: &str = concat!(
    "class Widget extends AntiHookComponent {
",
    "    componentDidMount = () => {
",
    "        super.componentDidMount();
",
    "        run();
    };
}
"
);
const CLEAN: &str = "const value = 1;\n";

struct Workspace(PathBuf);

impl Workspace {
    fn new() -> Self {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "carburetor-path-errors-{}-{id}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

impl std::ops::Deref for Workspace {
    type Target = Path;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

fn run(cwd: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_carburetor-lint"))
        .current_dir(cwd)
        .args(args)
        .output()
        .expect("binary runs")
}

fn modes(format: &str) -> Vec<Vec<String>> {
    [vec![], vec!["--fix".into()], vec!["--fix-dry-run".into()]]
        .into_iter()
        .map(|mut mode| {
            if format == "json" {
                mode.push("--format=json".into());
            }
            mode
        })
        .collect()
}

#[test]
fn missing_file_is_an_error_in_all_formats_and_modes() {
    let dir = Workspace::new();
    let missing = "does-not-exist.tsx";
    for format in ["human", "json"] {
        for mut args in modes(format) {
            args.push(missing.into());
            let refs: Vec<&str> = args.iter().map(String::as_str).collect();
            let output = run(&dir, &refs);
            assert_eq!(
                output.status.code(),
                Some(2),
                "{format} {args:?}; stdout: {}; stderr: {}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(output.stdout.is_empty());
            assert!(!output.stderr.is_empty());
            assert!(String::from_utf8_lossy(&output.stderr).contains(missing));
            assert!(!String::from_utf8_lossy(&output.stdout).contains("no problems found"));
        }
    }
}

#[test]
fn clean_and_offender_exit_codes_are_stable_for_formats_and_modes() {
    for format in ["human", "json"] {
        for mode in modes(format) {
            for (name, source, expected) in [("clean.tsx", CLEAN, 0), ("offender.tsx", OFFENDER, 1)]
            {
                let dir = Workspace::new();
                std::fs::write(dir.join(name), source).unwrap();
                let mut args = mode.clone();
                let expected = if args
                    .iter()
                    .any(|arg| arg == "--fix" || arg == "--fix-dry-run")
                {
                    0
                } else {
                    expected
                };
                args.push(name.into());
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                let output = run(&dir, &refs);
                assert_eq!(output.status.code(), Some(expected), "{format} {args:?}");
            }
        }
    }
}

#[test]
fn invalid_utf8_source_is_a_read_error_in_all_modes() {
    let dir = Workspace::new();
    let path = dir.join("invalid.tsx");
    std::fs::write(&path, [0xff, 0xfe]).unwrap();
    for format in ["human", "json"] {
        for mut args in modes(format) {
            args.push("invalid.tsx".into());
            let refs: Vec<&str> = args.iter().map(String::as_str).collect();
            let output = run(&dir, &refs);
            assert_eq!(
                output.status.code(),
                Some(2),
                "{format} {args:?}; stdout: {}; stderr: {}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(String::from_utf8_lossy(&output.stderr).contains("invalid.tsx"));
            assert!(!String::from_utf8_lossy(&output.stdout).contains("no problems found"));
        }
    }
}

#[cfg(unix)]
#[test]
fn unreadable_file_is_reported_without_changing_permissions() {
    use std::os::unix::fs::PermissionsExt;

    let dir = Workspace::new();
    let path = dir.join("locked.tsx");
    std::fs::write(&path, OFFENDER).unwrap();
    let original = std::fs::metadata(&path).unwrap().permissions().mode();
    let mut permissions = std::fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o000);
    std::fs::set_permissions(&path, permissions).unwrap();
    let restore = RestorePermissions {
        path: path.clone(),
        mode: original,
    };
    if std::fs::read(&path).is_ok() {
        eprintln!("skipping permission assertions: process can read mode-000 files");
        return;
    }
    for format in ["human", "json"] {
        for mode in modes(format) {
            for target in ["locked.tsx", "."] {
                let mut args = mode.clone();
                args.push(target.into());
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                let output = run(&dir, &refs);
                assert_eq!(
                    output.status.code(),
                    Some(2),
                    "{format} {args:?}; stdout: {}; stderr: {}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
                assert!(String::from_utf8_lossy(&output.stderr).contains("locked.tsx"));
            }
        }
    }
    drop(restore);
}

#[cfg(unix)]
#[test]
fn unreadable_nested_directory_is_reported() {
    use std::os::unix::fs::PermissionsExt;

    let dir = Workspace::new();
    let nested = dir.join("nested");
    std::fs::create_dir(&nested).unwrap();
    std::fs::write(nested.join("clean.tsx"), CLEAN).unwrap();
    let original = std::fs::metadata(&nested).unwrap().permissions().mode();
    std::fs::set_permissions(&nested, std::fs::Permissions::from_mode(0o000)).unwrap();
    let restore = RestorePermissions {
        path: nested.clone(),
        mode: original,
    };
    if std::fs::read_dir(&nested).is_ok() {
        eprintln!("skipping permission assertions: process can traverse mode-000 directories");
        return;
    }
    for format in ["human", "json"] {
        for mode in modes(format) {
            for target in ["nested", "."] {
                let mut args = mode.clone();
                args.push(target.into());
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                let output = run(&dir, &refs);
                assert_eq!(output.status.code(), Some(2), "{format} {args:?}");
                assert!(String::from_utf8_lossy(&output.stderr).contains("nested"));
            }
        }
    }
    drop(restore);
}

#[cfg(unix)]
struct RestorePermissions {
    path: PathBuf,
    mode: u32,
}

#[cfg(unix)]
impl Drop for RestorePermissions {
    fn drop(&mut self) {
        use std::os::unix::fs::PermissionsExt;

        let _ = std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(self.mode));
    }
}

#[cfg(windows)]
#[test]
fn windows_share_locked_file_is_reported_in_all_modes() {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;

    let dir = Workspace::new();
    let path = dir.join("locked.tsx");
    std::fs::write(&path, OFFENDER).unwrap();
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    let error = std::fs::read_to_string(&path).unwrap_err();
    assert_eq!(error.raw_os_error(), Some(32), "{error:?}");
    for format in ["human", "json"] {
        for mode in modes(format) {
            for target in ["locked.tsx", "."] {
                let mut args = mode.clone();
                args.push(target.into());
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                let output = run(&dir, &refs);
                assert_eq!(
                    output.status.code(),
                    Some(2),
                    "{format} {args:?}; stdout: {}; stderr: {}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
                assert!(String::from_utf8_lossy(&output.stderr).contains("locked.tsx"));
            }
        }
    }
    drop(lock);
}

#[test]
fn native_file_override_suppresses_test_file_and_cli_wins() {
    let dir = Workspace::new();
    let source = concat!(
        "export function work(items: string[]) { ",
        "return items.map(item => item.length); }
"
    );
    std::fs::write(dir.join("file.ts"), source).unwrap();
    std::fs::write(dir.join("file.test.ts"), source).unwrap();
    let config = concat!(
        r#"{"overrides":[{"files":["**/*.test.ts"],"rules":{"#,
        r#""carburetor/require-module-function":"off"}}]}"#,
    );
    std::fs::write(dir.join("config.json"), config).unwrap();
    let first = run(&dir, &["--config=config.json", "--format=json", "."]);
    let found: serde_json::Value = serde_json::from_slice(&first.stdout).unwrap();
    assert_eq!(found.as_array().unwrap().len(), 1);
    let cli = run(
        &dir,
        &[
            "--config=config.json",
            "--rule=carburetor/require-module-function=error",
            "--format=json",
            ".",
        ],
    );
    let found: serde_json::Value = serde_json::from_slice(&cli.stdout).unwrap();
    assert_eq!(found.as_array().unwrap().len(), 2);
    assert!(found
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["severity"] == "error"));
}
