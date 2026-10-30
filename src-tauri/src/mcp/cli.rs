//! Command line of `design-dawn-mcp`.

use std::ffi::OsString;
use std::path::PathBuf;

use super::config::{COMMAND_LINE_ALLOW_WRITE_OPTION, COMMAND_LINE_PROJECT_OPTION};

pub const USAGE: &str = "Usage: design-dawn-mcp --project <folder> [--allow-write]\n\
\n\
Serves a Design Dawn Project to an MCP client over stdin/stdout.\n\
  --project <folder>  the Project folder (the one holding project.json)\n\
  --allow-write       also offer the tools that change the Project (read-only otherwise)\n\
  --help, --version";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliOptions {
    pub project: PathBuf,
    pub allow_write: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliCommand {
    Run(CliOptions),
    Help,
    Version,
}

/// `arguments` excludes the program name.
pub fn parse_arguments(
    arguments: impl IntoIterator<Item = OsString>,
) -> Result<CliCommand, String> {
    let project_prefix = format!("{COMMAND_LINE_PROJECT_OPTION}=");
    let mut project: Option<PathBuf> = None;
    let mut allow_write = false;
    let mut arguments = arguments.into_iter();
    while let Some(argument) = arguments.next() {
        let text = argument.to_string_lossy();
        if text == "--help" || text == "-h" {
            return Ok(CliCommand::Help);
        } else if text == "--version" || text == "-V" {
            return Ok(CliCommand::Version);
        } else if text == COMMAND_LINE_ALLOW_WRITE_OPTION {
            allow_write = true;
        } else if text == COMMAND_LINE_PROJECT_OPTION {
            let value = arguments
                .next()
                .ok_or_else(|| format!("{COMMAND_LINE_PROJECT_OPTION} needs a folder"))?;
            if project.replace(PathBuf::from(value)).is_some() {
                return Err(format!("{COMMAND_LINE_PROJECT_OPTION} was given twice"));
            }
        } else if let Some(value) = text.strip_prefix(&project_prefix) {
            if project.replace(PathBuf::from(value)).is_some() {
                return Err(format!("{COMMAND_LINE_PROJECT_OPTION} was given twice"));
            }
        } else {
            return Err(format!("unknown argument: {text}"));
        }
    }
    match project {
        Some(project) => Ok(CliCommand::Run(CliOptions {
            project,
            allow_write,
        })),
        None => Err(format!("{COMMAND_LINE_PROJECT_OPTION} is required")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(arguments: &[&str]) -> Result<CliCommand, String> {
        parse_arguments(arguments.iter().map(OsString::from))
    }

    #[test]
    fn project_is_required_and_writes_are_off_by_default() {
        assert!(parse(&[]).is_err());
        assert_eq!(
            parse(&["--project", "p"]).unwrap(),
            CliCommand::Run(CliOptions {
                project: PathBuf::from("p"),
                allow_write: false
            })
        );
    }

    #[test]
    fn allow_write_and_the_equals_form_are_accepted() {
        assert_eq!(
            parse(&["--allow-write", "--project=q"]).unwrap(),
            CliCommand::Run(CliOptions {
                project: PathBuf::from("q"),
                allow_write: true
            })
        );
    }

    #[test]
    fn unknown_or_repeated_or_incomplete_arguments_are_refused() {
        assert!(parse(&["--project", "p", "--bogus"]).is_err());
        assert!(parse(&["--project", "a", "--project", "b"]).is_err());
        assert!(parse(&["--project"]).is_err());
    }

    #[test]
    fn help_and_version_win_over_a_missing_project() {
        assert_eq!(parse(&["--help"]).unwrap(), CliCommand::Help);
        assert_eq!(parse(&["--version"]).unwrap(), CliCommand::Version);
    }
}
