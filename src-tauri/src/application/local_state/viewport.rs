use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

use super::constants::{VIEWPORT_PAN_LIMIT, VIEWPORT_ZOOM_MAX, VIEWPORT_ZOOM_MIN};
use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};
use crate::domain::entity_id::{DocumentId, ProjectId, SheetId};

/// Pan in screen pixels, zoom as a factor. Fractions are allowed (UI state).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Viewport {
    pan_x: f64,
    pan_y: f64,
    zoom: f64,
}

impl Viewport {
    pub fn new(pan_x: f64, pan_y: f64, zoom: f64) -> ApplicationResult<Self> {
        let pan_is_valid = |value: f64| value.is_finite() && value.abs() <= VIEWPORT_PAN_LIMIT;
        let zoom_is_valid =
            zoom.is_finite() && (VIEWPORT_ZOOM_MIN..=VIEWPORT_ZOOM_MAX).contains(&zoom);
        if pan_is_valid(pan_x) && pan_is_valid(pan_y) && zoom_is_valid {
            return Ok(Self { pan_x, pan_y, zoom });
        }
        Err(ApplicationError::new(
            ErrorKind::InvalidViewport,
            format!(
                "panX {pan_x} / panY {pan_y} must be finite with absolute value <= {VIEWPORT_PAN_LIMIT}, \
                 zoom {zoom} must be finite within [{VIEWPORT_ZOOM_MIN}, {VIEWPORT_ZOOM_MAX}]"
            ),
        ))
    }

    pub fn pan_x(&self) -> f64 {
        self.pan_x
    }

    pub fn pan_y(&self) -> f64 {
        self.pan_y
    }

    pub fn zoom(&self) -> f64 {
        self.zoom
    }
}

/// Wire form: `{ panX, panY, zoom }`.
impl Serialize for Viewport {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("Viewport", 3)?;
        state.serialize_field("panX", &self.pan_x)?;
        state.serialize_field("panY", &self.pan_y)?;
        state.serialize_field("zoom", &self.zoom)?;
        state.end()
    }
}

/// The three ids that identify a sheet across projects. Only their form is checked: the
/// project does not have to be open, or even exist any more.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SheetViewportKey {
    pub project_id: ProjectId,
    pub document_id: DocumentId,
    pub sheet_id: SheetId,
}

impl SheetViewportKey {
    pub fn parse(project_id: &str, document_id: &str, sheet_id: &str) -> ApplicationResult<Self> {
        Ok(Self {
            project_id: ProjectId::parse(project_id)?,
            document_id: DocumentId::parse(document_id)?,
            sheet_id: SheetId::parse(sheet_id)?,
        })
    }
}
