//! Reports to SpellSheet's developers in Writer: the drafts AI clients left
//! (MCP `report_to_developers`), which the person reads, corrects and sends
//! or throws away. Sending goes through the relay server
//! (`services/report-relay`), which holds the GitHub key; this app holds
//! none (docs/design/reports.md).

use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use spellsheet_core::{ErrorPayload, Report, ReportId, ReportStore};
use tauri::State;

use crate::AppState;

type CmdResult<T> = Result<T, ErrorPayload>;

/// The relay's address. Set when the app is built (`SPELLSHEET_REPORT_URL`
/// in the release workflow); the same variable at run time wins, for
/// trying a relay of one's own.
fn relay_url() -> Option<String> {
    std::env::var("SPELLSHEET_REPORT_URL")
        .ok()
        .or_else(|| option_env!("SPELLSHEET_REPORT_URL").map(str::to_owned))
        .map(|s| s.trim().to_owned())
        .filter(|s| s.starts_with("https://"))
}

fn err(code: &str, message: impl Into<String>) -> ErrorPayload {
    ErrorPayload {
        code: code.to_owned(),
        message: message.into(),
        details: None,
    }
}

fn store(state: &AppState) -> ReportStore {
    ReportStore::new(state.service.store().local_root())
}

fn client() -> Option<&'static reqwest::Client> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
            reqwest::Client::builder()
                .user_agent(concat!("SpellSheet/", env!("CARGO_PKG_VERSION")))
                .timeout(Duration::from_secs(20))
                .build()
                .map_err(|e| tracing::warn!(error = %e, "no HTTP client for reports"))
                .ok()
        })
        .as_ref()
}

/// What Writer needs to show the reports.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reports {
    /// Drafts first (newest first), then sent ones.
    pub reports: Vec<Report>,
    /// Whether this build knows where to send them.
    pub can_send: bool,
}

#[tauri::command]
pub fn list_reports(state: State<'_, AppState>) -> CmdResult<Reports> {
    let mut reports = store(&state).list()?;
    reports.sort_by_key(|r| r.status != spellsheet_core::ReportStatus::Draft);
    Ok(Reports {
        reports,
        can_send: relay_url().is_some(),
    })
}

/// 送らない: the draft is removed; nothing leaves the PC.
#[tauri::command]
pub fn discard_report(state: State<'_, AppState>, id: ReportId) -> CmdResult<()> {
    Ok(store(&state).discard(&id)?)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Outgoing<'a> {
    kind: spellsheet_core::ReportKind,
    title: &'a str,
    body: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    step_type: Option<&'a str>,
    app_version: &'static str,
    os: String,
}

#[derive(Debug, Deserialize)]
struct Filed {
    url: String,
    #[serde(default)]
    duplicate: bool,
}

#[derive(Debug, Deserialize)]
struct Refused {
    error: RefusedError,
}

#[derive(Debug, Deserialize)]
struct RefusedError {
    code: String,
    message: String,
}

fn os() -> String {
    let name = match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        other => other,
    };
    format!("{name} {}", std::env::consts::ARCH)
}

/// 送る: keeps the person's wording, sends exactly that to the relay and
/// records the issue it became. Only what the person saw goes: the title,
/// the body, the node type, the app's version and the OS.
#[tauri::command]
pub async fn send_report(
    state: State<'_, AppState>,
    id: ReportId,
    title: String,
    body: String,
) -> CmdResult<Report> {
    let store = store(&state);
    let report = store.edit(&id, &title, &body)?;
    let url = relay_url().ok_or_else(|| {
        err(
            "REPORT_NOT_CONFIGURED",
            "this build does not know where to send reports",
        )
    })?;
    let client = client().ok_or_else(|| err("REPORT_FAILED", "no HTTP client"))?;
    let outgoing = Outgoing {
        kind: report.kind,
        title: &report.title,
        body: &report.body,
        step_type: report.step_type.as_deref(),
        app_version: env!("CARGO_PKG_VERSION"),
        os: os(),
    };
    let res = client
        .post(&url)
        .json(&outgoing)
        .send()
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "report not sent");
            err("REPORT_OFFLINE", "could not reach the report server")
        })?;
    let status = res.status();
    let bytes = res
        .bytes()
        .await
        .map_err(|_| err("REPORT_OFFLINE", "the report server stopped answering"))?;
    if !status.is_success() {
        let refused = serde_json::from_slice::<Refused>(&bytes).ok();
        return Err(match refused {
            Some(r) if r.error.code == "TOO_MANY_REPORTS" => {
                err("REPORT_TOO_MANY", r.error.message)
            }
            Some(r) => err(
                "REPORT_FAILED",
                format!("{}: {}", r.error.code, r.error.message),
            ),
            None => err(
                "REPORT_FAILED",
                format!("the report server answered {status}"),
            ),
        });
    }
    let filed: Filed = serde_json::from_slice(&bytes)
        .map_err(|_| err("REPORT_FAILED", "the report server answered something else"))?;
    if !filed.url.starts_with("https://github.com/") {
        return Err(err(
            "REPORT_FAILED",
            "the report server answered something else",
        ));
    }
    Ok(store.mark_sent(&id, &filed.url, filed.duplicate)?)
}

/// Where SpellSheet's issues are filed by hand.
const NEW_ISSUE_URL: &str = "https://github.com/spellsheet/spellsheet/issues/new";

/// Opens the issue a sent report became; for a draft (when this build has
/// no relay, or the person prefers), GitHub's own form with the person's
/// wording filled in, to send under their own GitHub account.
#[tauri::command]
pub fn open_report(
    state: State<'_, AppState>,
    id: ReportId,
    title: Option<String>,
    body: Option<String>,
) -> CmdResult<()> {
    let store = store(&state);
    let report = match (title, body) {
        (Some(title), Some(body)) => store.edit(&id, &title, &body)?,
        _ => store.get(&id)?,
    };
    let url = match &report.issue_url {
        Some(url) if url.starts_with("https://github.com/") => url.clone(),
        Some(_) => return Err(err("INVALID_INPUT", "not a GitHub address")),
        None => {
            let label = match report.kind {
                spellsheet_core::ReportKind::Bug => "bug",
                spellsheet_core::ReportKind::MissingNode => "node-request",
            };
            let mut body = report.body.clone();
            if let Some(step) = &report.step_type {
                body.push_str(&format!("\n\nノード: `{step}`"));
            }
            body.push_str(&format!("\n版: {}", env!("CARGO_PKG_VERSION")));
            reqwest::Url::parse_with_params(
                NEW_ISSUE_URL,
                [
                    ("title", report.title.as_str()),
                    ("body", body.as_str()),
                    ("labels", label),
                ],
            )
            .map_err(|e| err("INVALID_INPUT", e.to_string()))?
            .to_string()
        }
    };
    crate::agent::open_external(&url)
}
