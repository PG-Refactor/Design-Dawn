//! Window size persistence (docs/architecture.md §11.0.1): recording the size of a window
//! about to be destroyed, and applying the recorded size at start-up and to new windows.
//! The decisions are the pure functions of `application::local_state::window_size`; this
//! module only reads and sets real windows. Nothing here may stop a window from closing or
//! showing: every failure is logged and the config size stays.

use tauri::{AppHandle, Manager, Monitor, Runtime, WebviewWindow, Window};

use crate::application::local_state::operations::LocalState;
use crate::application::local_state::window_size::{fit_to_work_area, size_to_record};
use crate::config::MAIN_WINDOW_LABEL;

/// The monitor's work area (the screen without taskbars / docks) in logical pixels.
fn logical_work_area(monitor: &Monitor) -> (f64, f64) {
    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    (
        f64::from(work_area.size.width) / scale,
        f64::from(work_area.size.height) / scale,
    )
}

/// Records the size and maximized state of `window`. Called just before it is destroyed.
pub fn record_window_size<R: Runtime>(window: &Window<R>) {
    let Some(local_state) = window.try_state::<LocalState>() else {
        return;
    };
    let measured = window.scale_factor().and_then(|scale| {
        let size = window.inner_size()?.to_logical::<f64>(scale);
        Ok((size.width, size.height, window.is_maximized()?))
    });
    let (width, height, maximized) = match measured {
        Ok(measured) => measured,
        Err(error) => {
            eprintln!(
                "failed to read the size of window {}: {error}",
                window.label()
            );
            return;
        }
    };
    // Not a real size (minimized): the previous record stays.
    let Some(size) = size_to_record(width, height, maximized) else {
        return;
    };
    if let Err(error) = local_state.set_window_size(size) {
        eprintln!("failed to record the window size: {error}");
    }
}

/// The recorded size fitted to the monitor, as logical pixels; `None` when nothing is
/// recorded. `monitor` is `None` when the platform cannot tell (the size is then unclamped).
fn recorded_size_on(
    local_state: &LocalState,
    monitor: Option<&Monitor>,
) -> Option<(u32, u32, bool)> {
    let recorded = local_state.get_app_settings().window_size?;
    let (width, height) = fit_to_work_area(
        (recorded.width, recorded.height),
        monitor.map(logical_work_area),
    );
    Some((width, height, recorded.maximized))
}

/// The size for a new window whose neighbour's size is unknown: the recorded one, fitted to
/// the primary monitor (the window does not exist yet, so it has no monitor of its own).
pub fn recorded_size_for_new_window<R: Runtime>(app: &AppHandle<R>) -> Option<(f64, f64)> {
    let local_state = app.try_state::<LocalState>()?;
    let monitor = app.primary_monitor().ok().flatten();
    recorded_size_on(&local_state, monitor.as_ref())
        .map(|(width, height, _)| (f64::from(width), f64::from(height)))
}

/// Applies the recorded size to the first window and shows it. The window starts hidden
/// (`visible: false` in `tauri.conf.json`) so it does not flash at the config size first.
/// It is always shown, whatever fails here.
pub fn apply_startup_window_size<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        eprintln!("the {MAIN_WINDOW_LABEL} window does not exist at start-up");
        return;
    };
    apply_recorded_size(app, &window);
    if let Err(error) = window.show() {
        eprintln!("failed to show the {MAIN_WINDOW_LABEL} window: {error}");
    }
}

fn apply_recorded_size<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let Some(local_state) = app.try_state::<LocalState>() else {
        return;
    };
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some((width, height, maximized)) = recorded_size_on(&local_state, monitor.as_ref()) else {
        return;
    };
    if let Err(error) = window.set_size(tauri::LogicalSize::new(width, height)) {
        eprintln!("failed to apply the recorded window size: {error}");
    }
    if maximized {
        if let Err(error) = window.maximize() {
            eprintln!("failed to maximize the window: {error}");
        }
    }
}
