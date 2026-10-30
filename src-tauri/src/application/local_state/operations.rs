//! Reading and writing the local state. Loading problems never fail a read: the caller
//! gets defaults plus a `loadIssue`, so a broken local file cannot make the app unusable
//! and the problem is still reported. Write failures are
//! errors.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;
use serde_json::{Number, Value};

use super::constants::{DEFAULT_AUTO_SAVE, DEFAULT_PROJECT_TREE_WIDTH, MAX_SHEET_VIEWPORT_ENTRIES};
use super::language::LanguagePreference;
use super::layout::parse_project_tree_width;
use super::theme::ThemePreference;
use super::viewport::{SheetViewportKey, Viewport};
use super::window_size::{parse_window_size, WindowSize};
use crate::application::error::{ApplicationError, ApplicationResult};
use crate::domain::constants::MIN_SCHEMA_VERSION;
use crate::domain::error::{DomainError, DomainErrorKind};
use crate::infrastructure::file_format::dto::{parse_dto, schema_version_value};
use crate::infrastructure::local_state::constants::{
    CURRENT_SETTINGS_SCHEMA_VERSION, CURRENT_SHEET_VIEWPORTS_SCHEMA_VERSION, SETTINGS_FILE_NAME,
    SHEET_VIEWPORTS_FILE_NAME,
};
use crate::infrastructure::local_state::dto::{
    number_from_f64, SettingsFileDto, SheetViewportEntryDto, SheetViewportsFileDto, ViewportDto,
    WindowSizeDto,
};
use crate::infrastructure::local_state::files::{read_json_file, write_json_file};

/// Where the two files live. Production resolves them from Tauri's path resolver; tests
/// pass temporary directories. Nothing is ever written anywhere else.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalStateDirectories {
    /// Holds `settings.json` (`app_config_dir`).
    pub config_dir: PathBuf,
    /// Holds `sheet-viewports.json` (`app_local_data_dir`).
    pub local_data_dir: PathBuf,
}

/// Wire form: `{ themePreference, languagePreference, autoSave, projectTreeWidth, loadIssue }` (the window size stays in Rust); `loadIssue` is `null` or
/// `{ kind, detail }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme_preference: ThemePreference,
    pub language_preference: LanguagePreference,
    pub auto_save: bool,
    /// CSS pixels.
    pub project_tree_width: u32,
    /// Only Rust uses it (start-up and new windows), so it is not part of the wire form.
    #[serde(skip)]
    pub window_size: Option<WindowSize>,
    pub load_issue: Option<ApplicationError>,
}

impl AppSettings {
    fn defaults(load_issue: Option<ApplicationError>) -> Self {
        Self {
            theme_preference: ThemePreference::default(),
            language_preference: LanguagePreference::default(),
            auto_save: DEFAULT_AUTO_SAVE,
            project_tree_width: DEFAULT_PROJECT_TREE_WIDTH,
            window_size: None,
            load_issue,
        }
    }
}

/// Wire form: `{ viewport: { panX, panY, zoom } | null, loadIssue }`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetViewportResult {
    pub viewport: Option<Viewport>,
    pub load_issue: Option<ApplicationError>,
}

/// Managed state of the local state commands. One lock per file serializes every access to
/// it, which makes the viewport read-modify-write atomic with respect to other commands;
/// the two files are independent, so they never need to be locked together.
#[derive(Debug)]
pub struct LocalState {
    directories: LocalStateDirectories,
    settings_lock: Mutex<()>,
    viewports_lock: Mutex<()>,
}

// The guarded data is `()`: a poisoned lock protects no broken invariant, and a panic in
// one command must not disable the settings for the rest of the session.
fn acquire(lock: &Mutex<()>) -> MutexGuard<'_, ()> {
    lock.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Accepts exactly the versions this app understands (1..=current).
fn check_schema_version(number: &Number, current: u32) -> ApplicationResult<()> {
    let version = schema_version_value(number);
    if version < MIN_SCHEMA_VERSION {
        return Err(DomainError::new(
            DomainErrorKind::InvalidSchemaVersion,
            format!("schemaVersion must be >= {MIN_SCHEMA_VERSION}: {number}"),
        )
        .into());
    }
    if u32::try_from(version).map_or(true, |value| value > current) {
        return Err(DomainError::new(
            DomainErrorKind::UnsupportedSchemaVersion,
            format!("schemaVersion {number} is newer than supported {current}"),
        )
        .into());
    }
    Ok(())
}

// `as_f64` is always `Some` for the numbers serde_json parses here; NaN keeps a
// hypothetical miss on the `invalidViewport` path instead of panicking.
fn viewport_from_numbers(
    pan_x: &Number,
    pan_y: &Number,
    zoom: &Number,
) -> ApplicationResult<Viewport> {
    let value = |number: &Number| number.as_f64().unwrap_or(f64::NAN);
    Viewport::new(value(pan_x), value(pan_y), value(zoom))
}

/// Parses the `viewport` argument of `save_sheet_viewport`: a wrong shape is
/// `invalidFileStructure`, a bad number `invalidViewport`.
pub fn parse_viewport_payload(payload: Value) -> ApplicationResult<Viewport> {
    let dto: ViewportDto = parse_dto(payload)?;
    viewport_from_numbers(&dto.pan_x, &dto.pan_y, &dto.zoom)
}

type ViewportEntries = Vec<(SheetViewportKey, Viewport)>;

fn entry_from_dto(dto: &SheetViewportEntryDto) -> ApplicationResult<(SheetViewportKey, Viewport)> {
    Ok((
        SheetViewportKey::parse(&dto.project_id, &dto.document_id, &dto.sheet_id)?,
        viewport_from_numbers(&dto.pan_x, &dto.pan_y, &dto.zoom)?,
    ))
}

fn entry_to_dto(
    key: &SheetViewportKey,
    viewport: &Viewport,
) -> ApplicationResult<SheetViewportEntryDto> {
    Ok(SheetViewportEntryDto {
        project_id: key.project_id.to_string(),
        document_id: key.document_id.to_string(),
        sheet_id: key.sheet_id.to_string(),
        pan_x: number_from_f64(viewport.pan_x())?,
        pan_y: number_from_f64(viewport.pan_y())?,
        zoom: number_from_f64(viewport.zoom())?,
    })
}

impl LocalState {
    pub fn new(directories: LocalStateDirectories) -> Self {
        Self {
            directories,
            settings_lock: Mutex::new(()),
            viewports_lock: Mutex::new(()),
        }
    }

    /// `Err` is a load issue (the file is unusable), never a reason to fail the command.
    fn read_settings(&self) -> ApplicationResult<AppSettings> {
        let path = self.directories.config_dir.join(SETTINGS_FILE_NAME);
        let Some(dto) = read_json_file::<SettingsFileDto>(&path)? else {
            return Ok(AppSettings::defaults(None));
        };
        check_schema_version(&dto.schema_version, CURRENT_SETTINGS_SCHEMA_VERSION)?;
        Ok(AppSettings {
            theme_preference: ThemePreference::parse(&dto.theme_preference)?,
            // Schema version 1 files predate the setting, so it is absent there.
            auto_save: dto.auto_save.unwrap_or(DEFAULT_AUTO_SAVE),
            // Absent before schema version 3.
            project_tree_width: match &dto.project_tree_width {
                Some(number) => parse_project_tree_width(number)?,
                None => DEFAULT_PROJECT_TREE_WIDTH,
            },
            // Absent before schema version 4: no size recorded, the window config applies.
            window_size: match &dto.window_size {
                Some(size) => Some(parse_window_size(
                    &size.width,
                    &size.height,
                    size.maximized,
                )?),
                None => None,
            },
            // Absent before schema version 5.
            language_preference: match &dto.language_preference {
                Some(value) => LanguagePreference::parse(value)?,
                None => LanguagePreference::default(),
            },
            load_issue: None,
        })
    }

    /// Read-modify-write so changing one setting keeps the other. An unreadable existing
    /// file is replaced on purpose (the other setting falls back to its default): this is
    /// not Project data, and the problem was already reported by the last read.
    fn update_settings(
        &self,
        update: impl FnOnce(&mut AppSettings),
    ) -> ApplicationResult<AppSettings> {
        let _guard = acquire(&self.settings_lock);
        let mut settings = self
            .read_settings()
            .unwrap_or_else(|_| AppSettings::defaults(None));
        update(&mut settings);
        write_json_file(
            &self.directories.config_dir,
            SETTINGS_FILE_NAME,
            &SettingsFileDto {
                schema_version: Number::from(CURRENT_SETTINGS_SCHEMA_VERSION),
                theme_preference: settings.theme_preference.as_str().to_owned(),
                language_preference: Some(settings.language_preference.as_str().to_owned()),
                auto_save: Some(settings.auto_save),
                project_tree_width: Some(Number::from(settings.project_tree_width)),
                window_size: settings.window_size.map(|size| WindowSizeDto {
                    width: Number::from(size.width),
                    height: Number::from(size.height),
                    maximized: size.maximized,
                }),
            },
        )?;
        Ok(settings)
    }

    fn read_viewport_entries(&self) -> ApplicationResult<ViewportEntries> {
        let path = self
            .directories
            .local_data_dir
            .join(SHEET_VIEWPORTS_FILE_NAME);
        let Some(dto) = read_json_file::<SheetViewportsFileDto>(&path)? else {
            return Ok(Vec::new());
        };
        check_schema_version(&dto.schema_version, CURRENT_SHEET_VIEWPORTS_SCHEMA_VERSION)?;
        dto.viewports.iter().map(entry_from_dto).collect()
    }

    pub fn get_app_settings(&self) -> AppSettings {
        let _guard = acquire(&self.settings_lock);
        self.read_settings()
            .unwrap_or_else(|issue| AppSettings::defaults(Some(issue)))
    }

    pub fn set_theme_preference(&self, theme_preference: &str) -> ApplicationResult<AppSettings> {
        // Validated before anything is touched, so a rejected value leaves the file as it was.
        let theme_preference = ThemePreference::parse(theme_preference)?;
        self.update_settings(|settings| settings.theme_preference = theme_preference)
    }

    pub fn set_language_preference(
        &self,
        language_preference: &str,
    ) -> ApplicationResult<AppSettings> {
        // Validated before anything is touched, so a rejected value leaves the file as it was.
        let language_preference = LanguagePreference::parse(language_preference)?;
        self.update_settings(|settings| settings.language_preference = language_preference)
    }

    pub fn set_auto_save(&self, enabled: bool) -> ApplicationResult<AppSettings> {
        self.update_settings(|settings| settings.auto_save = enabled)
    }

    /// `width` is a `Number` so a non-integer or out-of-range value is reported as
    /// `invalidProjectTreeWidth` instead of failing argument decoding.
    pub fn set_project_tree_width(&self, width: &Number) -> ApplicationResult<AppSettings> {
        let width = parse_project_tree_width(width)?;
        self.update_settings(|settings| settings.project_tree_width = width)
    }

    /// Recorded when a window closes. Keeps the other settings (read-modify-write).
    pub fn set_window_size(&self, size: WindowSize) -> ApplicationResult<AppSettings> {
        self.update_settings(|settings| settings.window_size = Some(size))
    }

    pub fn get_sheet_viewport(
        &self,
        project_id: &str,
        document_id: &str,
        sheet_id: &str,
    ) -> ApplicationResult<SheetViewportResult> {
        let key = SheetViewportKey::parse(project_id, document_id, sheet_id)?;
        let _guard = acquire(&self.viewports_lock);
        Ok(match self.read_viewport_entries() {
            Ok(entries) => SheetViewportResult {
                // A hand-edited file may repeat a key; the later entry is the newer one.
                viewport: entries
                    .iter()
                    .rev()
                    .find(|(entry_key, _)| *entry_key == key)
                    .map(|(_, viewport)| *viewport),
                load_issue: None,
            },
            Err(issue) => SheetViewportResult {
                viewport: None,
                load_issue: Some(issue),
            },
        })
    }

    pub fn save_sheet_viewport(
        &self,
        project_id: &str,
        document_id: &str,
        sheet_id: &str,
        viewport: Value,
    ) -> ApplicationResult<()> {
        // Ids first, then the payload: a malformed id is reported even if the viewport is bad too.
        let key = SheetViewportKey::parse(project_id, document_id, sheet_id)?;
        let viewport = parse_viewport_payload(viewport)?;
        let _guard = acquire(&self.viewports_lock);
        // A broken file is replaced, not repaired: the cached viewports are not worth
        // refusing a save over, and the issue was already reported by the last read.
        let mut entries = self.read_viewport_entries().unwrap_or_default();
        entries.retain(|(entry_key, _)| *entry_key != key);
        entries.push((key, viewport));
        if entries.len() > MAX_SHEET_VIEWPORT_ENTRIES {
            let excess = entries.len() - MAX_SHEET_VIEWPORT_ENTRIES;
            entries.drain(..excess);
        }
        let viewports = entries
            .iter()
            .map(|(entry_key, entry_viewport)| entry_to_dto(entry_key, entry_viewport))
            .collect::<ApplicationResult<Vec<_>>>()?;
        write_json_file(
            &self.directories.local_data_dir,
            SHEET_VIEWPORTS_FILE_NAME,
            &SheetViewportsFileDto {
                schema_version: Number::from(CURRENT_SHEET_VIEWPORTS_SCHEMA_VERSION),
                viewports,
            },
        )?;
        Ok(())
    }
}
