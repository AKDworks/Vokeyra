use tauri::WebviewWindow;

// The user explicitly presses Allow in our microphone settings. Change only
// this local main window's browser permission; OS privacy controls still apply.
#[cfg(windows)]
pub async fn grant_permission(window: WebviewWindow) -> Result<(), String> {
    use std::sync::{Arc, Mutex};
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Profile4, ICoreWebView2_13, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        },
        SetPermissionStateCompletedHandler,
    };
    use windows::core::{Interface, HSTRING};

    let url = window.url().map_err(|e| e.to_string())?;
    let local = (url.scheme() == "https" && url.host_str() == Some("tauri.localhost"))
        || (cfg!(debug_assertions)
            && url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(1420));
    if window.label() != "main" || !local {
        return Err("Недоверенный источник запроса.".into());
    }
    let origin = url.origin().ascii_serialization();
    let (send, receive) = tokio::sync::oneshot::channel();
    let send = Arc::new(Mutex::new(Some(send)));
    window
        .with_webview(move |webview| {
            let completed = send.clone();
            let result = (|| -> windows::core::Result<()> {
                let core: ICoreWebView2_13 =
                    unsafe { webview.controller().CoreWebView2()? }.cast()?;
                let profile: ICoreWebView2Profile4 = unsafe { core.Profile()? }.cast()?;
                let callback =
                    SetPermissionStateCompletedHandler::create(Box::new(move |result| {
                        if let Some(send) = completed.lock().unwrap().take() {
                            let _ = send.send(result.map_err(|e| e.to_string()));
                        }
                        Ok(())
                    }));
                unsafe {
                    profile.SetPermissionState(
                        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                        &HSTRING::from(origin),
                        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                        &callback,
                    )
                }
            })();
            if let Err(error) = result {
                if let Some(send) = send.lock().unwrap().take() {
                    let _ = send.send(Err(error.to_string()));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(10), receive)
        .await
        .map_err(|_| "Не удалось повторно запросить доступ к микрофону.".to_string())?
        .map_err(|_| "Не удалось повторно запросить доступ к микрофону.".to_string())?
        .map_err(|error| {
            eprintln!("Microphone permission grant failed: {error}");
            "Не удалось повторно запросить доступ к микрофону.".to_string()
        })
}

#[cfg(not(windows))]
pub async fn grant_permission(_window: WebviewWindow) -> Result<(), String> {
    Ok(())
}
