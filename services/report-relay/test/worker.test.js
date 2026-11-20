import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, handle, issueBody, neutralize, parseReport } from "../src/worker.js";

class Kv {
  map = new Map();
  async get(key, opts) {
    const v = this.map.get(key);
    if (v === undefined) return null;
    return opts?.type === "json" ? JSON.parse(v) : v;
  }
  async put(key, value) {
    this.map.set(key, value);
  }
}

function setup() {
  const calls = [];
  let next = 1;
  const fetcher = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.authorization });
    if (url.endsWith("/issues")) {
      const number = next++;
      return new Response(JSON.stringify({ number, html_url: `https://github.com/spellsheet/spellsheet/issues/${number}` }), { status: 201 });
    }
    return new Response("{}", { status: 201 });
  };
  const env = { GITHUB_TOKEN: "t", REPO: "spellsheet/spellsheet", REPORTS: new Kv() };
  return { calls, fetcher, env };
}

const report = {
  kind: "missingNode",
  title: "Excel の表を並べ替えるノードがない",
  body: "@someone excel.readRows で読んだ表を並べたい。#12 と同じかも",
  stepType: "excel.readRows",
  appVersion: "0.1.35",
  os: "Windows 11",
};

function post(body, ip = "203.0.113.1", type = "application/json") {
  return new Request("https://relay.example/reports", {
    method: "POST",
    headers: { "content-type": type, "cf-connecting-ip": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("files a report as an issue with fixed labels, without notifying anyone", async () => {
  const { calls, fetcher, env } = setup();
  const res = await handle(post(report), env, fetcher);
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.equal(out.duplicate, false);
  assert.equal(out.url, "https://github.com/spellsheet/spellsheet/issues/1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/spellsheet/spellsheet/issues");
  assert.deepEqual(calls[0].body.labels, ["from-app", "node-request"]);
  assert.equal(calls[0].body.title, report.title);
  assert.ok(calls[0].body.body.includes("@​someone"));
  assert.ok(calls[0].body.body.includes("#​12"));
  assert.ok(calls[0].body.body.includes("| ノード | `excel.readRows` |"));
});

test("a report with the same title joins the earlier issue as a comment", async () => {
  const { calls, fetcher, env } = setup();
  await handle(post(report), env, fetcher);
  const res = await handle(post({ ...report, title: " Excel の表を並べ替える ノードがない ", body: "もう一件" }, "203.0.113.2"), env, fetcher);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.duplicate, true);
  assert.equal(out.number, 1);
  assert.equal(calls[1].url, "https://api.github.com/repos/spellsheet/spellsheet/issues/1/comments");
  assert.ok(calls[1].body.body.includes("> もう一件"));
});

test("one PC may send only a few reports an hour", async () => {
  const { fetcher, env } = setup();
  for (let i = 0; i < LIMITS.perHour; i++) {
    const res = await handle(post({ ...report, title: `件 ${i}` }), env, fetcher);
    assert.equal(res.status, 201);
  }
  const res = await handle(post({ ...report, title: "もう一件" }), env, fetcher);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error.code, "TOO_MANY_REPORTS");
  // Another PC still can.
  assert.equal((await handle(post({ ...report, title: "別の PC" }, "198.51.100.7"), env, fetcher)).status, 201);
});

test("refuses what is not a report", async () => {
  const { calls, fetcher, env } = setup();
  const cases = [
    [post("not json"), 400],
    [post(report, "1.1.1.1", "text/plain"), 415],
    [post({ ...report, kind: "spam" }), 400],
    [post({ ...report, title: "" }), 400],
    [post({ ...report, body: "x".repeat(6001) }), 400],
    [post({ ...report, appVersion: "<script>" }), 400],
    [post({ ...report, stepType: "a b" }), 400],
    [post("x".repeat(40 * 1024)), 413],
    [new Request("https://relay.example/reports"), 405],
    [new Request("https://relay.example/other", { method: "POST" }), 404],
  ];
  for (const [req, status] of cases) {
    assert.equal((await handle(req, env, fetcher)).status, status, req.url);
  }
  assert.equal(calls.length, 0);
});

test("says so when it is not set up, and when GitHub fails", async () => {
  const { fetcher } = setup();
  assert.equal((await handle(post(report), { REPORTS: new Kv() }, fetcher)).status, 503);
  const failing = async () => new Response("no", { status: 500 });
  const res = await handle(post(report), { GITHUB_TOKEN: "t", REPORTS: new Kv() }, failing);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.code, "GITHUB_FAILED");
});

test("text helpers", () => {
  assert.equal(neutralize("mail a@b.jp to @x, see #3 and `@y`"), "mail a@b.jp to @​x, see #​3 and `@y`");
  assert.equal(parseReport({ ...report, title: "a\n b" })[0].title, "a b");
  assert.ok(issueBody({ ...report, os: "Win|11" }).includes("| OS | Win/11 |"));
});
