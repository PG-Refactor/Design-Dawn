use super::constants::{POSITION_MAX, POSITION_MIN, SIZE_MAX, SIZE_MIN};
use super::error::{DomainError, DomainErrorKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Position {
    x: i32,
    y: i32,
}

/// Stored as `u32`: the valid range 1..=i32::MAX is never negative, so the type itself
/// rules out zero-or-negative sizes after construction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Size {
    width: u32,
    height: u32,
}

fn check_position_axis(axis: &str, value: i64) -> Result<i32, DomainError> {
    if !(POSITION_MIN..=POSITION_MAX).contains(&value) {
        return Err(DomainError::new(
            DomainErrorKind::InvalidPosition,
            format!("{axis} out of range: {value}"),
        ));
    }
    Ok(value as i32)
}

fn check_size_axis(axis: &str, value: i64) -> Result<u32, DomainError> {
    if !(SIZE_MIN..=SIZE_MAX).contains(&value) {
        return Err(DomainError::new(
            DomainErrorKind::InvalidSize,
            format!("{axis} out of range: {value}"),
        ));
    }
    Ok(value as u32)
}

impl Position {
    /// Takes `i64` so out-of-range input can be reported instead of wrapping.
    pub fn new(x: i64, y: i64) -> Result<Self, DomainError> {
        let x = check_position_axis("x", x)?;
        let y = check_position_axis("y", y)?;
        Ok(Self { x, y })
    }

    pub fn x(&self) -> i32 {
        self.x
    }

    pub fn y(&self) -> i32 {
        self.y
    }
}

impl Size {
    pub fn new(width: i64, height: i64) -> Result<Self, DomainError> {
        let width = check_size_axis("width", width)?;
        let height = check_size_axis("height", height)?;
        Ok(Self { width, height })
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }
}
