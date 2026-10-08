//! Git CLI access (docs/git-development.md §11.6): one runner that owns process start-up,
//! time limits, output limits and the environment, and the pure helpers built on it
//! (executable discovery, repository detection, `status` parsing, path validation,
//! redaction). Features never start `git` themselves.

pub mod constants;
pub mod executable;
pub mod paths;
pub mod redaction;
pub mod repository;
pub mod runner;
pub mod status_parser;
pub mod version;
