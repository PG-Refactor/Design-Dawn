//! The MCP server executable. It does not start Tauri.

use std::io::{stdin, stdout};
use std::process::ExitCode;

use design_dawn_lib::application::local_state::constants::APP_IDENTIFIER;
use design_dawn_lib::mcp::cli::{parse_arguments, CliCommand, USAGE};
use design_dawn_lib::mcp::config::SERVER_VERSION;
use design_dawn_lib::mcp::server::serve;
use design_dawn_lib::mcp::tools::ToolContext;

const EXIT_USAGE: u8 = 2;
const EXIT_FAILURE: u8 = 1;

fn main() -> ExitCode {
    let config_dir = match parse_arguments(std::env::args_os().skip(1)) {
        Ok(CliCommand::Run { config_dir }) => config_dir,
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
    // Where Tauri keeps the app's settings: the OS config folder + the identifier.
    let Some(config_dir) =
        config_dir.or_else(|| dirs::config_dir().map(|base| base.join(APP_IDENTIFIER)))
    else {
        eprintln!("design-dawn-mcp: cannot find the folder of the app's settings");
        return ExitCode::from(EXIT_FAILURE);
    };
    let context = ToolContext::new(&config_dir);
    // Neither a Project's path nor its content goes into the log.
    eprintln!("design-dawn-mcp: serving on stdio");
    match serve(&context, stdin().lock(), stdout().lock()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("design-dawn-mcp: stdio failed: {}", error.kind());
            ExitCode::from(EXIT_FAILURE)
        }
    }
}
