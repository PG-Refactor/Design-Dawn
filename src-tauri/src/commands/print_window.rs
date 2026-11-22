//! Printing in a window of its own: the print page (made by the Frontend) is shown in a
//! child window of the window that prints, and the print dialog opens there: on Linux the
//! WebKitGTK print dialog run from here (the window closes when it is done), elsewhere the
//! page's own `print()`. After that dialog (printed or cancelled) the page goes to a
//! sentinel address that this side catches and answers by closing the window: a page's own
//! `close()` only blanks it in WebView2 and leaves the window open. The app's own window is never covered by the print preview, so it stays
//! usable (and closable) while the dialog is open. The print window has no access to the
//! app's commands (its label matches no capability) and is not part of the window
//! registry: it closes like a plain window, and its page file is removed with it.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder, Window};
use uuid::Uuid;

use super::{percent_decoded, run_blocking};
use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};

const PRINT_WINDOW_PREFIX: &str = "print-";
const PAGE_FILE_EXTENSION: &str = "html";
const HEADER_TITLE: &str = "x-dawn-print-title";
/// The print window's size in logical pixels (a page and the dialog beside it fit).
const PRINT_WINDOW_WIDTH: f64 = 960.0;
const PRINT_WINDOW_HEIGHT: f64 = 840.0;
/// The largest print page accepted (images are inside it).
const PRINT_PAGE_MAX_BYTES: usize = 200 * 1024 * 1024;
/// Added to the page where the page opens the print dialog itself.
#[cfg(not(target_os = "linux"))]
const PRINT_ON_LOAD_SCRIPT: &str = r#"<script>addEventListener("load",function(){print();});addEventListener("afterprint",function(){location.href="https://dawn-print-done.invalid/";});</script>"#;
/// Where the page goes once its print dialog is over (`.invalid` never resolves).
#[cfg(not(target_os = "linux"))]
const PRINT_DONE_HOST: &str = "dawn-print-done.invalid";
#[cfg(not(target_os = "linux"))]
const BODY_END: &str = "</body>";

struct PrintWindow {
    owner: String,
    page_file: PathBuf,
}

/// The print windows that are open, by label.
#[derive(Default)]
pub struct PrintWindows {
    windows: HashMap<String, PrintWindow>,
}

pub fn is_print_window(label: &str) -> bool {
    label.starts_with(PRINT_WINDOW_PREFIX)
}

fn failed(detail: impl Into<String>) -> ApplicationError {
    ApplicationError::new(ErrorKind::ExportFailed, detail)
}

/// A print window went away: its page file is removed.
pub fn forget_print_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let removed = app.try_state::<Mutex<PrintWindows>>().and_then(|state| {
        state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .windows
            .remove(label)
    });
    if let Some(window) = removed {
        let _ = std::fs::remove_file(window.page_file);
    }
}

fn labels_owned_by<R: Runtime>(app: &AppHandle<R>, owner: &str) -> Vec<String> {
    app.state::<Mutex<PrintWindows>>()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .windows
        .iter()
        .filter(|(_, window)| window.owner == owner)
        .map(|(label, _)| label.clone())
        .collect()
}

/// Opens the print window for the calling window (body: the page as UTF-8; header: the
/// window title, percent-encoded). The page prints itself once loaded.
#[tauri::command]
pub async fn open_print_window<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), ApplicationError> {
    let title = request
        .headers()
        .get(HEADER_TITLE)
        .and_then(|value| value.to_str().ok())
        .map(percent_decoded)
        .unwrap_or_default();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(failed("body is not raw bytes"));
    };
    if bytes.len() > PRINT_PAGE_MAX_BYTES {
        return Err(failed("the print page is too large"));
    }
    let html = String::from_utf8(bytes.clone()).map_err(|_| failed("the page is not UTF-8"))?;
    let owner = window.label().to_owned();
    run_blocking(move || open(&app, &owner, &title, &html)).await
}

fn open<R: Runtime>(
    app: &AppHandle<R>,
    owner: &str,
    title: &str,
    html: &str,
) -> ApplicationResult<()> {
    let id = Uuid::now_v7();
    let label = format!("{PRINT_WINDOW_PREFIX}{id}");
    let page_file = std::env::temp_dir().join(format!("dawn-print-{id}.{PAGE_FILE_EXTENSION}"));
    #[cfg(not(target_os = "linux"))]
    let html = html.replacen(BODY_END, &format!("{PRINT_ON_LOAD_SCRIPT}{BODY_END}"), 1);
    std::fs::write(&page_file, html).map_err(|error| failed(format!("page file: {error}")))?;
    let url = Url::from_file_path(&page_file).map_err(|()| failed("the page file has no URL"))?;
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .title(title)
        .inner_size(PRINT_WINDOW_WIDTH, PRINT_WINDOW_HEIGHT)
        .center();
    #[cfg(not(target_os = "linux"))]
    {
        let closer = app.clone();
        let closing_label = label.clone();
        builder = builder.on_navigation(move |url| {
            if url.host_str() != Some(PRINT_DONE_HOST) {
                return true;
            }
            // Not from inside the navigation callback: the window is destroyed afterwards.
            let app = closer.clone();
            let label = closing_label.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.destroy();
                }
            });
            false
        });
    }
    #[cfg(target_os = "linux")]
    {
        builder = builder.on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                run_print_dialog(webview.app_handle(), webview.label());
            }
        });
    }
    // Owned by `owner`: without it, the window that asked for the print stopped drawing and
    // answering once the print was saved (seen on Windows).
    if let Some(parent) = app.get_webview_window(owner) {
        builder = builder
            .parent(&parent)
            .map_err(|error| failed(format!("print window owner: {error}")))?;
    }
    app.state::<Mutex<PrintWindows>>()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .windows
        .insert(
            label.clone(),
            PrintWindow {
                owner: owner.to_owned(),
                page_file: page_file.clone(),
            },
        );
    if let Err(error) = builder.build() {
        forget_print_window(app, &label);
        return Err(failed(format!("print window: {error}")));
    }
    Ok(())
}

/// The WebKitGTK print dialog over the print window, run once the page is loaded. The window
/// closes when the dialog is cancelled, or when printing has finished.
#[cfg(target_os = "linux")]
fn run_print_dialog<R: Runtime>(app: &AppHandle<R>, label: &str) {
    use webkit2gtk::{PrintOperationExt, PrintOperationResponse};

    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    let closing = window.clone();
    let _ = window.with_webview(move |platform| {
        let operation = webkit2gtk::PrintOperation::new(&platform.inner());
        let finished = closing.clone();
        operation.connect_finished(move |_| {
            let _ = finished.destroy();
        });
        let failed_window = closing.clone();
        operation.connect_failed(move |_, _| {
            let _ = failed_window.destroy();
        });
        let parent = closing.gtk_window().ok();
        if operation.run_dialog(parent.as_ref()) == PrintOperationResponse::Cancel {
            let _ = closing.destroy();
        }
    });
}

/// Whether the calling window has a print window open.
#[tauri::command]
pub fn print_windows_open<R: Runtime>(app: AppHandle<R>, window: Window<R>) -> bool {
    !labels_owned_by(&app, window.label()).is_empty()
}

/// Hides (or shows again) the calling window's print windows: a question of the calling
/// window ("stop printing and close?") is not covered by them while it is asked.
#[tauri::command]
pub fn set_print_windows_hidden<R: Runtime>(app: AppHandle<R>, window: Window<R>, hidden: bool) {
    for label in labels_owned_by(&app, window.label()) {
        if let Some(print_window) = app.get_webview_window(&label) {
            let shown = if hidden {
                print_window.hide()
            } else {
                print_window.show()
            };
            if let Err(error) = shown {
                eprintln!("failed to hide or show a print window: {error}");
            }
        }
    }
}

/// Closes the calling window's print windows (their print dialogs end with them).
#[tauri::command]
pub fn close_print_windows<R: Runtime>(app: AppHandle<R>, window: Window<R>) {
    for label in labels_owned_by(&app, window.label()) {
        if let Some(print_window) = app.get_webview_window(&label) {
            let _ = print_window.destroy();
        }
        forget_print_window(&app, &label);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn print_windows_are_told_apart_by_their_label() {
        assert!(is_print_window("print-0190"));
        assert!(!is_print_window("main"));
        assert!(!is_print_window("window-2"));
    }
}
