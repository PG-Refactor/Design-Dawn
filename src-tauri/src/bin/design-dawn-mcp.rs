//! The MCP server executable (docs/architecture.md §17). It does not start Tauri.

use std::io::{stdin, stdout};
use std::process::ExitCode;

use design_dawn_lib::mcp::cli::{parse_arguments, CliCommand, USAGE};
use design_dawn_lib::mcp::config::SERVER_VERSION;
use design_dawn_lib::mcp::server::serve;
use design_dawn_lib::mcp::tools::ToolContext;

const EXIT_USAGE: u8 = 2;
const EXIT_FAILURE: u8 = 1;

fn main() -> ExitCode {
    let options = match parse_arguments(std::env::args_os().skip(1)) {
        Ok(CliCommand::Run(options)) => options,
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
    let context = match ToolContext::open(&options.project, options.allow_write) {
        Ok(context) => context,
        Err(error) => {
            eprintln!(
                "design-dawn-mcp: cannot open the project: {} ({})",
                error.kind, error.message
            );
            return ExitCode::from(EXIT_FAILURE);
        }
    };
    // The mode only; neither the Project's path nor its content goes into the log.
    eprintln!(
        "design-dawn-mcp: serving on stdio ({})",
        if options.allow_write {
            "read-write"
        } else {
            "read-only"
        }
    );
    match serve(&context, stdin().lock(), stdout().lock()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("design-dawn-mcp: stdio failed: {}", error.kind());
            ExitCode::from(EXIT_FAILURE)
        }
    }
}
