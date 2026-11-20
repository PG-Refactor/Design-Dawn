//! Command line of `design-dawn-mcp`.

use std::ffi::OsString;
use std::path::PathBuf;

use super::config::COMMAND_LINE_APP_CONFIG_DIR_OPTION;

pub const USAGE: &str = "Usage: design-dawn-mcp [--app-config-dir <folder>]\n\
\n\
Serves Design Dawn Projects to an MCP client over stdin/stdout. The AI works on the\n\
Projects offered to AI (Design Dawn's AI integration screen, or addProject): the Project\n\
open in the app by default, or one it chooses (listProjects / selectProject). It changes a\n\
Project only when that is allowed (the screen, or setWriteAccess); the MCP client asks the\n\
user before each such call. The app need not be running.\n\
  --app-config-dir <folder> the app's settings folder, when it is not in the usual place\n\
  --help, --version";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliCommand {
    /// Serve; `None` is the app's usual settings folder.
    Run {
        config_dir: Option<PathBuf>,
    },
    Help,
    Version,
}

/// `arguments` excludes the program name.
pub fn parse_arguments(
    arguments: impl IntoIterator<Item = OsString>,
) -> Result<CliCommand, String> {
    let name = COMMAND_LINE_APP_CONFIG_DIR_OPTION;
    let mut config_dir: Option<PathBuf> = None;
    let mut arguments = arguments.into_iter();
    while let Some(argument) = arguments.next() {
        let text = argument.to_string_lossy().into_owned();
        if text == "--help" || text == "-h" {
            return Ok(CliCommand::Help);
        } else if text == "--version" || text == "-V" {
            return Ok(CliCommand::Version);
        }
        // `--name value` or `--name=value`; a second occurrence is refused.
        let value = if text == name {
            arguments
                .next()
                .map(PathBuf::from)
                .ok_or_else(|| format!("{name} needs a folder"))?
        } else if let Some(value) = text
            .strip_prefix(name)
            .and_then(|rest| rest.strip_prefix('='))
        {
            PathBuf::from(value)
        } else {
            return Err(format!("unknown argument: {text}"));
        };
        if config_dir.replace(value).is_some() {
            return Err(format!("{name} was given twice"));
        }
    }
    Ok(CliCommand::Run { config_dir })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(arguments: &[&str]) -> Result<CliCommand, String> {
        parse_arguments(arguments.iter().map(OsString::from))
    }

    #[test]
    fn it_takes_only_the_settings_folder() {
        assert_eq!(parse(&[]).unwrap(), CliCommand::Run { config_dir: None });
        assert_eq!(
            parse(&["--app-config-dir=c"]).unwrap(),
            CliCommand::Run {
                config_dir: Some(PathBuf::from("c"))
            }
        );
        assert_eq!(
            parse(&["--app-config-dir", "d"]).unwrap(),
            CliCommand::Run {
                config_dir: Some(PathBuf::from("d"))
            }
        );
    }

    #[test]
    fn unknown_repeated_or_incomplete_arguments_are_refused() {
        // The one-Project options of earlier versions are gone, not ignored.
        assert!(parse(&["--project", "p"]).is_err());
        assert!(parse(&["--allow-write"]).is_err());
        assert!(parse(&["--app-config-dir"]).is_err());
        assert!(parse(&["--app-config-dir", "a", "--app-config-dir", "b"]).is_err());
        assert!(parse(&["--app-config-dirx"]).is_err());
    }

    #[test]
    fn help_and_version_win() {
        assert_eq!(parse(&["--help"]).unwrap(), CliCommand::Help);
        assert_eq!(parse(&["--version"]).unwrap(), CliCommand::Version);
    }
}
