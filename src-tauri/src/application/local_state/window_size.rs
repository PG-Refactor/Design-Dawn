//! The window size kept between runs (docs/architecture.md §11.0.1). Logical pixels, no
//! position. Pure: reading the real window and applying the size is `commands::window_size`.

use serde_json::Number;

use super::constants::{WINDOW_HEIGHT_MAX, WINDOW_HEIGHT_MIN, WINDOW_WIDTH_MAX, WINDOW_WIDTH_MIN};
use crate::application::error::{ApplicationError, ApplicationResult};
use crate::infrastructure::error::PersistenceErrorKind;

/// A recorded window size. `maximized` windows keep the size they had when closed, which is
/// the maximized size (the size before maximizing is not tracked, see §11.0.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowSize {
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

fn parse_dimension(number: &Number, name: &str, min: u32, max: u32) -> ApplicationResult<u32> {
    number
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| (min..=max).contains(value))
        .ok_or_else(|| {
            ApplicationError::persistence(
                PersistenceErrorKind::InvalidFileStructure,
                format!("window {name} {number} must be an integer within [{min}, {max}]"),
            )
        })
}

/// Accepts integers within the limits only, like the Project Tree width: a hand-edited file
/// cannot smuggle in a size the window would then have to round or clamp silently.
pub fn parse_window_size(
    width: &Number,
    height: &Number,
    maximized: bool,
) -> ApplicationResult<WindowSize> {
    Ok(WindowSize {
        width: parse_dimension(width, "width", WINDOW_WIDTH_MIN, WINDOW_WIDTH_MAX)?,
        height: parse_dimension(height, "height", WINDOW_HEIGHT_MIN, WINDOW_HEIGHT_MAX)?,
        maximized,
    })
}

/// The size to record for a window about to be destroyed, from its logical inner size.
/// `None` when the size is not a real one (a minimized window reports zero on some
/// platforms): the previous record is kept instead of storing garbage. Out-of-limit sizes
/// are clamped, not rejected, because the window itself is valid.
pub fn size_to_record(width: f64, height: f64, maximized: bool) -> Option<WindowSize> {
    let usable = |value: f64| value.is_finite() && value >= 1.0;
    if !usable(width) || !usable(height) {
        return None;
    }
    // After the range clamp the rounded value fits in `u32`.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let clamp = |value: f64, min: u32, max: u32| (value.round() as u32).clamp(min, max);
    Some(WindowSize {
        width: clamp(width, WINDOW_WIDTH_MIN, WINDOW_WIDTH_MAX),
        height: clamp(height, WINDOW_HEIGHT_MIN, WINDOW_HEIGHT_MAX),
        maximized,
    })
}

/// Shrinks `size` to the monitor's work area (logical pixels) so a window recorded on a
/// larger screen is not created partly off screen. `None` (no monitor information) or an
/// empty area leaves it unclamped.
pub fn fit_to_work_area(size: (u32, u32), work_area: Option<(f64, f64)>) -> (u32, u32) {
    let Some((area_width, area_height)) = work_area else {
        return size;
    };
    if !(area_width >= 1.0 && area_height >= 1.0) {
        return size;
    }
    // Rounded down so the window never exceeds the area; both are positive and finite here.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let limit = |value: f64| value.floor() as u32;
    (
        size.0.min(limit(area_width)),
        size.1.min(limit(area_height)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_size_is_rounded_and_keeps_the_maximized_flag() {
        assert_eq!(
            size_to_record(1280.4, 799.6, true),
            Some(WindowSize {
                width: 1280,
                height: 800,
                maximized: true
            })
        );
    }

    #[test]
    fn an_unusable_size_is_not_recorded() {
        for (width, height) in [(0.0, 800.0), (1280.0, 0.0), (f64::NAN, 800.0), (-5.0, 5.0)] {
            assert_eq!(size_to_record(width, height, false), None);
        }
        assert_eq!(size_to_record(f64::INFINITY, 800.0, false), None);
    }

    #[test]
    fn a_size_beyond_the_limits_is_clamped_when_recording() {
        let size = size_to_record(1.0, 1e9, false).unwrap();
        assert_eq!(size.width, WINDOW_WIDTH_MIN);
        assert_eq!(size.height, WINDOW_HEIGHT_MAX);
    }

    #[test]
    fn parsing_accepts_the_limits_and_rejects_everything_else() {
        let number = |value: u32| Number::from(value);
        assert!(
            parse_window_size(&number(WINDOW_WIDTH_MIN), &number(WINDOW_HEIGHT_MAX), false).is_ok()
        );
        for invalid in [
            Number::from(WINDOW_WIDTH_MIN - 1),
            Number::from(WINDOW_WIDTH_MAX + 1),
            Number::from(-1),
            Number::from_f64(800.5).unwrap(),
        ] {
            assert!(parse_window_size(&invalid, &number(800), false).is_err());
        }
        for invalid in [
            Number::from(WINDOW_HEIGHT_MIN - 1),
            Number::from(WINDOW_HEIGHT_MAX + 1),
            Number::from(-1),
            Number::from_f64(800.5).unwrap(),
        ] {
            assert!(parse_window_size(&number(800), &invalid, false).is_err());
        }
    }

    #[test]
    fn a_larger_size_is_shrunk_to_the_work_area() {
        assert_eq!(
            fit_to_work_area((2000, 1200), Some((1920.0, 1040.5))),
            (1920, 1040)
        );
        assert_eq!(
            fit_to_work_area((800, 600), Some((1920.0, 1040.0))),
            (800, 600)
        );
    }

    #[test]
    fn without_monitor_information_the_size_is_unchanged() {
        assert_eq!(fit_to_work_area((2000, 1200), None), (2000, 1200));
        assert_eq!(
            fit_to_work_area((2000, 1200), Some((0.0, 0.0))),
            (2000, 1200)
        );
        assert_eq!(
            fit_to_work_area((2000, 1200), Some((f64::NAN, 5.0))),
            (2000, 1200)
        );
    }
}
