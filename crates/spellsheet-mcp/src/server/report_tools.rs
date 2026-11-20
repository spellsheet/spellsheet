//! Reports to SpellSheet's developers: an AI that meets a bug in SpellSheet,
//! or needs a node SpellSheet lacks, writes a draft. The person reads it in
//! Writer and decides whether it goes (spellsheet_core::report).

use spellsheet_core::{NewReport, ReportStore};

use super::*;

const DRAFTED_HINT: &str = "Drafted. Nothing is sent yet: Writer shows the draft to the person, who removes anything they do not want to show and decides whether to send it to SpellSheet's developers, where it becomes a public GitHub issue (if Writer is not open, it waits there). Tell the person in one sentence that you left a report for the developers in Writer, and carry on with the work (work around the problem as you can). Do not ask them to send it and do not wait for it.";

#[tool_router(router = report_tools, vis = "pub(super)")]
impl SpellSheetMcp {
    /// Leave a report for SpellSheet's developers when SpellSheet itself falls short while you
    /// build or fix a flow: `bug` when SpellSheet does something wrong (a step fails though used
    /// as its schema says, a tool answers wrongly, the app misbehaves), `missingNode` when a node
    /// the flow needs does not exist and you had to work around it (several steps, a script, a
    /// person by hand). Not for mistakes in the flow, the data or the person's systems.
    /// Writer shows the draft to the person; it is sent only if they choose to, and then becomes
    /// a public GitHub issue. So write it in general terms that anyone may read: the step types,
    /// error codes and what the flow does in general (「Excel の表を読み、Web のフォームに 1 行ずつ
    /// 入力する」), never the person's business data, file contents, names of people, companies,
    /// customers or internal systems, URLs, paths or screenshots. Write it in the person's
    /// language. One report per problem; do not repeat one you already left.
    #[tool(annotations(
        read_only_hint = false,
        destructive_hint = false,
        open_world_hint = false
    ))]
    async fn report_to_developers(
        &self,
        peer: Peer<RoleServer>,
        Parameters(p): Parameters<ReportParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let outcome = (|| {
            let store = ReportStore::new(self.svc().store().local_root());
            let report = store.draft(NewReport {
                kind: p.kind,
                title: p.title,
                body: p.body,
                step_type: p.step_type,
            })?;
            Ok(json!({
                "status": "drafted",
                "reportId": report.id,
                "hidden": report.hidden,
                "hint": DRAFTED_HINT,
            }))
        })();
        self.finish("report_to_developers", &peer, None, outcome)
    }
}
