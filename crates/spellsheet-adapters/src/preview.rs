//! What a file looks like at a glance, for Studio's hover preview: a
//! picture's bytes, the first rows of a table (Excel, CSV), the start of a
//! text file. Reads only the start of what it needs and never changes
//! anything.

use std::io::Read;
use std::path::Path;

use base64::Engine as _;
use serde_json::{Value, json};
use spellsheet_excel::a1::{Cell, Range};
use spellsheet_excel::book;

/// Pictures larger than this are not sent to the screen.
pub const MAX_IMAGE_BYTES: u64 = 12 * 1024 * 1024;
/// Rows of a table after its header.
pub const TABLE_ROWS: usize = 5;
/// Columns of a table.
pub const TABLE_COLUMNS: usize = 8;
/// How much of a CSV or text file is read.
const HEAD_BYTES: usize = 64 * 1024;
/// Characters of a text file shown.
const TEXT_CHARS: usize = 1200;

const IMAGES: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("bmp", "image/bmp"),
];
const WORKBOOKS: &[&str] = &["xlsx", "xlsm"];
const TABLES: &[&str] = &["csv", "tsv"];
/// Paragraphs and tables of a document shown before "more".
pub const DOCUMENT_BLOCKS: usize = 40;
/// Pages of a PDF read for its preview.
const PDF_PAGES: usize = 2;
/// PDFs larger than this are not read for a preview.
const MAX_PDF_BYTES: u64 = 20 * 1024 * 1024;
/// Names listed from a zip file.
const ARCHIVE_ENTRIES: usize = 30;
const TEXTS: &[&str] = &[
    "txt", "md", "log", "json", "xml", "html", "htm", "yaml", "yml", "ini", "toml",
];

fn extension(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

/// Whether Studio can show something for this file name.
pub fn previewable(path: &Path) -> bool {
    let ext = extension(path);
    IMAGES.iter().any(|(e, _)| *e == ext)
        || WORKBOOKS.contains(&ext.as_str())
        || TABLES.contains(&ext.as_str())
        || TEXTS.contains(&ext.as_str())
        || matches!(ext.as_str(), "docx" | "docm" | "pdf" | "zip")
}

/// The preview of `path` as Studio shows it, one of:
/// `{kind: "image", mime, data (base64), bytes}`,
/// `{kind: "table", columns, rows, sheet?, sheets?}`,
/// `{kind: "text", text, more}`,
/// `{kind: "missing"}`, `{kind: "tooLarge", bytes}`,
/// `{kind: "file", bytes}` (nothing to show but its size) or
/// `{kind: "unreadable", message}`.
/// `sheet` picks the sheet of a workbook (else the first one).
pub fn preview(path: &Path, sheet: Option<&str>) -> Value {
    let Ok(meta) = std::fs::metadata(path) else {
        return json!({ "kind": "missing" });
    };
    if !meta.is_file() {
        return json!({ "kind": "missing" });
    }
    let bytes = meta.len();
    let ext = extension(path);
    let result = if let Some((_, mime)) = IMAGES.iter().find(|(e, _)| *e == ext) {
        if bytes > MAX_IMAGE_BYTES {
            return json!({ "kind": "tooLarge", "bytes": bytes });
        }
        std::fs::read(path)
            .map(|data| {
                json!({
                    "kind": "image",
                    "mime": mime,
                    "data": base64::engine::general_purpose::STANDARD.encode(data),
                    "bytes": bytes,
                })
            })
            .map_err(|e| e.to_string())
    } else if WORKBOOKS.contains(&ext.as_str()) {
        workbook(path, sheet)
    } else if TABLES.contains(&ext.as_str()) {
        head(path)
            .map(|data| csv_table(&data, if ext == "tsv" { b'\t' } else { b',' }))
            .map_err(|e| e.to_string())
    } else if TEXTS.contains(&ext.as_str()) {
        head(path)
            .map(|data| {
                let text = decode(&data);
                let shown: String = text.chars().take(TEXT_CHARS).collect();
                let more = bytes as usize > data.len() || shown.len() < text.len();
                json!({ "kind": "text", "text": shown, "more": more })
            })
            .map_err(|e| e.to_string())
    } else if ext == "docx" || ext == "docm" {
        spellsheet_word::document_blocks(path).map(|blocks| document(&blocks, None))
    } else if ext == "pdf" {
        if bytes > MAX_PDF_BYTES {
            return json!({ "kind": "tooLarge", "bytes": bytes });
        }
        std::fs::read(path)
            .map_err(|e| e.to_string())
            .and_then(|data| spellsheet_pdf::preview_pages(&data, PDF_PAGES))
            .map(|(pages, count)| pdf_document(&pages, count))
    } else if ext == "zip" {
        archive(path)
    } else {
        Ok(json!({ "kind": "file", "bytes": bytes }))
    };
    result.unwrap_or_else(|message| json!({ "kind": "unreadable", "message": message }))
}

/// `{kind: "document", blocks, more, pages?}`: paragraphs (`{kind: "paragraph", text, heading}`)
/// and tables (`{kind: "table", rows}`). Runs of empty paragraphs become one.
fn document(blocks: &[spellsheet_word::docx::Block], pages: Option<usize>) -> Value {
    use spellsheet_word::docx::Block;
    let mut shown: Vec<Value> = Vec::new();
    let mut blank = false;
    let mut more = false;
    for block in blocks {
        if shown.len() >= DOCUMENT_BLOCKS {
            more = true;
            break;
        }
        match block {
            Block::Paragraph { text, .. } if text.trim().is_empty() => blank = true,
            Block::Paragraph { text, heading } => {
                if blank && !shown.is_empty() {
                    shown.push(json!({ "kind": "paragraph", "text": "", "heading": false }));
                }
                blank = false;
                shown.push(json!({ "kind": "paragraph", "text": text, "heading": heading }));
            }
            Block::Table { rows } => {
                blank = false;
                let rows: Vec<Vec<String>> = rows
                    .iter()
                    .take(TABLE_ROWS * 4)
                    .map(|r| r.iter().take(TABLE_COLUMNS).cloned().collect())
                    .collect();
                shown.push(json!({ "kind": "table", "rows": rows }));
            }
        }
    }
    let mut out = json!({ "kind": "document", "blocks": shown, "more": more });
    if let Some(pages) = pages {
        out["pages"] = json!(pages);
    }
    out
}

/// A PDF's first pages as a document: each line a paragraph.
fn pdf_document(pages: &[String], count: usize) -> Value {
    use spellsheet_word::docx::Block;
    let mut blocks = Vec::new();
    for page in pages {
        for line in page.lines() {
            blocks.push(Block::Paragraph {
                text: line.trim_end().to_owned(),
                heading: false,
            });
        }
        blocks.push(Block::Paragraph {
            text: String::new(),
            heading: false,
        });
    }
    let mut out = document(&blocks, Some(count));
    if count > pages.len() {
        out["more"] = json!(true);
    }
    out
}

/// `{kind: "archive", entries: [{name, bytes}], count, more}`: the files a zip holds.
fn archive(path: &Path) -> Result<Value, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    let mut count = 0;
    for i in 0..zip.len() {
        let entry = zip.by_index_raw(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        count += 1;
        if entries.len() < ARCHIVE_ENTRIES {
            let name = entry.name().map_err(|e| e.to_string())?.into_owned();
            entries.push(json!({ "name": name, "bytes": entry.size() }));
        }
    }
    Ok(
        json!({ "kind": "archive", "entries": entries, "count": count, "more": count > entries.len() }),
    )
}

/// The first [`HEAD_BYTES`] of a file, cut after its last full line.
fn head(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut data = Vec::with_capacity(HEAD_BYTES);
    std::fs::File::open(path)?
        .take(HEAD_BYTES as u64)
        .read_to_end(&mut data)?;
    if data.len() == HEAD_BYTES {
        // A newline byte never sits inside a UTF-8 or Shift_JIS character.
        if let Some(end) = data.iter().rposition(|b| *b == b'\n') {
            data.truncate(end + 1);
        }
    }
    Ok(data)
}

fn decode(data: &[u8]) -> String {
    spellsheet_files::encoding::decode(data, "auto", "")
        .unwrap_or_else(|_| String::from_utf8_lossy(data).into_owned())
        .trim_start_matches('\u{feff}')
        .to_owned()
}

fn csv_table(data: &[u8], delimiter: u8) -> Value {
    let text = decode(data);
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(false)
        .flexible(true)
        .from_reader(text.as_bytes());
    let mut records = reader.records().filter_map(Result::ok);
    let columns: Vec<String> = records
        .next()
        .map(|r| r.iter().take(TABLE_COLUMNS).map(str::to_owned).collect())
        .unwrap_or_default();
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut more = false;
    for record in records {
        if rows.len() == TABLE_ROWS {
            more = true;
            break;
        }
        rows.push(
            record
                .iter()
                .take(TABLE_COLUMNS)
                .map(str::to_owned)
                .collect(),
        );
    }
    json!({ "kind": "table", "columns": columns, "rows": rows, "more": more })
}

fn cell_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn workbook(path: &Path, sheet: Option<&str>) -> Result<Value, String> {
    let shown = path.to_string_lossy();
    let book = book::open(&shown).map_err(|e| e.message)?;
    let names = book::sheet_names(&book);
    let found = match book::sheet(&book, sheet) {
        Ok(found) => found,
        Err(_) => book::sheet(&book, None).map_err(|e| e.message)?,
    };
    let date1904 = book.date1904();
    let (columns, rows, more) = match book::used_range(found) {
        None => (Vec::new(), Vec::new(), false),
        Some(used) => {
            let end = Cell {
                column: used
                    .end
                    .column
                    .min(used.start.column + TABLE_COLUMNS as u32 - 1),
                row: used.end.row.min(used.start.row + TABLE_ROWS as u32),
            };
            let cells = book::read_range(
                found,
                Range {
                    start: used.start,
                    end,
                },
                date1904,
            );
            let mut lines: Vec<Vec<String>> = cells
                .as_array()
                .map(|rows| {
                    rows.iter()
                        .map(|r| {
                            r.as_array()
                                .map(|c| c.iter().map(cell_text).collect())
                                .unwrap_or_default()
                        })
                        .collect()
                })
                .unwrap_or_default();
            let columns = if lines.is_empty() {
                Vec::new()
            } else {
                lines.remove(0)
            };
            (columns, lines, used.end.row > end.row)
        }
    };
    Ok(json!({
        "kind": "table",
        "sheet": found.name(),
        "sheets": names,
        "columns": columns,
        "rows": rows,
        "more": more,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_word_document_shows_its_paragraphs_and_tables_in_order() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../examples/tutorials/invoices/templates/請求書_ひな形.docx");
        let shown = preview(&path, None);
        assert_eq!(shown["kind"], "document", "{shown}");
        let blocks = shown["blocks"].as_array().unwrap();
        assert!(
            blocks.iter().any(|b| b["kind"] == "paragraph"
                && b["text"].as_str().is_some_and(|t| t.contains("請求書"))),
            "{shown}"
        );
        assert!(blocks.iter().any(|b| b["kind"] == "table"), "{shown}");
    }

    #[test]
    fn a_zip_lists_its_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        zip.add_directory("sub/", options).unwrap();
        zip.start_file("sub/請求書.docx", options).unwrap();
        std::io::Write::write_all(&mut zip, b"abc").unwrap();
        zip.finish().unwrap();
        let shown = preview(&path, None);
        assert_eq!(shown["kind"], "archive", "{shown}");
        assert_eq!(shown["count"], 1);
        assert_eq!(shown["entries"][0]["name"], "sub/請求書.docx");
        assert_eq!(shown["entries"][0]["bytes"], 3);
    }

    #[test]
    fn a_missing_file_says_so() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            preview(&dir.path().join("none.png"), None)["kind"],
            "missing"
        );
        assert_eq!(preview(dir.path(), None)["kind"], "missing");
    }

    #[test]
    fn a_picture_is_sent_as_base64() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("button.PNG");
        std::fs::write(&path, b"\x89PNG\r\n\x1a\nxyz").unwrap();
        let p = preview(&path, None);
        assert_eq!(p["kind"], "image");
        assert_eq!(p["mime"], "image/png");
        assert_eq!(p["bytes"], 11);
        assert_eq!(p["data"], "iVBORw0KGgp4eXo=");
    }

    #[test]
    fn a_csv_shows_its_header_and_first_rows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("orders.csv");
        let mut text = String::from("\u{feff}注文番号,金額\n");
        for i in 0..10 {
            text.push_str(&format!("A{i},{}\n", i * 100));
        }
        std::fs::write(&path, text).unwrap();
        let p = preview(&path, None);
        assert_eq!(p["kind"], "table");
        assert_eq!(p["columns"], json!(["注文番号", "金額"]));
        assert_eq!(p["rows"].as_array().unwrap().len(), TABLE_ROWS);
        assert_eq!(p["rows"][1], json!(["A1", "100"]));
        assert_eq!(p["more"], true);
    }

    #[test]
    fn a_shift_jis_csv_is_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sjis.csv");
        let (bytes, _, _) = encoding_rs::SHIFT_JIS.encode("名前,年齢\n山田,30\n");
        std::fs::write(&path, &bytes).unwrap();
        let p = preview(&path, None);
        assert_eq!(p["columns"], json!(["名前", "年齢"]));
        assert_eq!(p["rows"], json!([["山田", "30"]]));
        assert_eq!(p["more"], false);
    }

    #[test]
    fn a_text_file_shows_its_start() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.txt");
        std::fs::write(&path, "あ".repeat(TEXT_CHARS + 10)).unwrap();
        let p = preview(&path, None);
        assert_eq!(p["kind"], "text");
        assert_eq!(p["text"].as_str().unwrap().chars().count(), TEXT_CHARS);
        assert_eq!(p["more"], true);
    }

    #[test]
    fn a_workbook_shows_the_first_rows_of_its_sheet() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.xlsx");
        let shown = path.to_string_lossy().into_owned();
        let mut wb = book::open_or_create(&shown, None).unwrap();
        book::add_sheet(&mut wb, "明細").unwrap();
        let mut rows = vec![json!(["品名", "数量"])];
        for row in 2..=9 {
            rows.push(json!([format!("品{row}"), row]));
        }
        let sheet = book::sheet_mut(&mut wb, Some("明細")).unwrap();
        book::write_range(sheet, Cell { column: 1, row: 1 }, &rows, false).unwrap();
        book::save(&wb, &shown).unwrap();
        let p = preview(&path, Some("明細"));
        assert_eq!(p["kind"], "table", "{p}");
        assert_eq!(p["sheet"], "明細");
        assert_eq!(p["columns"], json!(["品名", "数量"]));
        assert_eq!(p["rows"][0], json!(["品2", "2"]));
        assert_eq!(p["rows"].as_array().unwrap().len(), TABLE_ROWS);
        assert_eq!(p["more"], true);
        // An unknown sheet falls back to the first one.
        assert_eq!(preview(&path, Some("ない"))["sheet"], "Sheet1");
    }

    #[test]
    fn other_files_give_their_size() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("setup.exe");
        std::fs::write(&path, b"1234").unwrap();
        assert_eq!(preview(&path, None), json!({ "kind": "file", "bytes": 4 }));
        assert!(!previewable(&path));
        assert!(previewable(Path::new("a/b.JPG")));
    }
}
