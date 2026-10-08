//! The one place that starts `git` (docs/git-development.md §11.6): the absolute executable
//! path, arguments passed one by one (no shell), a fixed environment, a time limit, bounded
//! output capture and no console window on Windows.

use std::ffi::{OsStr, OsString};
use std::fmt;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use super::constants::{
    ENV_EDITOR, ENV_SEQUENCE_EDITOR, ENV_TERMINAL_PROMPT, GIT_NO_OP_EDITOR, GIT_PIPE_DRAIN_GRACE,
    GIT_POLL_INTERVAL, GIT_STDERR_LIMIT_BYTES, GIT_STDOUT_LIMIT_BYTES, GLOBAL_ARGUMENTS,
    REDIRECTING_ENVIRONMENT,
};
use super::executable::find_git_executable;

/// Size of one read from a child's pipe.
const READ_CHUNK_BYTES: usize = 8 * 1024;

#[derive(Debug)]
pub struct GitOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    /// True when the output reached its limit and the rest was discarded. Output that is
    /// parsed as a whole (status) must not be used then.
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

impl GitOutput {
    pub fn success(&self) -> bool {
        self.status.success()
    }

    pub fn exit_code(&self) -> Option<i32> {
        self.status.code()
    }

    pub fn stderr_text(&self) -> String {
        String::from_utf8_lossy(&self.stderr).into_owned()
    }
}

#[derive(Debug)]
pub enum GitRunError {
    /// No `git` on PATH.
    Unavailable,
    /// The process did not end within the time limit and was killed.
    Timeout,
    /// The process could not be started, or waiting for it failed.
    Spawn(std::io::Error),
}

impl fmt::Display for GitRunError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable => write!(formatter, "git was not found on PATH"),
            Self::Timeout => write!(formatter, "git did not finish within the time limit"),
            Self::Spawn(error) => write!(formatter, "git could not be run: {error}"),
        }
    }
}

impl std::error::Error for GitRunError {}

#[derive(Debug, Clone)]
pub struct GitRunner {
    executable: PathBuf,
    /// Applied after the fixed environment. Tests use it for a hermetic configuration; the
    /// detection call uses it for the message locale.
    extra_environment: Vec<(OsString, OsString)>,
}

impl GitRunner {
    /// A runner for an already located executable (must be absolute).
    pub fn new(executable: PathBuf) -> Self {
        debug_assert!(executable.is_absolute());
        Self {
            executable,
            extra_environment: Vec::new(),
        }
    }

    /// A runner for the `git` on the process's PATH.
    pub fn discover() -> Result<Self, GitRunError> {
        find_git_executable()
            .map(Self::new)
            .ok_or(GitRunError::Unavailable)
    }

    pub fn with_environment(
        mut self,
        name: impl Into<OsString>,
        value: impl Into<OsString>,
    ) -> Self {
        self.extra_environment.push((name.into(), value.into()));
        self
    }

    pub fn executable(&self) -> &Path {
        &self.executable
    }

    /// Runs `git <GLOBAL_ARGUMENTS> <arguments>` in `working_directory`. `stdin` is closed
    /// right after it was written; without it the process gets no stdin at all.
    pub fn run<S: AsRef<OsStr>>(
        &self,
        arguments: &[S],
        working_directory: &Path,
        stdin: Option<&[u8]>,
        timeout: Duration,
    ) -> Result<GitOutput, GitRunError> {
        let mut command = self.command(arguments, working_directory, stdin.is_some());
        let mut child = command.spawn().map_err(GitRunError::Spawn)?;

        let stdout = capture(child.stdout.take(), GIT_STDOUT_LIMIT_BYTES);
        let stderr = capture(child.stderr.take(), GIT_STDERR_LIMIT_BYTES);
        let writer = stdin.map(|bytes| write_stdin(child.stdin.take(), bytes.to_vec()));

        let outcome = wait_with_deadline(&mut child, timeout);
        // After the process ended (or was killed) its pipes close, so the readers finish
        // unless a grandchild still holds them; then what was read so far is used.
        let stdout = stdout.finish();
        let stderr = stderr.finish();
        if let Some(writer) = writer {
            let _ = writer.recv_timeout(GIT_PIPE_DRAIN_GRACE);
        }
        let status = outcome?;
        Ok(GitOutput {
            status,
            stdout: stdout.bytes,
            stderr: stderr.bytes,
            stdout_truncated: stdout.truncated,
            stderr_truncated: stderr.truncated,
        })
    }

    fn command<S: AsRef<OsStr>>(
        &self,
        arguments: &[S],
        working_directory: &Path,
        has_stdin: bool,
    ) -> Command {
        let mut command = Command::new(&self.executable);
        command
            .args(GLOBAL_ARGUMENTS)
            .args(arguments)
            .current_dir(working_directory)
            .stdin(if has_stdin {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for name in REDIRECTING_ENVIRONMENT {
            command.env_remove(name);
        }
        command
            .env(ENV_TERMINAL_PROMPT.0, ENV_TERMINAL_PROMPT.1)
            .env(ENV_EDITOR, GIT_NO_OP_EDITOR)
            .env(ENV_SEQUENCE_EDITOR, GIT_NO_OP_EDITOR);
        for (name, value) in &self.extra_environment {
            command.env(name, value);
        }
        hide_console_window(&mut command);
        command
    }
}

#[cfg(windows)]
fn hide_console_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(super::constants::CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_command: &mut Command) {}

/// Polls instead of blocking so the deadline can be enforced; on expiry the process is
/// killed and reaped (`wait`), so no zombie stays behind.
fn wait_with_deadline(child: &mut Child, timeout: Duration) -> Result<ExitStatus, GitRunError> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {}
            Err(error) => {
                terminate(child);
                return Err(GitRunError::Spawn(error));
            }
        }
        if Instant::now() >= deadline {
            terminate(child);
            return Err(GitRunError::Timeout);
        }
        thread::sleep(GIT_POLL_INTERVAL);
    }
}

fn terminate(child: &mut Child) {
    // Both can fail only when the process already ended, which is the goal.
    let _ = child.kill();
    let _ = child.wait();
}

struct Captured {
    bytes: Vec<u8>,
    truncated: bool,
}

/// A reader thread's result, shared so the bytes read so far survive a reader that is still
/// blocked on a pipe held by a grandchild.
struct CaptureHandle {
    shared: Arc<Mutex<Captured>>,
    finished: Receiver<()>,
}

impl CaptureHandle {
    fn finish(self) -> Captured {
        // A reader that does not finish in time is abandoned; it ends with its pipe.
        let _ = self.finished.recv_timeout(GIT_PIPE_DRAIN_GRACE);
        let mut guard = self.shared.lock().unwrap_or_else(PoisonError::into_inner);
        Captured {
            bytes: std::mem::take(&mut guard.bytes),
            truncated: guard.truncated,
        }
    }
}

/// Reads on a thread so a full pipe never blocks the child. Beyond `limit` the data is
/// still read (and dropped) because a child blocked on a full pipe would never exit.
fn capture<R: Read + Send + 'static>(stream: Option<R>, limit: usize) -> CaptureHandle {
    let shared = Arc::new(Mutex::new(Captured {
        bytes: Vec::new(),
        truncated: false,
    }));
    let (done, finished) = mpsc::channel();
    let target = Arc::clone(&shared);
    thread::spawn(move || {
        if let Some(mut stream) = stream {
            let mut chunk = [0_u8; READ_CHUNK_BYTES];
            while let Ok(read) = stream.read(&mut chunk) {
                if read == 0 {
                    break;
                }
                let mut guard = target.lock().unwrap_or_else(PoisonError::into_inner);
                let room = limit.saturating_sub(guard.bytes.len());
                guard.bytes.extend_from_slice(&chunk[..read.min(room)]);
                if read > room {
                    guard.truncated = true;
                }
            }
        }
        let _ = done.send(());
    });
    CaptureHandle { shared, finished }
}

/// Written on a thread: a payload larger than the pipe buffer would otherwise block here
/// while git blocks on a full stdout.
fn write_stdin(pipe: Option<std::process::ChildStdin>, bytes: Vec<u8>) -> Receiver<()> {
    let (done, finished) = mpsc::channel();
    thread::spawn(move || {
        if let Some(mut pipe) = pipe {
            // A broken pipe means git exited without reading everything; its exit code and
            // stderr tell why.
            let _ = pipe.write_all(&bytes);
        }
        let _ = done.send(());
    });
    finished
}

#[cfg(all(test, unix))]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    const TEST_TIMEOUT: Duration = Duration::from_secs(10);

    struct FakeGit {
        directory: PathBuf,
        executable: PathBuf,
    }

    impl FakeGit {
        /// A shell script standing in for git, so the runner is tested without a real git.
        fn new(script: &str) -> Self {
            let directory = std::env::temp_dir()
                .join(format!("design-dawn-git-runner-{}", uuid::Uuid::now_v7()));
            fs::create_dir_all(&directory).unwrap();
            let executable = directory.join("git");
            fs::write(&executable, format!("#!/bin/sh\n{script}\n")).unwrap();
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
            Self {
                directory,
                executable,
            }
        }

        fn runner(&self) -> GitRunner {
            GitRunner::new(self.executable.clone())
        }
    }

    impl Drop for FakeGit {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    #[test]
    fn captures_stdout_stderr_and_the_exit_code() {
        let fake = FakeGit::new("echo out; echo err >&2; exit 3");

        let output = fake
            .runner()
            .run(&["anything"], &fake.directory, None, TEST_TIMEOUT)
            .unwrap();

        assert_eq!(output.stdout, b"out\n");
        assert_eq!(output.stderr, b"err\n");
        assert_eq!(output.exit_code(), Some(3));
        assert!(!output.success());
    }

    #[test]
    fn global_arguments_come_first_and_arguments_stay_separate() {
        let fake = FakeGit::new("for argument in \"$@\"; do echo \"[$argument]\"; done");

        let output = fake
            .runner()
            .run(
                &["status", "a b; $(touch injected)"],
                &fake.directory,
                None,
                TEST_TIMEOUT,
            )
            .unwrap();

        let lines = String::from_utf8(output.stdout).unwrap();
        assert_eq!(
            lines,
            "[--no-pager]\n[--literal-pathspecs]\n[-c]\n[color.ui=false]\n[-c]\n[core.quotepath=false]\n[status]\n[a b; $(touch injected)]\n"
        );
        assert!(!fake.directory.join("injected").exists());
    }

    #[test]
    fn runs_in_the_given_directory_with_the_fixed_environment() {
        let fake = FakeGit::new(
            "pwd; echo \"$GIT_TERMINAL_PROMPT|$GIT_EDITOR|$GIT_SEQUENCE_EDITOR|${GIT_DIR-unset}\"",
        );

        let output = fake
            .runner()
            .run::<&str>(&[], &fake.directory, None, TEST_TIMEOUT)
            .unwrap();

        let text = String::from_utf8(output.stdout).unwrap();
        let mut lines = text.lines();
        assert_eq!(
            fs::canonicalize(lines.next().unwrap()).unwrap(),
            fs::canonicalize(&fake.directory).unwrap()
        );
        assert_eq!(lines.next(), Some("0|:|:|unset"));
    }

    #[test]
    fn extra_environment_is_applied() {
        let fake = FakeGit::new("echo \"$DAWN_TEST_VALUE\"");

        let output = fake
            .runner()
            .with_environment("DAWN_TEST_VALUE", "configured")
            .run::<&str>(&[], &fake.directory, None, TEST_TIMEOUT)
            .unwrap();

        assert_eq!(output.stdout, b"configured\n");
    }

    #[test]
    fn stdin_is_empty_unless_given_and_given_bytes_reach_the_process() {
        let fake = FakeGit::new("cat");

        let without = fake
            .runner()
            .run::<&str>(&[], &fake.directory, None, TEST_TIMEOUT)
            .unwrap();
        let with = fake
            .runner()
            .run::<&str>(&[], &fake.directory, Some(b"message\0path"), TEST_TIMEOUT)
            .unwrap();

        assert!(without.stdout.is_empty());
        assert_eq!(with.stdout, b"message\0path");
    }

    #[test]
    fn a_large_stdin_does_not_deadlock() {
        let fake = FakeGit::new("cat");
        let payload = vec![b'x'; 4 * 1024 * 1024];

        let output = fake
            .runner()
            .run::<&str>(&[], &fake.directory, Some(&payload), TEST_TIMEOUT)
            .unwrap();

        assert_eq!(output.stdout.len(), payload.len());
    }

    #[test]
    fn a_process_that_outlives_the_limit_is_killed_and_reported_as_timeout() {
        let fake = FakeGit::new("sleep 30");
        let started = Instant::now();

        let outcome =
            fake.runner()
                .run::<&str>(&[], &fake.directory, None, Duration::from_millis(200));

        assert!(matches!(outcome, Err(GitRunError::Timeout)));
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn output_beyond_the_limit_is_cut_and_flagged_without_blocking_the_process() {
        let limit = GIT_STDOUT_LIMIT_BYTES;
        let fake = FakeGit::new(&format!(
            "head -c {} /dev/zero; exit 0",
            limit + READ_CHUNK_BYTES * 3
        ));

        let output = fake
            .runner()
            .run::<&str>(&[], &fake.directory, None, TEST_TIMEOUT)
            .unwrap();

        assert!(output.success());
        assert_eq!(output.stdout.len(), limit);
        assert!(output.stdout_truncated);
        assert!(!output.stderr_truncated);
    }

    #[test]
    fn a_missing_executable_is_a_spawn_error() {
        let runner = GitRunner::new(PathBuf::from("/nonexistent/design-dawn/git"));

        let outcome = runner.run::<&str>(&[], Path::new("/"), None, TEST_TIMEOUT);

        assert!(matches!(outcome, Err(GitRunError::Spawn(_))));
    }
}
