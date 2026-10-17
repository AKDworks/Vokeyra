#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, WindowEvent};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::oneshot;

type Reply = Result<Value, String>;
type Pending = HashMap<u64, oneshot::Sender<Reply>>;
fn linux_wayland() -> bool {
    cfg!(target_os = "linux")
        && (std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland")
            || std::env::var("WAYLAND_DISPLAY").is_ok_and(|value| !value.is_empty()))
}
struct Service {
    input: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Mutex<Pending>,
    next: AtomicU64,
}
struct Desktop {
    service: Arc<Service>,
    settings: Mutex<Value>,
    quitting: AtomicBool,
    configured: AtomicBool,
    update_busy: AtomicBool,
}

impl Service {
    fn send(&self, message: Value) -> Result<(), String> {
        let mut input = self.input.lock().map_err(|e| e.to_string())?;
        let mut line = serde_json::to_vec(&message).map_err(|e| e.to_string())?;
        line.push(b'\n');
        input.write_all(&line).map_err(|e| e.to_string())?;
        input.flush().map_err(|e| e.to_string())
    }
    async fn request(&self, method: &str, args: Value) -> Reply {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, sender);
        if let Err(error) = self.send(json!({"id": id, "method": method, "args": args})) {
            self.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
        let result = tokio::time::timeout(Duration::from_secs(1200), receiver).await;
        self.pending.lock().unwrap().remove(&id);
        result
            .map_err(|_| "Служба распознавания не отвечает.".to_string())?
            .map_err(|_| "Служба распознавания завершилась.".to_string())?
    }
    fn event(&self, event: &str, payload: Value) {
        let _ = self.send(json!({"event": event, "payload": payload}));
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
fn shutdown(app: tauri::AppHandle) {
    let state = app.state::<Desktop>();
    if state.quitting.swap(true, Ordering::SeqCst) {
        return;
    }
    let service = state.service.clone();
    tauri::async_runtime::spawn(async move {
        let _ = tokio::time::timeout(
            Duration::from_secs(10),
            service.request("service:shutdown", json!([])),
        )
        .await;
        let _ = service.child.lock().unwrap().kill();
        app.exit(0);
    });
}

#[tauri::command]
async fn service_request(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    method: String,
    args: Vec<Value>,
) -> Reply {
    if window.label() != "main"
        && !(window.label() == "overlay"
            && ["overlay:state", "overlay:cancel"].contains(&method.as_str()))
    {
        return Err("Недоверенный источник запроса.".into());
    }
    // Never expose service lifecycle or host operations to a renderer.
    let allowed = [
        "app:snapshot",
        "settings:save",
        "settings:reset",
        "catalog:refresh",
        "models:download",
        "models:cancel",
        "models:delete",
        "models:delete-all",
        "models:select",
        "models:open",
        "models:license",
        "recording:begin",
        "recording:prepare-audio",
        "recording:finish-audio",
        "recording:transcribe",
        "recording:cancel",
        "recording:level",
        "clipboard:copy",
        "shortcut:begin-capture",
        "shortcut:end-capture",
        "history:delete",
        "history:favorite",
        "history:audio",
        "history:retranscribe",
        "history:open",
        "history:clear",
        "app:open-data",
        "app:open-licenses",
        "app:open-github",
        "app:start-update",
        "overlay:state",
        "overlay:cancel",
    ];
    if !allowed.contains(&method.as_str()) {
        return Err("Неизвестная команда.".into());
    }
    let service = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(state) = app.try_state::<Desktop>() {
                break state.service.clone();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .map_err(|_| "Не удалось запустить службу распознавания.".to_string())?;
    service.request(&method, Value::Array(args)).await
}

async fn apply_settings(app: &tauri::AppHandle, settings: Value) -> Reply {
    let state = app.state::<Desktop>();
    let first = !state.configured.swap(true, Ordering::SeqCst);
    let old = state.settings.lock().unwrap().clone();
    let size = settings["windowSize"].as_str().unwrap_or("compact");
    if first || old["windowSize"] != settings["windowSize"] {
        let window = app
            .get_webview_window("main")
            .ok_or("Main window unavailable")?;
        let (width, height) = if size == "medium" {
            (920., 700.)
        } else {
            (780., 600.)
        };
        window
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        window.center().map_err(|e| e.to_string())?;
    }
    if !cfg!(debug_assertions) && std::env::var_os("VOKEYRA_TEST_DATA").is_none() {
        if settings["launchAtStartup"].as_bool().unwrap_or(false) {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        }
        .map_err(|e| e.to_string())?;
    }
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_visible(settings["showTrayIcon"].as_bool().unwrap_or(true))
            .map_err(|e| e.to_string())?;
        if first || old["appLanguage"] != settings["appLanguage"] {
            let english = settings["appLanguage"] == "en";
            let open = MenuItem::with_id(
                app,
                "open",
                if english {
                    "Open Vokeyra"
                } else {
                    "Открыть Vokeyra"
                },
                true,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            let quit = MenuItem::with_id(
                app,
                "quit",
                if english { "Quit" } else { "Выйти" },
                true,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?;
            tray.set_menu(Some(
                Menu::with_items(app, &[&open, &quit]).map_err(|e| e.to_string())?,
            ))
            .map_err(|e| e.to_string())?;
        }
    }
    *state.settings.lock().unwrap() = settings.clone();
    if first
        && !settings["hideOnStartup"].as_bool().unwrap_or(false)
        && !std::env::args().any(|arg| arg == "--hidden")
    {
        show_main(app);
    }
    Ok(Value::Null)
}

fn update_event(
    app: &tauri::AppHandle,
    phase: &str,
    version: Option<&str>,
    percent: Option<u64>,
    message: Option<&str>,
) -> Value {
    let mut value =
        json!({"phase": phase, "currentVersion": app.package_info().version.to_string()});
    if let Some(version) = version {
        value["latestVersion"] = json!(version);
    }
    if let Some(percent) = percent {
        value["percent"] = json!(percent.min(100));
    }
    if let Some(message) = message {
        value["message"] = json!(message);
    }
    app.state::<Desktop>()
        .service
        .event("app:update-state", value.clone());
    value
}

async fn check_update(app: tauri::AppHandle) -> Reply {
    if app
        .state::<Desktop>()
        .update_busy
        .swap(true, Ordering::SeqCst)
    {
        return Err("Обновление уже выполняется.".into());
    }
    update_event(&app, "checking", None, None, None);
    let result: Reply = async {
        // Older Electron releases have no Tauri manifest. Check version first so
        // a missing latest.json is not reported as a broken connection on 0.3.0.
        let release: Value = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("Vokeyra")
            .build()
            .map_err(|e| e.to_string())?
            .get("https://api.github.com/repos/AKDworks/Vokeyra/releases/latest")
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let tag = release["tag_name"]
            .as_str()
            .ok_or("Некорректная версия обновления.")?
            .trim_start_matches('v');
        let latest = semver::Version::parse(tag).map_err(|e| e.to_string())?;
        if latest <= app.package_info().version {
            return Ok(update_event(&app, "current", Some(tag), None, None));
        }
        let update = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?
            .ok_or("Подписанный пакет обновления ещё не опубликован.")?;
        update_event(&app, "available", Some(&update.version), None, None);
        let mut received = 0_u64;
        let bytes = update
            .download(
                |chunk, total| {
                    received += chunk as u64;
                    let percent = total
                        .filter(|total| *total > 0)
                        .map(|total| received.saturating_mul(100) / total);
                    update_event(&app, "downloading", Some(&update.version), percent, None);
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
        update_event(&app, "installing", Some(&update.version), None, None);
        let service = app.state::<Desktop>().service.clone();
        service.request("service:shutdown", json!([])).await?;
        if let Err(error) = update.install(bytes) {
            // Cleanup was necessary before replacement; exit so a new launch
            // starts a healthy service rather than keeping a shut-down backend.
            let message = error.to_string();
            eprintln!("Update install failed: {message}");
            app.restart();
        }
        app.restart();
    }
    .await;
    app.state::<Desktop>()
        .update_busy
        .store(false, Ordering::SeqCst);
    if let Err(ref error) = result {
        update_event(&app, "error", None, None, Some(error));
    }
    result
}

async fn host_request(app: tauri::AppHandle, method: &str, args: &[Value]) -> Reply {
    let text = || {
        args.first()
            .and_then(Value::as_str)
            .ok_or_else(|| "Некорректный аргумент.".to_string())
    };
    match method {
        "settings:apply" => {
            apply_settings(&app, args.first().cloned().ok_or("Missing settings")?).await
        }
        "shortcut:register" => {
            if linux_wayland() {
                return Ok(json!(false));
            }
            let key = text()?.replace("CommandOrControl", "Ctrl");
            if app.global_shortcut().is_registered(key.as_str()) {
                return Ok(json!(true));
            }
            Ok(json!(app.global_shortcut().register(key.as_str()).is_ok()))
        }
        "shortcut:unregister" => {
            if linux_wayland() {
                return Ok(Value::Null);
            }
            app.global_shortcut()
                .unregister(text()?.replace("CommandOrControl", "Ctrl").as_str())
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "shortcut:clear" => {
            if linux_wayland() {
                return Ok(Value::Null);
            }
            app.global_shortcut()
                .unregister_all()
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "clipboard:write" => {
            app.clipboard()
                .write_text(text()?)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "clipboard:read" => Ok(json!(app.clipboard().read_text().unwrap_or_default())),
        "window:focused" => Ok(json!(app
            .get_webview_window("main")
            .is_some_and(|w| w.is_focused().unwrap_or(false)))),
        "path:open" => {
            app.opener()
                .open_path(text()?, None::<&str>)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "path:reveal" => {
            app.opener()
                .reveal_item_in_dir(text()?)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "url:open" => {
            let url = text()?;
            if !url.starts_with("https://") {
                return Err("Нужна HTTPS-ссылка.".into());
            }
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "overlay:hide" => {
            if let Some(w) = app.get_webview_window("overlay") {
                let _ = w.hide();
            }
            Ok(Value::Null)
        }
        "overlay:show" => {
            let w = app
                .get_webview_window("overlay")
                .ok_or("Overlay unavailable")?;
            let cursor = app.cursor_position().map_err(|e| e.to_string())?;
            let monitor = app
                .monitor_from_point(cursor.x, cursor.y)
                .map_err(|e| e.to_string())?
                .or(app.primary_monitor().map_err(|e| e.to_string())?)
                .ok_or("Monitor unavailable")?;
            let scale = monitor.scale_factor();
            let area = monitor.work_area();
            let x = area.position.x + ((area.size.width as f64 - 248. * scale) / 2.).round() as i32;
            let y = if text()? == "top" {
                area.position.y + (20. * scale) as i32
            } else {
                area.position.y + area.size.height as i32 - (78. * scale) as i32
            };
            w.set_position(PhysicalPosition::new(x, y))
                .map_err(|e| e.to_string())?;
            w.show().map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "update:check" => check_update(app).await,
        _ => Err(format!("Unknown host command: {method}")),
    }
}

fn start_service(
    app: &tauri::AppHandle,
) -> Result<
    (
        Arc<Service>,
        std::process::ChildStdout,
        std::process::ChildStderr,
    ),
    Box<dyn std::error::Error>,
> {
    let desktop = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(if cfg!(target_os = "linux") {
            "../dist/desktop-linux"
        } else {
            "../dist/desktop"
        })
    } else {
        app.path().resource_dir()?.join("desktop")
    };
    // Windows canonical resource paths may start with \\?\, which Node's
    // module loader cannot reliably resolve. Preserve Unicode while removing
    // the extended prefix wherever a normal Windows path can represent it.
    let desktop = dunce::simplified(&desktop).to_path_buf();
    let data = if let Some(path) = std::env::var_os("VOKEYRA_TEST_DATA") {
        PathBuf::from(path)
    } else {
        if cfg!(windows) {
            app.path().config_dir()?.join("Vokeyra")
        } else {
            app.path().data_dir()?.join("Vokeyra")
        }
    };
    let data = dunce::simplified(&data).to_path_buf();
    std::fs::create_dir_all(&data)?;
    let config = json!({"dataPath": data, "resourcePath": desktop, "version": app.package_info().version.to_string(),
        "packaged": !cfg!(debug_assertions), "hidden": std::env::args().any(|arg| arg == "--hidden")});
    let mut command = Command::new(desktop.join(if cfg!(windows) { "node.exe" } else { "node" }));
    command
        .arg(desktop.join("service.cjs"))
        .current_dir(&desktop)
        .env("VOKEYRA_HOST_CONFIG", config.to_string())
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn()?;
    let input = child.stdin.take().unwrap();
    let output = child.stdout.take().unwrap();
    let errors = child.stderr.take().unwrap();
    let service = Arc::new(Service {
        input: Mutex::new(input),
        child: Mutex::new(child),
        pending: Mutex::new(HashMap::new()),
        next: AtomicU64::new(1),
    });
    Ok((service, output, errors))
}

fn read_service(
    app: &tauri::AppHandle,
    service: Arc<Service>,
    output: std::process::ChildStdout,
    errors: std::process::ChildStderr,
) {
    let weak = Arc::downgrade(&service);
    let handle = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines() {
            let Ok(line) = line else { break };
            if line.len() > 16_000_000 {
                break;
            }
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(service) = weak.upgrade() else { break };
            if let Some(id) = message["id"].as_u64() {
                if let Some(sender) = service.pending.lock().unwrap().remove(&id) {
                    let result = if let Some(error) = message["error"].as_str() {
                        Err(error.into())
                    } else {
                        Ok(message["result"].clone())
                    };
                    let _ = sender.send(result);
                }
            } else if let Some(host_id) = message["hostId"].as_u64() {
                let handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let result = host_request(
                        handle,
                        message["method"].as_str().unwrap_or(""),
                        message["args"].as_array().map(Vec::as_slice).unwrap_or(&[]),
                    )
                    .await;
                    let reply = match result {
                        Ok(value) => json!({"hostId": host_id, "result": value}),
                        Err(error) => json!({"hostId": host_id, "error": error}),
                    };
                    let _ = service.send(reply);
                });
            } else if let Some(event) = message["event"].as_str() {
                if event == "service:error" {
                    show_main(&handle);
                }
                let target = message["target"].as_str().unwrap_or("main");
                if ["main", "overlay"].contains(&target) {
                    let _ = handle.emit_to(target, event, message["payload"].clone());
                }
            }
        }
        if let Some(service) = weak.upgrade() {
            for (_, sender) in service.pending.lock().unwrap().drain() {
                let _ = sender.send(Err(
                    "Служба распознавания завершилась. Перезапустите Vokeyra.".into(),
                ));
            }
        }
        let _ = handle.emit_to(
            "main",
            "service:error",
            "Служба распознавания завершилась. Перезапустите Vokeyra.",
        );
    });
    std::thread::spawn(move || {
        for line in BufReader::new(errors).lines().map_while(Result::ok) {
            eprintln!("{line}");
        }
    });
}

fn main() {
    let builder = tauri::Builder::default()
        .on_permission_request(|webview, kind| {
            use tauri::webview::{PermissionKind, PermissionResponse};
            if !cfg!(target_os = "linux") {
                return PermissionResponse::Default;
            }
            let local = webview.url().ok().is_some_and(|url| {
                (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                    || (["http", "https"].contains(&url.scheme())
                        && url.host_str() == Some("tauri.localhost"))
                    || (cfg!(debug_assertions)
                        && url.scheme() == "http"
                        && url.host_str() == Some("127.0.0.1")
                        && url.port() == Some(1420))
            });
            if webview.label() == "main" && local && matches!(kind, PermissionKind::Microphone) {
                PermissionResponse::Allow
            } else {
                PermissionResponse::Deny
            }
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--autostart"])
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build());
    // Isolated smoke profiles may run alongside the user's normal app.
    let builder = if std::env::var_os("VOKEYRA_TEST_DATA").is_some() {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app)
        }))
    };
    // The shortcut backend is X11-only. Do not initialize it on native Wayland,
    // including sessions without XWayland; the recorder and clipboard still work.
    let builder = if linux_wayland() {
        builder
    } else {
        builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(state) = app.try_state::<Desktop>() {
                            state.service.event("shortcut:pressed", Value::Null);
                        }
                    } else if !cfg!(windows) {
                        if let Some(state) = app.try_state::<Desktop>() {
                            state.service.event("shortcut:released", Value::Null);
                        }
                    }
                })
                .build(),
        )
    };
    builder
        .setup(|app| {
            let (service, output, errors) = start_service(app.handle())?;
            app.manage(Desktop {
                service: service.clone(),
                settings: Mutex::new(Value::Null),
                quitting: AtomicBool::new(false),
                configured: AtomicBool::new(false),
                update_busy: AtomicBool::new(false),
            });
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Vokeyra")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => shutdown(app.clone()),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            // Process requests only after state and the tray are registered.
            read_service(app.handle(), service, output, errors);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![service_request])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            let app = window.app_handle();
            if let Some(state) = app.try_state::<Desktop>() {
                match event {
                    WindowEvent::CloseRequested { api, .. }
                        if !state.quitting.load(Ordering::SeqCst) =>
                    {
                        api.prevent_close();
                        if state.settings.lock().unwrap()["showTrayIcon"]
                            .as_bool()
                            .unwrap_or(true)
                        {
                            let _ = window.hide();
                        } else {
                            shutdown(app.clone());
                        }
                    }
                    WindowEvent::Focused(false) => state.service.event("window:blur", Value::Null),
                    _ => {}
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Failed to initialize Vokeyra")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<Desktop>().quitting.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    shutdown(app.clone());
                }
            }
        });
}
