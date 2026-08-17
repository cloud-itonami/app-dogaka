# operator quickstart — app-dogaka

**目的: この repo の Worker を手元で起動して、それが何を返すかを自分の目で見る。**

**先に読む: この repo は committed の状態のままでは build できず、live な配備も存在しない**
（理由は [`../README.md`](../README.md) の「現在地」）。以下は *壊れているものを直す* 手順ではなく、
**edge proxy 単体が健全であることを確かめ、どこが欠けているかを実物で特定する**ための手順。
所要 5 分程度。全ステップを 2026-08-17 に実際に踏んで出力を確認している。

## 0. 前提

```bash
node --version          # 実測: v26.3.0
npx --yes wrangler@4 --version   # 実測: 4.69.0
```

Cloudflare のアカウント認証は要らない —— 以下は `--dry-run` とローカル実行だけで、
**deploy は 1 度もしない**。

```bash
cd appview/etzhayyim-wasm-dogaka-d0g4k4x1
```

## 1. まず「通らないこと」を見る（この repo の欠落の正体）

```bash
npx --yes wrangler@4 deploy --dry-run --outdir /tmp/dogaka-dryrun
```

**期待される失敗**（これが出るのが正しい）:

```
✘ [ERROR] The directory specified by the "assets.directory" field in your
  configuration file does not exist:
  .../appview/etzhayyim-wasm-dogaka-d0g4k4x1/svelte/build
```

`wrangler.jsonc` は SPA の成果物 `./svelte/build` を配ることになっているが、
**svelte のソースも build 成果物も切り出されていない**。欠けているのはここ 1 点で、
Worker のコードではない —— それを次で確かめる。

## 2. プレースホルダを置いて、committed の設定のまま通す

```bash
mkdir -p svelte/build
printf '<!doctype html><title>dogaka placeholder</title>\n' > svelte/build/index.html

npx --yes wrangler@4 deploy --dry-run --outdir /tmp/dogaka-dryrun
echo "exit=$?"     # 実測: exit=0
```

**実測（成功）**:

```
Total Upload: 24.70 KiB / gzip: 6.23 KiB
Your Worker has access to the following bindings:
  env.CACHE_R2 (etzhayyim-cache)                      R2 Bucket
  env.SS_* (1824561668...)                            Secrets Store Secret ×5
  env.PDS_SERVICE / PDS_RPC / MURAKUMO_SERVICE / COMFYUI_SERVICE   Worker
  env.ASSETS                                          Assets
  ... Environment Variable ×13
--dry-run: exiting now.
```

`svelte/build/` は **`.gitignore` 済み**なので、この手順を踏んでも repo は汚れない
（ステップ 5 で確認する）。

> **`wrangler.jsonc` の `alias` 6 件は無視してよい。** `/Users/junkawasaki/etzhayyim/...` という
> 実在しない絶対パスを指しているが、`src/app.ts` は import を 1 つも持たないため build に影響しない。
> **alias 以外を同一にして 1 変数だけ変える対照実験で確かめた** —— 在れば 24.70 KiB、
> 無ければ 24.61 KiB、**どちらも exit 0**。**直す必要はあるが、それは build の blocker ではない。**

出る警告 1 件（`CompiledWasm` の rule に fallthrough が無い）は既知で、無害。

## 3. ローカルで起動する

```bash
npx --yes wrangler@4 dev --local --port 8799 --inspector-port 9799
# → [wrangler:info] Ready on http://localhost:8799
```

service binding（PDS / murakumo / ComfyUI）は `[not connected]` になる ——
**それが正常**。相手はローカルに居ないし、この Worker は起動時にそれらを呼ばない。

> このマシンは並行セッションが多いので、起動時に `EMFILE: too many open files, watch` が
> 出ることがある。**サーバは起動する**（実測でも出たまま `Ready` に到達した）。環境側の
> 事情であって、この repo の欠陥ではない。

## 4. 測った応答（別ターミナルから）

```bash
curl -s -w ' → HTTP %{http_code}\n' http://localhost:8799/health
curl -s -w ' → HTTP %{http_code}\n' http://localhost:8799/nope
curl -s -w ' → HTTP %{http_code}\n' "http://localhost:8799/xrpc/com.example.other.thing"
curl -s -w ' → HTTP %{http_code}\n' -X POST -H 'content-type: application/json' \
     --data 'not-json' "http://localhost:8799/xrpc/com.etzhayyim.apps.dogaka.project"
curl -s -w ' → HTTP %{http_code}\n' "http://localhost:8799/xrpc/com.etzhayyim.apps.dogaka.project?limit=1"
```

| リクエスト | 実測 | 意味 |
|---|---|---|
| `GET /health` | **200** `{"ok":true,"actor":"did:web:dogaka.etzhayyim.com","nanoid":"d0g4k4x1",…,"stages":[8 件]}` | Worker は健全。8 段の NSID を名乗る |
| `GET /_app/meta` | **200**（`/health` と同一の本文） | 別名。同じハンドラ |
| `GET /` | **200** ステップ 2 のプレースホルダ | ASSETS binding は生きている（中身は repo の資産ではない） |
| `GET /nope` | **404** `{"error":"NotFound","message":"dogaka not found"}` | 既定の拒否 |
| `GET /xrpc/com.example.other.thing` | **404** 同上 | **NSID の prefix ガードが効いている** —— `com.etzhayyim.apps.dogaka.` / `.cine.` 以外は中継しない |
| `POST /xrpc/…dogaka.project`（壊れた JSON） | **400** `{"error":"InvalidJson"}` | body の検証は中継前に効く |
| `GET /xrpc/…dogaka.project?limit=1` | **500**（未捕捉の例外 + スタックトレース） | ↓ |

### 最後の 1 行が、この repo の実際の欠陥

`proxyToDispatcher`（`src/app.ts:77`）は `fetch` を **try/catch していない**。dispatcher が
到達不能だと、構造化エラーではなく **未捕捉の例外がそのまま 500 として出る**:

```
Error: internal error; reference = …
    at async proxyToDispatcher (…/src/app.ts:82:16)
```

`dispatcher.etzhayyim.com` は**現在 DNS に存在しない**ので、**この経路のすべての XRPC 呼び出しが
これに当たる**。`/health` は 200 を返し続けるため、**health だけ見ていると健全に見える** ——
実際には中継先が消えていても `/health` は何も知らない（この Worker は dispatcher を probe しない）。

**この pass では直していない**（1 反復 1 軸）。直すなら `proxyToDispatcher` の `fetch` を
try/catch で包み、`502` + 構造化 body を返すのが最小の修正。

## 5. 後片付け

```bash
# dev サーバを Ctrl-C で止めてから
rm -rf svelte /tmp/dogaka-dryrun
git status --porcelain          # 実測: 空（この手順は repo を汚さない）
```

## この手順で分かること／分からないこと

**分かる**: Worker のコードは健全で bundle も起動もする / ルーティングと NSID ガードと JSON 検証は
仕様どおり動く / 欠けているのは SPA 成果物 1 点 / dispatcher 不達時のエラー処理が無い。

**分からない**: 8 段パイプラインの実際の挙動（pod 側で、この repo には無い）/ USD・neural render の
正しさ / 本番の配備先（`README.edn` が指す `gftdcojp/ai-gftd-dogaka` は archived）。
**ここで green を見ても、dogaka が動くことの証拠にはならない** —— 確かめたのは edge proxy 単体である。
