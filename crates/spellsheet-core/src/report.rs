//! Reports to SpellSheet's developers: a bug an AI ran into, or a node it
//! needed and SpellSheet does not have (docs/design/reports.md).
//!
//! The AI only writes a draft (MCP `report_to_developers`). Nothing leaves
//! the PC until the person has read the draft in Writer, removed what they
//! do not want to show, and pressed 送る; Writer then hands it to the relay
//! server (`services/report-relay`), which files it as a GitHub issue. The
//! app never holds a GitHub key.
//!
//! A draft is one file in the per-PC part of the workspace (`reports/`).
//! 送らない removes it. A sent report stays for a while with the issue's
//! address, so Writer can show where it went.
//!
//! Mail addresses, phone numbers, addresses of sites and folders, and the
//! Windows user name in paths are hidden ([`redact`]) when the draft is
//! written and again when the person edits it, so a careless draft does
//! not show them even on the person's screen. That is a help, not a
//! guarantee: the person reads the draft before it goes.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use time::{Duration, OffsetDateTime};

use crate::error::{CoreError, CoreResult};
use crate::ids::ReportId;
use crate::store::write_atomic;

/// Longest title, in characters (GitHub's limit is far above it).
pub const MAX_TITLE_CHARS: usize = 120;
/// Longest body, in characters.
pub const MAX_BODY_CHARS: usize = 6000;
/// Drafts that may wait for the person at once.
const MAX_DRAFTS: usize = 10;
/// How long a sent report stays in the list.
const KEEP_SENT_DAYS: i64 = 30;

/// What the report is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ReportKind {
    /// SpellSheet did something wrong (a step failed though used as
    /// documented, a tool answered wrongly, the app misbehaved).
    Bug,
    /// A node SpellSheet does not have and the flow needed (it had to be
    /// worked around with several nodes or a script).
    MissingNode,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ReportStatus {
    /// Waits for the person to read it and decide.
    #[default]
    Draft,
    /// Sent to the developers.
    Sent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub id: ReportId,
    pub kind: ReportKind,
    pub title: String,
    pub body: String,
    /// The node type the report is about, e.g. `excel.readRows`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_type: Option<String>,
    #[serde(default)]
    pub status: ReportStatus,
    /// How many places [`redact`] hid in the text.
    #[serde(default)]
    pub hidden: usize,
    /// The issue it became.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue_url: Option<String>,
    /// The developers already had the same report; this one was added to it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub duplicate: bool,
    #[serde(with = "time::serde::rfc3339")]
    #[schemars(with = "String")]
    pub created_at: OffsetDateTime,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "time::serde::rfc3339::option"
    )]
    #[schemars(with = "Option<String>")]
    pub sent_at: Option<OffsetDateTime>,
}

/// What an AI asks to report.
#[derive(Debug, Clone)]
pub struct NewReport {
    pub kind: ReportKind,
    pub title: String,
    pub body: String,
    pub step_type: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ReportStore {
    dir: PathBuf,
}

fn rejected(code: &'static str, message: impl Into<String>, hint: Option<&str>) -> CoreError {
    CoreError::Rejected {
        code,
        message: message.into(),
        hint: hint.map(str::to_owned),
    }
}

/// Trimmed title and body, hidden where needed; an error names what is wrong.
fn clean(title: &str, body: &str) -> CoreResult<(String, String, usize)> {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let body = body.trim().to_owned();
    if title.is_empty() {
        return Err(rejected(
            "INVALID_PARAMS",
            "title is empty",
            Some("Give the report a one-line title, e.g. 「Excel の表を並べ替えるノードがない」."),
        ));
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(rejected(
            "INVALID_PARAMS",
            format!("title is longer than {MAX_TITLE_CHARS} characters"),
            Some("Keep the title to one short line; put the details in body."),
        ));
    }
    if body.is_empty() {
        return Err(rejected(
            "INVALID_PARAMS",
            "body is empty",
            Some(
                "Say what happened (or what node was missing), what you expected, and what you did instead.",
            ),
        ));
    }
    if body.chars().count() > MAX_BODY_CHARS {
        return Err(rejected(
            "INVALID_PARAMS",
            format!("body is longer than {MAX_BODY_CHARS} characters"),
            Some(
                "Shorten it: the developers need the step type, the error code and a few lines, not whole logs.",
            ),
        ));
    }
    let (title, a) = redact(&title);
    let (body, b) = redact(&body);
    Ok((title, body, a + b))
}

impl ReportStore {
    /// `local_root` is [`crate::FileStore::local_root`].
    pub fn new(local_root: &Path) -> Self {
        Self {
            dir: local_root.join("reports"),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path(&self, id: &ReportId) -> CoreResult<PathBuf> {
        if !id.is_well_formed() {
            return Err(not_found(id));
        }
        Ok(self.dir.join(format!("{id}.json")))
    }

    fn save(&self, report: &Report) -> CoreResult<()> {
        fs::create_dir_all(&self.dir)?;
        write_atomic(&self.path(&report.id)?, &serde_json::to_vec_pretty(report)?)
    }

    /// Files an AI's draft. A draft with the same kind and title that still
    /// waits is replaced, so an AI that reports twice does not ask twice.
    pub fn draft(&self, new: NewReport) -> CoreResult<Report> {
        let (title, body, hidden) = clean(&new.title, &new.body)?;
        let step_type = new
            .step_type
            .map(|s| s.trim().chars().take(80).collect::<String>())
            .filter(|s| !s.is_empty());
        let drafts = self.drafts()?;
        let same = drafts
            .iter()
            .find(|r| r.kind == new.kind && r.title == title);
        if same.is_none() && drafts.len() >= MAX_DRAFTS {
            return Err(rejected(
                "TOO_MANY_REPORTS",
                format!("{MAX_DRAFTS} reports already wait for the person"),
                Some(
                    "Do not report more now. Carry on with the work; the person reads the waiting reports in Writer.",
                ),
            ));
        }
        let report = Report {
            id: same.map_or_else(ReportId::generate, |r| r.id.clone()),
            kind: new.kind,
            title,
            body,
            step_type,
            status: ReportStatus::Draft,
            hidden,
            issue_url: None,
            duplicate: false,
            created_at: OffsetDateTime::now_utc(),
            sent_at: None,
        };
        self.save(&report)?;
        Ok(report)
    }

    /// Every report on file, newest first. Sent ones older than a month are removed.
    pub fn list(&self) -> CoreResult<Vec<Report>> {
        let entries = match fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let old = OffsetDateTime::now_utc() - Duration::days(KEEP_SENT_DAYS);
        let mut out = Vec::new();
        for entry in entries {
            let path = entry?.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let parsed = fs::read(&path)
                .map_err(CoreError::from)
                .and_then(|b| Ok(serde_json::from_slice::<Report>(&b)?));
            match parsed {
                Ok(r) if r.sent_at.is_some_and(|at| at < old) => {
                    let _ = fs::remove_file(&path);
                }
                Ok(r) => out.push(r),
                Err(e) => {
                    tracing::warn!(path = %path.display(), error = %e, "skipping unreadable report");
                }
            }
        }
        out.sort_by_key(|r| std::cmp::Reverse(r.created_at));
        Ok(out)
    }

    /// Drafts that wait for the person, newest first.
    pub fn drafts(&self) -> CoreResult<Vec<Report>> {
        Ok(self
            .list()?
            .into_iter()
            .filter(|r| r.status == ReportStatus::Draft)
            .collect())
    }

    pub fn get(&self, id: &ReportId) -> CoreResult<Report> {
        let bytes = match fs::read(self.path(id)?) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == ErrorKind::NotFound => return Err(not_found(id)),
            Err(e) => return Err(e.into()),
        };
        Ok(serde_json::from_slice(&bytes)?)
    }

    /// The person's own wording, kept before it is sent (hidden again where needed).
    pub fn edit(&self, id: &ReportId, title: &str, body: &str) -> CoreResult<Report> {
        let mut report = self.get(id)?;
        if report.status != ReportStatus::Draft {
            return Err(rejected(
                "REPORT_ALREADY_SENT",
                format!("report {id} was already sent"),
                None,
            ));
        }
        let (title, body, hidden) = clean(title, body)?;
        report.title = title;
        report.body = body;
        report.hidden = hidden;
        self.save(&report)?;
        Ok(report)
    }

    /// The relay filed it (or added it to the same issue).
    pub fn mark_sent(&self, id: &ReportId, issue_url: &str, duplicate: bool) -> CoreResult<Report> {
        let mut report = self.get(id)?;
        report.status = ReportStatus::Sent;
        report.issue_url = Some(issue_url.to_owned());
        report.duplicate = duplicate;
        report.sent_at = Some(OffsetDateTime::now_utc());
        self.save(&report)?;
        Ok(report)
    }

    /// 送らない: the draft is gone, and nothing was sent.
    pub fn discard(&self, id: &ReportId) -> CoreResult<()> {
        match fs::remove_file(self.path(id)?) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}

fn not_found(id: &ReportId) -> CoreError {
    rejected(
        "REPORT_NOT_FOUND",
        format!("report {id} does not exist"),
        None,
    )
}

/// What [`redact`] hides, in order, with what it puts in its place.
static HIDE: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    let rules: [(&str, &str); 6] = [
        // SpellSheet's own pages stay: they point at the docs a report is about.
        // Only URL characters: what follows a link without a space (`,a@b.jp`)
        // still goes through the rules below.
        (
            r"(?i)\bhttps?://(?:github\.com/spellsheet/|spellsheet\.github\.io/)[a-z0-9\-._~/%?#=&+]*",
            "$0",
        ),
        (r"(?i)\b(?:https?|ftp|file)://[^\s)>\]」』]+", "[URL]"),
        (
            r"(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}",
            "[メールアドレス]",
        ),
        // 03-1234-5678, 090-1234-5678, +81 90 1234 5678, 0312345678
        (
            r"(?:\+\d{1,3}[\s\-]?)?\(?0?\d{1,4}\)?[\s\-]\d{1,4}[\s\-]\d{3,4}\b|\b0\d{9,10}\b",
            "[電話番号]",
        ),
        (r"\\\\[^\\\s]+\\[^\\\s]+", r"\\[共有フォルダー]"),
        (r"(?i)\b([a-z]:\\Users\\)[^\\\s]+", r"${1}[ユーザー名]"),
    ];
    rules
        .into_iter()
        .filter_map(|(pattern, with)| match Regex::new(pattern) {
            Ok(re) => Some((re, with)),
            Err(e) => {
                tracing::error!(error = %e, pattern, "bad redaction pattern");
                None
            }
        })
        .collect()
});

/// Hides mail addresses, phone numbers, addresses of sites (other than
/// SpellSheet's own pages), shared folders and the Windows user name in
/// paths. Returns the text and how many places were hidden.
pub fn redact(text: &str) -> (String, usize) {
    // SpellSheet's own links are set aside first so the URL rule leaves them.
    let mut kept: Vec<String> = Vec::new();
    let mut out = text.to_owned();
    let mut hidden = 0;
    for (i, (re, with)) in HIDE.iter().enumerate() {
        if i == 0 {
            let source = out.clone();
            out = re
                .replace_all(&source, |c: &regex::Captures<'_>| {
                    let whole = c.get(0).map_or(0..0, |m| m.range());
                    // A link glued to an address (`…/a@b.jp`) is not kept whole.
                    if source[whole.end..].starts_with('@') {
                        return c[0].to_owned();
                    }
                    kept.push(c[0].to_owned());
                    format!("\u{0}{}\u{0}", kept.len() - 1)
                })
                .into_owned();
            continue;
        }
        let mut n = 0;
        out = re
            .replace_all(&out, |c: &regex::Captures<'_>| {
                n += 1;
                let mut s = String::new();
                c.expand(with, &mut s);
                s
            })
            .into_owned();
        hidden += n;
    }
    for (i, link) in kept.iter().enumerate() {
        out = out.replace(&format!("\u{0}{i}\u{0}"), link);
    }
    (out, hidden)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    fn new(title: &str, body: &str) -> NewReport {
        NewReport {
            kind: ReportKind::MissingNode,
            title: title.into(),
            body: body.into(),
            step_type: Some("excel.readRows".into()),
        }
    }

    #[test]
    fn hides_what_identifies_people_and_places() {
        let (text, n) = redact(
            "taro.yamada@example.co.jp に 03-1234-5678 で連絡。https://kintai.example.co.jp/login?id=7 を開き、\
             C:\\Users\\yamada\\Desktop\\a.xlsx と \\\\fs01\\経理\\受注.xlsx を読む。090-1234-5678",
        );
        assert_eq!(
            text,
            "[メールアドレス] に [電話番号] で連絡。[URL] を開き、\
             C:\\Users\\[ユーザー名]\\Desktop\\a.xlsx と \\\\[共有フォルダー]\\受注.xlsx を読む。[電話番号]"
        );
        assert_eq!(n, 6);
    }

    #[test]
    fn keeps_spellsheet_links_step_types_and_numbers() {
        let input = "https://github.com/spellsheet/spellsheet/blob/main/docs/office.md の excel.readRows で 3 行目、2026-11-20、1,234 円、v0.1.34";
        assert_eq!(redact(input), (input.to_owned(), 0));
    }

    #[test]
    fn text_right_after_a_kept_link_is_still_hidden() {
        let (text, n) = redact(
            "[docs](https://github.com/spellsheet/spellsheet),taro@example.com と https://spellsheet.github.io/a@b.jp",
        );
        assert_eq!(
            text,
            "[docs](https://github.com/spellsheet/spellsheet),[メールアドレス] と [URL]"
        );
        assert_eq!(n, 2);
    }

    #[test]
    fn a_draft_waits_until_sent_or_discarded() {
        let dir = tempfile::tempdir().unwrap();
        let store = ReportStore::new(dir.path());
        let a = store
            .draft(new("表を並べ替えるノードがない", "連絡先 a@b.jp"))
            .unwrap();
        assert_eq!(a.body, "連絡先 [メールアドレス]");
        assert_eq!(a.hidden, 1);
        assert_eq!(store.drafts().unwrap().len(), 1);

        // The same title again replaces the waiting draft.
        let again = store
            .draft(new("表を並べ替えるノードがない", "詳しく"))
            .unwrap();
        assert_eq!(again.id, a.id);
        assert_eq!(store.drafts().unwrap().len(), 1);

        let edited = store.edit(&a.id, " 並べ替え ", "直した").unwrap();
        assert_eq!(edited.title, "並べ替え");
        let sent = store
            .mark_sent(
                &a.id,
                "https://github.com/spellsheet/spellsheet/issues/1",
                false,
            )
            .unwrap();
        assert_eq!(sent.status, ReportStatus::Sent);
        assert!(store.drafts().unwrap().is_empty());
        assert_eq!(store.list().unwrap().len(), 1);
        assert!(store.edit(&a.id, "x", "y").is_err());

        let b = store.draft(new("別の件", "本文")).unwrap();
        store.discard(&b.id).unwrap();
        assert!(store.get(&b.id).is_err());
    }

    #[test]
    fn empty_or_long_reports_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let store = ReportStore::new(dir.path());
        assert!(store.draft(new(" ", "本文")).is_err());
        assert!(store.draft(new("件名", "")).is_err());
        assert!(
            store
                .draft(new("件名", &"あ".repeat(MAX_BODY_CHARS + 1)))
                .is_err()
        );
    }

    #[test]
    fn too_many_drafts_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let store = ReportStore::new(dir.path());
        for i in 0..MAX_DRAFTS {
            store.draft(new(&format!("件 {i}"), "本文")).unwrap();
        }
        let err = store.draft(new("もう一件", "本文")).unwrap_err();
        assert_eq!(err.code(), "TOO_MANY_REPORTS");
        // Rewording one that waits still works.
        store.draft(new("件 0", "書き直し")).unwrap();
    }

    #[test]
    fn path_like_ids_are_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let store = ReportStore::new(dir.path());
        assert!(store.get(&ReportId::new("../x")).is_err());
    }
}
