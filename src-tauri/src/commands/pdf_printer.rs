//! A PDF made from an export page without the print dialog: the page is loaded into a
//! hidden window of its own (no access to the app's commands: its label matches no
//! capability) and the webview prints it to PDF.
//!
//! - Windows (WebView2): Chromium's `Page.printToPDF` through the DevTools protocol, with the
//!   page sizes the page asks for (`@page` per sheet), no margins and backgrounds.
//! - Linux (WebKitGTK): the print operation writing to a file, without a dialog. GTK prints
//!   every page on one paper size, so the largest page size of the export is used.
//! - Other systems: not available.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Mutex;
use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Runtime, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use uuid::Uuid;

use crate::application::error::{ApplicationError, ApplicationResult, ErrorKind};

/// How long the page may take to load, and the printer to finish a document.
const LOAD_TIMEOUT: Duration = Duration::from_secs(30);
const PRINT_TIMEOUT: Duration = Duration::from_secs(180);
const WINDOW_LABEL_PREFIX: &str = "pdf-export-";
const PAGE_FILE_EXTENSION: &str = "html";
#[cfg(target_os = "linux")]
const PDF_FILE_EXTENSION: &str = "pdf";

/// The hidden windows that print a PDF; they are plain windows (see `handle_window_event`).
pub fn is_pdf_window(label: &str) -> bool {
    label.starts_with(WINDOW_LABEL_PREFIX)
}

/// The largest page of the export, in CSS pixels (96 per inch).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageExtent {
    pub width: f64,
    pub height: f64,
}

/// Where the printer's answer goes: the PDF's bytes or why there is none, sent once.
type PdfAnswer = Result<Vec<u8>, String>;
type PdfSender = Mutex<Option<Sender<PdfAnswer>>>;

fn failed(detail: impl Into<String>) -> ApplicationError {
    ApplicationError::new(ErrorKind::ExportFailed, detail)
}

/// Removes the hidden window and the page file whatever happens.
struct PrintJob<R: Runtime> {
    window: Option<WebviewWindow<R>>,
    files: Vec<PathBuf>,
}

impl<R: Runtime> Drop for PrintJob<R> {
    fn drop(&mut self) {
        if let Some(window) = self.window.take() {
            let _ = window.destroy();
        }
        for file in &self.files {
            let _ = std::fs::remove_file(file);
        }
    }
}

/// Prints `html` (a complete page without scripts) to PDF and returns the file's bytes.
/// Blocks the calling thread (run it on the blocking pool), never the main thread.
pub fn print_html_to_pdf<R: Runtime>(
    app: &AppHandle<R>,
    html: &str,
    largest_page: PageExtent,
) -> ApplicationResult<Vec<u8>> {
    let id = Uuid::now_v7();
    let page_file = std::env::temp_dir().join(format!("dawn-export-{id}.{PAGE_FILE_EXTENSION}"));
    let mut job = PrintJob::<R> {
        window: None,
        files: vec![page_file.clone()],
    };
    std::fs::write(&page_file, html).map_err(|error| failed(format!("page file: {error}")))?;
    let url =
        Url::from_file_path(&page_file).map_err(|()| failed("the page file has no file URL"))?;
    let (loaded_sender, loaded) = channel::<()>();
    let loaded_sender = Mutex::new(Some(loaded_sender));
    let window = WebviewWindowBuilder::new(
        app,
        format!("{WINDOW_LABEL_PREFIX}{id}"),
        WebviewUrl::External(url),
    )
    .visible(false)
    .focused(false)
    .skip_taskbar(true)
    .inner_size(largest_page.width, largest_page.height)
    .on_page_load(move |_, payload| {
        if payload.event() == PageLoadEvent::Finished {
            if let Some(sender) = loaded_sender
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take()
            {
                let _ = sender.send(());
            }
        }
    })
    .build()
    .map_err(|error| failed(format!("print window: {error}")))?;
    job.window = Some(window.clone());
    loaded
        .recv_timeout(LOAD_TIMEOUT)
        .map_err(|_| failed("the page did not load"))?;
    print_window(&window, &mut job.files, &page_file, largest_page)
}

fn wait_for(result: &Receiver<PdfAnswer>) -> ApplicationResult<Vec<u8>> {
    result
        .recv_timeout(PRINT_TIMEOUT)
        .map_err(|_| failed("the printer did not finish"))?
        .map_err(failed)
}

fn send_once(sender: &PdfSender, value: PdfAnswer) {
    if let Some(sender) = sender
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take()
    {
        let _ = sender.send(value);
    }
}

#[cfg(windows)]
fn print_window<R: Runtime>(
    window: &WebviewWindow<R>,
    _files: &mut Vec<PathBuf>,
    _page_file: &Path,
    _largest_page: PageExtent,
) -> ApplicationResult<Vec<u8>> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows::core::HSTRING;

    /// The page sizes come from the page's `@page` rules; nothing is added around them.
    const PRINT_TO_PDF: &str = "Page.printToPDF";
    const PRINT_PARAMETERS: &str = r#"{"printBackground":true,"preferCSSPageSize":true,"marginTop":0,"marginBottom":0,"marginLeft":0,"marginRight":0}"#;

    let (sender, result) = channel();
    let sender = std::sync::Arc::new(Mutex::new(Some(sender)));
    let on_error = std::sync::Arc::clone(&sender);
    window
        .with_webview(move |platform| {
            let started = (|| -> windows::core::Result<()> {
                // SAFETY: COM calls on the webview's own (main) thread, as `with_webview`
                // runs this closure there; the handler keeps its own reference.
                unsafe {
                    let core = platform.controller().CoreWebView2()?;
                    let completed = std::sync::Arc::clone(&sender);
                    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                        move |outcome, json| {
                            send_once(
                                &completed,
                                outcome
                                    .map_err(|error| error.to_string())
                                    .and_then(|()| pdf_from_devtools_answer(&json)),
                            );
                            Ok(())
                        },
                    ));
                    core.CallDevToolsProtocolMethod(
                        &HSTRING::from(PRINT_TO_PDF),
                        &HSTRING::from(PRINT_PARAMETERS),
                        &handler,
                    )
                }
            })();
            if let Err(error) = started {
                send_once(&on_error, Err(error.to_string()));
            }
        })
        .map_err(|error| failed(format!("webview: {error}")))?;
    wait_for(&result)
}

/// The PDF in the answer of `Page.printToPDF` (`{"data": "<base64>"}`).
#[cfg_attr(not(windows), allow(dead_code))]
fn pdf_from_devtools_answer(json: &str) -> Result<Vec<u8>, String> {
    let answer: serde_json::Value =
        serde_json::from_str(json).map_err(|error| format!("answer: {error}"))?;
    let data = answer
        .get("data")
        .and_then(serde_json::Value::as_str)
        .ok_or("the answer has no PDF")?;
    decode_base64(data).ok_or_else(|| "the PDF is not base64".to_owned())
}

#[cfg(target_os = "linux")]
fn print_window<R: Runtime>(
    window: &WebviewWindow<R>,
    files: &mut Vec<PathBuf>,
    page_file: &Path,
    largest_page: PageExtent,
) -> ApplicationResult<Vec<u8>> {
    use webkit2gtk::PrintOperationExt;

    /// CSS pixels are 1/96 inch, points 1/72.
    const POINTS_PER_CSS_PIXEL: f64 = 72.0 / 96.0;
    const PRINT_TO_FILE_PRINTER: &str = "Print to File";
    const PDF_FORMAT: &str = "pdf";
    const PAPER_NAME: &str = "design-dawn-export";

    let pdf_file = page_file.with_extension(PDF_FILE_EXTENSION);
    files.push(pdf_file.clone());
    let output = Url::from_file_path(&pdf_file)
        .map_err(|()| failed("the PDF file has no file URL"))?
        .to_string();
    let (sender, result) = channel();
    let sender = std::sync::Arc::new(Mutex::new(Some(sender)));
    let target = pdf_file.clone();
    window
        .with_webview(move |platform| {
            let settings = gtk::PrintSettings::new();
            settings.set_printer(PRINT_TO_FILE_PRINTER);
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some(PDF_FORMAT));
            settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(&output));
            let paper = gtk::PaperSize::new_custom(
                PAPER_NAME,
                PAPER_NAME,
                largest_page.width * POINTS_PER_CSS_PIXEL,
                largest_page.height * POINTS_PER_CSS_PIXEL,
                gtk::Unit::Points,
            );
            let setup = gtk::PageSetup::new();
            setup.set_paper_size(&paper);
            for set_margin in [
                gtk::PageSetup::set_top_margin,
                gtk::PageSetup::set_bottom_margin,
                gtk::PageSetup::set_left_margin,
                gtk::PageSetup::set_right_margin,
            ] {
                set_margin(&setup, 0.0, gtk::Unit::Points);
            }
            let operation = webkit2gtk::PrintOperation::new(&platform.inner());
            operation.set_print_settings(&settings);
            operation.set_page_setup(&setup);
            let finished = std::sync::Arc::clone(&sender);
            operation.connect_finished(move |_| {
                send_once(
                    &finished,
                    std::fs::read(&target).map_err(|error| format!("read PDF: {error}")),
                );
            });
            let failed_print = std::sync::Arc::clone(&sender);
            operation.connect_failed(move |_, error| {
                send_once(&failed_print, Err(error.to_string()));
            });
            operation.print();
        })
        .map_err(|error| failed(format!("webview: {error}")))?;
    wait_for(&result)
}

#[cfg(not(any(windows, target_os = "linux")))]
fn print_window<R: Runtime>(
    _window: &WebviewWindow<R>,
    _files: &mut Vec<PathBuf>,
    _page_file: &Path,
    _largest_page: PageExtent,
) -> ApplicationResult<Vec<u8>> {
    Err(failed("PDF export is not available on this system"))
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_PADDING: u8 = b'=';
const BITS_PER_BASE64_DIGIT: u32 = 6;
const BITS_PER_BYTE: u32 = 8;
const BYTE_MASK: u32 = 0xff;

/// Standard base64 (with or without padding); `None` for any other character.
#[cfg_attr(not(windows), allow(dead_code))]
fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let mut bytes = Vec::with_capacity(text.len() * 3 / 4);
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;
    for character in text.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        if character == BASE64_PADDING {
            break;
        }
        let value = BASE64_ALPHABET
            .iter()
            .position(|&digit| digit == character)?;
        buffer = (buffer << BITS_PER_BASE64_DIGIT) | u32::try_from(value).ok()?;
        bits += BITS_PER_BASE64_DIGIT;
        if bits >= BITS_PER_BYTE {
            bits -= BITS_PER_BYTE;
            bytes.push(u8::try_from((buffer >> bits) & BYTE_MASK).ok()?);
        }
    }
    Some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_decodes_with_and_without_padding() {
        assert_eq!(decode_base64("JVBERi0xLjc=").unwrap(), b"%PDF-1.7");
        assert_eq!(decode_base64("JVBERi0x").unwrap(), b"%PDF-1");
        assert_eq!(decode_base64("YQ").unwrap(), b"a");
        assert!(decode_base64("a*b").is_none());
    }

    #[test]
    fn the_devtools_answer_gives_the_pdf() {
        assert_eq!(
            pdf_from_devtools_answer(r#"{"data":"JVBERi0xLjc="}"#).unwrap(),
            b"%PDF-1.7"
        );
        assert!(pdf_from_devtools_answer("{}").is_err());
    }
}
