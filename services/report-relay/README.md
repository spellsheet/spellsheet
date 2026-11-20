# 報告の中継サーバー（report-relay）

SpellSheet Writer から、利用者が中身を確かめて「送る」を押した報告（不具合・足りないノード）を受け取り、`spellsheet/spellsheet` の GitHub issue にする Cloudflare Worker です。GitHub の鍵はここにだけ置き、アプリには入れません。仕組みと守りは [docs/design/reports.md](../../docs/design/reports.md) にあります。

## 受け取るもの

`POST /reports`、`Content-Type: application/json`

```json
{
  "kind": "missingNode",
  "title": "Excel の表を並べ替えるノードがない",
  "body": "…",
  "stepType": "excel.readRows",
  "appVersion": "0.1.35",
  "os": "Windows x86_64"
}
```

| 返事 | 中身 |
| --- | --- |
| 201 | 新しい issue を作った：`{ "url", "number", "duplicate": false }` |
| 200 | 同じ件名の issue に書き足した：`{ "url", "number", "duplicate": true }` |
| 400 / 413 / 415 | 形が違う、大きすぎる、JSON でない |
| 429 | 回数の制限（`TOO_MANY_REPORTS`） |
| 502 | GitHub が受け付けなかった |
| 503 | 鍵か KV が設定されていない |

## 初めて置くとき

Cloudflare のアカウント（無料のプランで足ります）と、`spellsheet` organization で token を作れる GitHub アカウントが要ります。

1. GitHub で fine-grained personal access token を作る（Settings → Developer settings → Fine-grained tokens）。
   - Resource owner：`spellsheet`
   - Repository access：Only select repositories → `spellsheet/spellsheet`
   - Permissions：Repository permissions の **Issues を Read and write**（ほかは付けない。Metadata の Read は自動で付きます）
   - 期限は 1 年にし、切れる前に作り直す
2. このフォルダーで Cloudflare にログインし、KV を作る。

   ```sh
   cd services/report-relay
   npx wrangler@4 login
   npx wrangler@4 kv namespace create REPORTS
   ```

   出てきた `id` を `wrangler.toml` の `REPLACE_WITH_THE_KV_NAMESPACE_ID` と置き換える。
3. 秘密の設定を入れる（値は聞かれたときに貼る。ファイルには書かない）。

   ```sh
   npx wrangler@4 secret put GITHUB_TOKEN   # 1 の token
   npx wrangler@4 secret put SALT           # 長い乱数。送り元の住所をハッシュにするときに混ぜる
   ```

4. 置く。

   ```sh
   npx wrangler@4 deploy
   ```

   `https://spellsheet-report-relay.<アカウントのサブドメイン>.workers.dev` のような住所が出る。`curl https://…workers.dev/` で `{"ok":true}` が返れば動いています。
5. GitHub のリポジトリの Settings → Secrets and variables → Actions → **Variables** に `SPELLSHEET_REPORT_URL` を作り、値を `https://…workers.dev/reports` にする。次のリリースから Writer に「送る」が出ます（それまでは「GitHub で書く」だけ）。

試すだけなら、Writer を起動するときに環境変数 `SPELLSHEET_REPORT_URL` を付けても送り先を変えられます。

## テスト

```sh
node --test services/report-relay/test/*.test.js
```

GitHub と KV は偽物に置き換えて確かめます（CI の TypeScript の仕事でも走ります）。
