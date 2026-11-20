// The relay between SpellSheet Writer and GitHub issues (docs/design/reports.md).
//
// Writer sends a report the person read and agreed to send; this worker
// files it as an issue on SpellSheet's repository. The GitHub key lives
// only here (a Cloudflare secret), never in the app: anyone can take a
// key out of a program they downloaded.
//
// Because anyone can call this address, it only ever creates issues and
// comments with fixed labels, limits how many reports one address and the
// whole world may send (counted atomically in a Durable Object), refuses big or malformed ones, adds a report that
// matches a recent one to that issue instead of opening a new one, and
// keeps @mentions and #references in the text from notifying anyone.
//
// Cloudflare settings (wrangler.toml and `wrangler secret put`):
//   GITHUB_TOKEN  secret: fine-grained token, this repository only, Issues: read and write
//   REPO          "spellsheet/spellsheet"
//   SALT          secret, optional: mixed into the hashed address used for the limits
//   REPORTS       KV namespace: recent reports, to join one with the same title
//   LIMITER       Durable Object (class Limiter): the counters for the limits

/** One address may send this many reports per hour and per day; everyone together per day. */
export const LIMITS = { perHour: 5, perDay: 20, allPerDay: 200 };
const MAX_BYTES = 32 * 1024;
const MAX_TITLE = 120;
const MAX_BODY = 6000;
/** A report with the same kind and title within this time joins the earlier issue. */
const SAME_FOR_SECONDS = 90 * 24 * 3600;
/** After this many joined reports an issue gets no more comments (it is clearly known). */
const MAX_COMMENTS = 20;

const KINDS = {
  bug: { label: "bug", name: "不具合" },
  missingNode: { label: "node-request", name: "足りないノード" },
};
const SOURCE_LABEL = "from-app";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function refuse(status, code, message) {
  return json(status, { error: { code, message } });
}

/** Text from outside, made safe to put in an issue: no one is notified, no other issue is linked. */
export function neutralize(text) {
  return String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/<!--|-->/g, "")
    .replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, "$1@​")
    .replace(/(^|[^\w&])#(?=\d)/g, "$1#​");
}

function oneLine(text, max) {
  return String(text).replace(/\s+/g, " ").trim().slice(0, max);
}

/** The report as sent by Writer, checked; `null` and a reason when it is not one. */
export function parseReport(value) {
  if (!value || typeof value !== "object") return [null, "the body is not a JSON object"];
  const { kind, title, body, stepType, appVersion, os } = value;
  if (!Object.hasOwn(KINDS, kind)) return [null, "kind must be bug or missingNode"];
  if (typeof title !== "string" || !title.trim()) return [null, "title is empty"];
  if (title.length > MAX_TITLE) return [null, `title is longer than ${MAX_TITLE} characters`];
  if (typeof body !== "string" || !body.trim()) return [null, "body is empty"];
  if (body.length > MAX_BODY) return [null, `body is longer than ${MAX_BODY} characters`];
  if (stepType !== undefined && (typeof stepType !== "string" || !/^[A-Za-z0-9_.:-]{1,80}$/.test(stepType))) {
    return [null, "stepType is not a node type"];
  }
  if (typeof appVersion !== "string" || !/^\d+\.\d+\.\d+[0-9A-Za-z.+-]{0,30}$/.test(appVersion)) {
    return [null, "appVersion is not a version"];
  }
  if (os !== undefined && (typeof os !== "string" || os.length > 80)) return [null, "os is too long"];
  return [
    {
      kind,
      title: oneLine(title, MAX_TITLE),
      body: body.trim(),
      stepType,
      appVersion,
      os: os ? oneLine(os, 80) : undefined,
    },
    null,
  ];
}

function facts(report) {
  const rows = [
    ["種類", KINDS[report.kind].name],
    ...(report.stepType ? [["ノード", "`" + report.stepType + "`"]] : []),
    ["版", report.appVersion],
    ...(report.os ? [["OS", neutralize(report.os).replace(/\|/g, "/")]] : []),
  ];
  return ["| 項目 | 内容 |", "| --- | --- |", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");
}

export function issueBody(report) {
  return [
    neutralize(report.body),
    "",
    "---",
    "",
    facts(report),
    "",
    "SpellSheet Writer から送られた報告です。AI が下書きし、利用者が中身を確かめて送りました。",
  ].join("\n");
}

export function commentBody(report) {
  return [
    "同じ件名の報告がもう 1 件届きました。",
    "",
    neutralize(report.body)
      .split("\n")
      .map((line) => "> " + line)
      .join("\n"),
    "",
    facts(report),
  ].join("\n");
}

async function sha256(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameKey(report) {
  return sha256(report.kind + "\n" + report.title.toLowerCase().replace(/\s+/g, ""));
}

/**
 * The counters, counted in one place so two reports at the same moment
 * cannot both read "4 of 5" and both pass. One Durable Object ("limits")
 * handles one request at a time: its storage calls hold back the next
 * request until this one has read and written its counts.
 */
export class Limiter {
  constructor(state) {
    this.storage = state.storage;
  }

  /** Counts a report from `who` at `now`; the name of the limit it passes, if any. */
  async take(who, now) {
    const hour = Math.floor(now / 3600_000);
    const day = Math.floor(now / 86400_000);
    const counters = [
      [`${who}:h:${hour}`, LIMITS.perHour, (hour + 1) * 3600_000, "perHour"],
      [`${who}:d:${day}`, LIMITS.perDay, (day + 1) * 86400_000, "perDay"],
      [`all:d:${day}`, LIMITS.allPerDay, (day + 1) * 86400_000, "allPerDay"],
    ];
    const counts = (await this.storage.get("counts")) ?? {};
    for (const [key, entry] of Object.entries(counts)) if (entry.until <= now) delete counts[key];
    const full = counters.find(([key, max]) => (counts[key]?.n ?? 0) >= max);
    if (!full) {
      for (const [key, , until] of counters) counts[key] = { n: (counts[key]?.n ?? 0) + 1, until };
    }
    await this.storage.put("counts", counts);
    return full ? full[3] : null;
  }

  async fetch(request) {
    const { who, now } = await request.json();
    return json(200, { over: await this.take(who, now) });
  }
}

async function overLimit(env, who, now) {
  const limiter = env.LIMITER.get(env.LIMITER.idFromName("limits"));
  const res = await limiter.fetch("https://limiter/take", { method: "POST", body: JSON.stringify({ who, now }) });
  if (!res.ok) throw new Error(`limiter: ${res.status}`);
  return (await res.json()).over;
}

function github(env, fetcher) {
  const repo = env.REPO || "spellsheet/spellsheet";
  return async (method, path, body) => {
    const res = await fetcher(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "user-agent": "spellsheet-report-relay",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status}`);
    return res.json();
  };
}

/** Handles one request. `fetcher` is GitHub's fetch (tests pass their own). */
export async function handle(request, env, fetcher = fetch, now = Date.now()) {
  const url = new URL(request.url);
  if (url.pathname === "/" && request.method === "GET") return json(200, { ok: true });
  if (url.pathname !== "/reports") return refuse(404, "NOT_FOUND", "no such page");
  if (request.method !== "POST") return refuse(405, "METHOD_NOT_ALLOWED", "send reports with POST");
  if (!env.GITHUB_TOKEN || !env.REPORTS || !env.LIMITER) return refuse(503, "NOT_CONFIGURED", "the relay is not set up");
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return refuse(415, "NOT_JSON", "send the report as JSON");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BYTES) return refuse(413, "TOO_LARGE", "the report is too large");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return refuse(400, "INVALID_REPORT", "the body is not JSON");
  }
  const [report, problem] = parseReport(value);
  if (!report) return refuse(400, "INVALID_REPORT", problem);

  const who = await sha256((env.SALT ?? "") + (request.headers.get("cf-connecting-ip") ?? "unknown"));
  const limit = await overLimit(env, who, now);
  if (limit) {
    return refuse(429, "TOO_MANY_REPORTS", limit === "allPerDay" ? "too many reports today; try tomorrow" : "too many reports from this PC; try later");
  }

  const gh = github(env, fetcher);
  const key = `same:${await sameKey(report)}`;
  try {
    const earlier = await env.REPORTS.get(key, { type: "json" });
    if (earlier && earlier.number) {
      if ((earlier.comments ?? 0) < MAX_COMMENTS) {
        await gh("POST", `/issues/${earlier.number}/comments`, { body: commentBody(report) });
        await env.REPORTS.put(key, JSON.stringify({ ...earlier, comments: (earlier.comments ?? 0) + 1 }), {
          expirationTtl: SAME_FOR_SECONDS,
        });
      }
      return json(200, { url: earlier.url, number: earlier.number, duplicate: true });
    }
    const issue = await gh("POST", "/issues", {
      title: report.title,
      body: issueBody(report),
      labels: [SOURCE_LABEL, KINDS[report.kind].label],
    });
    await env.REPORTS.put(key, JSON.stringify({ number: issue.number, url: issue.html_url, comments: 0 }), {
      expirationTtl: SAME_FOR_SECONDS,
    });
    return json(201, { url: issue.html_url, number: issue.number, duplicate: false });
  } catch (e) {
    console.error(String(e));
    return refuse(502, "GITHUB_FAILED", "GitHub did not take the report; try later");
  }
}

export default {
  fetch: (request, env) => handle(request, env),
};
