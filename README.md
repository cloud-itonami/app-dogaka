# app-dogaka

**dogaka（動画）の edge appview を、etzhayyim/root から切り出した standalone artifact。**
中身は Cloudflare Worker 1 本 —— XRPC を dispatcher へ中継するだけの **edge proxy** であって、
レンダリングパイプラインそのものではない（8 段の `kami-cine` は K8s の LangServer pod 側で走る）。

姉妹プロジェクト: `mangaka`（静止画のコマ）/ `animeka`（セルのタイムライン）/ **`dogaka`（3D・実写のショット）**。
atom は `shot`、内部表現は USD scene graph。設計の正本は **[`CLAUDE.md`](CLAUDE.md)**（DID 構成・
3-tier write・レコード型・8 段パイプライン）。この README は *設計* ではなく **今この repo に何が在って、
何ができるか**を書く。

## この repo に在るもの（全 7 ファイル）

| パス | 役割 |
|---|---|
| `CLAUDE.md` | 設計の正本。DID 構成、Tier 1–3 の書き込み、`com.etzhayyim.apps.dogaka.*` / `.cine.*` のレコード型、8 段パイプライン |
| `appview/etzhayyim-wasm-dogaka-d0g4k4x1/src/app.ts` | Worker 本体（108 行）。`/health` `/_app/meta` と `/xrpc/*` の中継だけ |
| `appview/.../wrangler.jsonc` | Worker の配備定義（routes / vars / service binding / secrets store） |
| `appview/.../kotodama.jsonld` | actor 記述（`did:web:dogaka.etzhayyim.com`、capabilities、subscribeRepos の購読集合） |
| `README.edn` | 機械可読な repo 同定（`:kind :standalone-app-artifact`、境界宣言） |
| `migration.edn` | 切り出しの出所（`etzhayyim/root` の `60-apps/etzhayyim-project-dogaka`、rev `691c245d`、5 ファイル / 18,546 バイト） |
| `NOTICE` | Apache-2.0 + etzhayyim Charter Compliance Rider v3.1 |

## 現在地（2026-08-17 実測）

**この repo は、そのままでは build も deploy もできない。** 3 点とも実際に確かめた:

1. **SPA が切り出されていない。** `wrangler.jsonc` の `assets.directory` は `./svelte/build` を指すが、
   その svelte ソースも build 成果物も repo に無い（`migration.edn` が申告する抽出対象は 5 ファイル）。
   committed の設定のまま `wrangler deploy --dry-run` を回すと、そこで止まる:

   ```
   ✘ [ERROR] The directory specified by the "assets.directory" field
     in your configuration file does not exist: .../svelte/build
   ```

2. **配備先のホスト名が DNS に無い。** `dogaka.etzhayyim.com` / `d0g4k4x1.etzhayyim.com`（`routes` の
   2 本）も、中継先の `dispatcher.etzhayyim.com` も、blob 配信の `cdn.etzhayyim.com` も **解決しない**。
   ゾーンの頂点 `etzhayyim.com` だけは解決する（Cloudflare）。つまり **live な配備は存在しない**。

3. **`wrangler.jsonc` の `alias` は 1 つも実在しない絶対パスを指している** ——
   `/Users/junkawasaki/etzhayyim/etzhayyim-apps-etzhayyim/...` という特定マシンのホーム配下で、
   このマシンには無い。ただし **build は壊れない**: `src/app.ts` は import を 1 つも持たないので、
   この alias 表（6 件）は**現状 inert** —— alias 以外を同一にして 1 変数だけ変える対照実験で、
   **在っても無くても dry-run は exit 0** だった（bundle は 24.70 KiB / 24.61 KiB）。

**Worker のコード自体は健全で、置き換えれば動く。** `svelte/build` にプレースホルダを 1 枚置くと
committed の設定のまま dry-run が exit 0 で通り、`wrangler dev` はローカルで起動して `/health` が
200 を返す。手順と実測値は **[`docs/operator-quickstart.md`](docs/operator-quickstart.md)**。

## 境界（`README.edn` の宣言と、その実際）

`README.edn` は `:boundary {:role :cinematic-creation-application
:production-service "gftdcojp/ai-gftd-dogaka"}` と宣言している ——
**その production service は現在 archived（GitHub で read-only）かつ private**（実測 2026-08-17、
最終 push 2026-07-19）。この repo が「本番はあちら」と譲っている先は、もう動いていない。
したがって dogaka の実行系がどこで生きるのかは**未決**であり、この repo は当面
「切り出された設計と edge proxy の保管庫」として読むのが正しい。

## 触る前に知っておくべきこと

- **`CLAUDE.md` の "Build & Deploy" にあった `cd 60-apps/etzhayyim-project-dogaka/...` は
  切り出し前のモノレポのパス**で、この repo には存在しない。正しい入口は
  `appview/etzhayyim-wasm-dogaka-d0g4k4x1/`（quickstart 参照）。
- **`/xrpc/*` は dispatcher が到達不能だと 500 を返す**（構造化エラーではなく未捕捉の例外）。
  `dispatcher.etzhayyim.com` が解決しない現状では、**すべての XRPC 呼び出しがこれに当たる**。
  詳細と再現手順は quickstart の「測った応答」節。
- この repo は CI を持たない。ワークスペースの CI/CD は murakumo fleet であって GitHub Actions
  ではない（superproject の ADR-2607300900）。
