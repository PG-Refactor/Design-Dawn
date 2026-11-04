//! Command line of `design-dawn-mcp`.

use std::ffi::OsString;
use std::path::PathBuf;

use super::config::{
    COMMAND_LINE_ALLOW_WRITE_OPTION, COMMAND_LINE_APP_CONFIG_DIR_OPTION,
    COMMAND_LINE_PROJECT_OPTION,
};

pub const USAGE: &str = "Usage: design-dawn-mcp [--project <folder> [--allow-write]]\n\
\n\
Serves Design Dawn Projects to an MCP client over stdin/stdout.\n\
Without --project it follows the Design Dawn app: the AI works on the Project open in\n\
the app or chooses one the app lists (listProjects / selectProject), and may change a\n\
Project only when the user allowed it in the app's AI integration screen.\n\
  --project <folder>        serve only this Project folder (the one holding project.json)\n\
  --allow-write             with --project: also offer the tools that change it\n\
  --app-config-dir <folder> without --project: the app's settings folder, when it is not\n\
                            in the usual place\n\
  --help, --version";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServeTarget {
    /// One Project for the whole session.
    Project { folder: PathBuf, allow_write: bool },
    /// Follow the app; `None` is the app's usual settings folder.
    App { config_dir: Option<PathBuf> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliCommand {
    Run(ServeTarget),
    Help,
    Version,
}

/// `--name value` or `--name=value`; a second occurrence is refused.
fn take_value(
    name: &str,
    text: &str,
    arguments: &mut impl Iterator<Item = OsString>,
    slot: &mut Option<PathBuf>,
) -> Result<bool, String> {
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
        return Ok(false);
    };
    if slot.replace(value).is_some() {
        return Err(format!("{name} was given twice"));
    }
    Ok(true)
}

/// `arguments` excludes the program name.
pub fn parse_arguments(
    arguments: impl IntoIterator<Item = OsString>,
) -> Result<CliCommand, String> {
    let mut project: Option<PathBuf> = None;
    let mut config_dir: Option<PathBuf> = None;
    let mut allow_write = false;
    let mut arguments = arguments.into_iter();
    while let Some(argument) = arguments.next() {
        let text = argument.to_string_lossy().into_owned();
        if text == "--help" || text == "-h" {
            return Ok(CliCommand::Help);
        } else if text == "--version" || text == "-V" {
            return Ok(CliCommand::Version);
        } else if text == COMMAND_LINE_ALLOW_WRITE_OPTION {
            allow_write = true;
        } else if !take_value(
            COMMAND_LINE_PROJECT_OPTION,
            &text,
            &mut arguments,
            &mut project,
        )? && !take_value(
            COMMAND_LINE_APP_CONFIG_DIR_OPTION,
            &text,
            &mut arguments,
            &mut config_dir,
        )? {
            return Err(format!("unknown argument: {text}"));
        }
    }
    match (project, config_dir) {
        (Some(folder), None) => Ok(CliCommand::Run(ServeTarget::Project {
            folder,
            allow_write,
        })),
        (Some(_), Some(_)) => Err(format!(
            "{COMMAND_LINE_APP_CONFIG_DIR_OPTION} is only for following the app, not with \
{COMMAND_LINE_PROJECT_OPTION}"
        )),
        // Following the app, write permission is the user's choice per Project in the app;
        // a command line switch that overrides it would be a way around that choice.
        (None, _) if allow_write => Err(format!(
            "{COMMAND_LINE_ALLOW_WRITE_OPTION} needs {COMMAND_LINE_PROJECT_OPTION}; without \
it, allow changes per Project in the app's AI integration screen"
        )),
        (None, config_dir) => Ok(CliCommand::Run(ServeTarget::App { config_dir })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(arguments: &[&str]) -> Result<CliCommand, String> {
        parse_arguments(arguments.iter().map(OsString::from))
    }

    #[test]
    fn without_a_project_it_follows_the_app() {
        assert_eq!(
            parse(&[]).unwrap(),
            CliCommand::Run(ServeTarget::App { config_dir: None })
        );
        assert_eq!(
            parse(&["--app-config-dir=c"]).unwrap(),
            CliCommand::Run(ServeTarget::App {
                config_dir: Some(PathBuf::from("c"))
            })
        );
    }

    #[test]
    fn a_project_is_read_only_unless_writes_are_allowed() {
        assert_eq!(
            parse(&["--project", "p"]).unwrap(),
            CliCommand::Run(ServeTarget::Project {
                folder: PathBuf::from("p"),
                allow_write: false
            })
        );
        assert_eq!(
            parse(&["--allow-write", "--project=q"]).unwrap(),
            CliCommand::Run(ServeTarget::Project {
                folder: PathBuf::from("q"),
                allow_write: true
            })
        );
    }

    #[test]
    fn unknown_repeated_incomplete_or_mixed_arguments_are_refused() {
        assert!(parse(&["--project", "p", "--bogus"]).is_err());
        assert!(parse(&["--project", "a", "--project", "b"]).is_err());
        assert!(parse(&["--project"]).is_err());
        assert!(parse(&["--allow-write"]).is_err());
        assert!(parse(&["--project", "p", "--app-config-dir", "c"]).is_err());
        assert!(parse(&["--projectx"]).is_err());
    }

    #[test]
    fn help_and_version_win() {
        assert_eq!(parse(&["--help"]).unwrap(), CliCommand::Help);
        assert_eq!(parse(&["--version"]).unwrap(), CliCommand::Version);
    }
}
