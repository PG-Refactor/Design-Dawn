//! Window size persistence: recording the size of a window
//! about to be destroyed, and applying the recorded size at start-up and to new windows.
//! The decisions are the pure functions of `application::local_state::window_size`; this
//! module only reads and sets real windows. Nothing here may stop a window from closing or
//! showing: every failure is logged and the config size stays.

use tauri::{AppHandle, Manager, Monitor, Runtime, WebviewWindow, Window};

use crate::application::local_state::operations::LocalState;
use crate::application::local_state::window_size::{fit_to_work_area, size_to_record};
use crate::config::MAIN_WINDOW_LABEL;

/// How far inside a monitor's work area the recorded window corner must be to count as on it
/// (logical pixels).
const POSITION_PROBE_INSET: f64 = 8.0;

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
    // Where it was, so the next start opens on the same monitor. A maximized window
    // reports the monitor's corner, which is just as good for that.
    let position = window
        .scale_factor()
        .and_then(|scale| Ok(window.outer_position()?.to_logical::<f64>(scale)));
    match position {
        #[allow(clippy::cast_possible_truncation)]
        Ok(position) if position.x.is_finite() && position.y.is_finite() => {
            let corner = (position.x.round() as i32, position.y.round() as i32);
            if let Err(error) = local_state.set_window_position(corner) {
                eprintln!("failed to record the window position: {error}");
            }
        }
        Ok(_) => {}
        Err(error) => eprintln!(
            "failed to read the position of window {}: {error}",
            window.label()
        ),
    }
}

/// The monitor whose work area holds the recorded window corner (a little inside it, so a
/// window whose edge only touched a monitor does not count), when there is one.
fn monitor_at<R: Runtime>(app: &AppHandle<R>, corner: (i32, i32)) -> Option<Monitor> {
    let point = (
        f64::from(corner.0) + POSITION_PROBE_INSET,
        f64::from(corner.1) + POSITION_PROBE_INSET,
    );
    app.available_monitors().ok()?.into_iter().find(|monitor| {
        let (x, y, width, height) = logical_work_area_rect(monitor);
        point.0 >= x && point.0 < x + width && point.1 >= y && point.1 < y + height
    })
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
    // Back where it was closed when that place is still on a monitor (one unplugged since
    // leaves the window where the system puts it).
    let recorded_monitor = local_state
        .get_app_settings()
        .window_position
        .and_then(|corner| Some((corner, monitor_at(app, corner)?)));
    if let Some(((x, y), _)) = &recorded_monitor {
        if let Err(error) =
            window.set_position(tauri::LogicalPosition::new(f64::from(*x), f64::from(*y)))
        {
            eprintln!("failed to apply the recorded window position: {error}");
        }
    }
    let monitor = recorded_monitor
        .map(|(_, monitor)| monitor)
        .or_else(|| window.current_monitor().ok().flatten())
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
    } else if let Some(monitor) = monitor.as_ref() {
        // The recorded size is the inside of the window; with the title bar and frame, and
        // where the window happens to be placed, it could still reach off the screen.
        fit_window_in_work_area(window, logical_work_area_rect(monitor));
    }
}

/// The monitor's work area as logical `(x, y, width, height)`.
pub fn logical_work_area_rect(monitor: &Monitor) -> (f64, f64, f64, f64) {
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    (
        f64::from(area.position.x) / scale,
        f64::from(area.position.y) / scale,
        f64::from(area.size.width) / scale,
        f64::from(area.size.height) / scale,
    )
}

/// Shrinks and moves a window so that its outer frame lies in `area` (logical
/// `(x, y, width, height)`). Failures leave the window as it was: it is usable anyway.
pub fn fit_window_in_work_area<R: Runtime>(window: &WebviewWindow<R>, area: (f64, f64, f64, f64)) {
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let (Ok(outer), Ok(inner), Ok(position)) = (
        window.outer_size(),
        window.inner_size(),
        window.outer_position(),
    ) else {
        return;
    };
    let outer = outer.to_logical::<f64>(scale);
    let inner = inner.to_logical::<f64>(scale);
    let position = position.to_logical::<f64>(scale);
    let frame = (outer.width - inner.width, outer.height - inner.height);
    let (area_x, area_y, area_width, area_height) = area;
    let fitted_outer = (outer.width.min(area_width), outer.height.min(area_height));
    if fitted_outer != (outer.width, outer.height) {
        let _ = window.set_size(tauri::LogicalSize::new(
            fitted_outer.0 - frame.0,
            fitted_outer.1 - frame.1,
        ));
    }
    let x = position
        .x
        .min(area_x + area_width - fitted_outer.0)
        .max(area_x);
    let y = position
        .y
        .min(area_y + area_height - fitted_outer.1)
        .max(area_y);
    if (x, y) != (position.x, position.y) {
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    }
}
