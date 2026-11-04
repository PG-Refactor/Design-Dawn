//! The MCP server executable. It does not start Tauri.

use std::io::{stdin, stdout};
use std::process::ExitCode;

use design_dawn_lib::application::local_state::constants::APP_IDENTIFIER;
use design_dawn_lib::mcp::cli::{parse_arguments, CliCommand, ServeTarget, USAGE};
use design_dawn_lib::mcp::config::SERVER_VERSION;
use design_dawn_lib::mcp::server::serve;
use design_dawn_lib::mcp::tools::ToolContext;

const EXIT_USAGE: u8 = 2;
const EXIT_FAILURE: u8 = 1;

fn main() -> ExitCode {
    let target = match parse_arguments(std::env::args_os().skip(1)) {
        Ok(CliCommand::Run(target)) => target,
        Ok(CliCommand::Help) => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Ok(CliCommand::Version) => {
            println!("design-dawn-mcp {SERVER_VERSION}");
            return ExitCode::SUCCESS;
        }
        Err(message) => {
            eprintln!("design-dawn-mcp: {message}\n{USAGE}");
            return ExitCode::from(EXIT_USAGE);
        }
    };
    let (context, mode) = match target {
        ServeTarget::Project {
            folder,
            allow_write,
        } => match ToolContext::open(&folder, allow_write) {
            Ok(context) => (
                context,
                if allow_write {
                    "one Project, read-write"
                } else {
                    "one Project, read-only"
                },
            ),
            Err(error) => {
                eprintln!(
                    "design-dawn-mcp: cannot open the project: {} ({})",
                    error.kind, error.message
                );
                return ExitCode::from(EXIT_FAILURE);
            }
        },
        ServeTarget::App { config_dir } => {
            // Where Tauri keeps the app's settings: the OS config folder + the identifier.
            let Some(config_dir) =
                config_dir.or_else(|| dirs::config_dir().map(|base| base.join(APP_IDENTIFIER)))
            else {
                eprintln!("design-dawn-mcp: cannot find the folder of the app's settings");
                return ExitCode::from(EXIT_FAILURE);
            };
            (
                ToolContext::follow_app(&config_dir),
                "following the Design Dawn app",
            )
        }
    };
    // The mode only; neither a Project's path nor its content goes into the log.
    eprintln!("design-dawn-mcp: serving on stdio ({mode})");
    match serve(&context, stdin().lock(), stdout().lock()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("design-dawn-mcp: stdio failed: {}", error.kind());
            ExitCode::from(EXIT_FAILURE)
        }
    }
}
