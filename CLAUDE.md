# etzhayyim-project-dogaka — dogaka.etzhayyim.com

**Cinematic / 3D video creation appview** — sister project to `mangaka` (manga = still panels) and `animeka` (anime = cel timeline). dogaka = 動画 (dōga), the **3D / live-action cinematic** stage. Atom = `shot` (cinematic shot with camera, lights, characters, FX); the canonical internal representation is **USD scene graph**, and renders go through the 8-stage **kami-cine** pipeline (WIT `etzhayyim:kami-cine@1.0.0`).

## Architecture

| 項目 | 値 |
|---|---|
| Domain | `dogaka.etzhayyim.com` |
| Runtime | **Single Worker** (TS Native, edge proxy only per ADR-2605111200) |
| nanoid | `d0g4k4x1` |
| performerType | `service` (default sensitivity: `public`) |
| uiType | `appview` (KAMI Engine viewport + USD inspector + timeline) |
| Pipeline | `etzhayyim:kami-cine@1.0.0` (8-stage neural cinematic) — see `40-engine/kami-engine/wit/cine/package.wit` |

## Multi-DID Architecture `[DESIGN]`

| DID | 用途 |
|---|---|
| `did:web:dogaka.etzhayyim.com` | Controller (app 本体) |
| `did:web:dogaka.etzhayyim.com:project:{nanoid}` | Project (作品) |
| `did:web:dogaka.etzhayyim.com:sequence:{nanoid}` | Sequence (シーン/段) |
| `did:web:dogaka.etzhayyim.com:shot:{nanoid}` | Shot (ショット — atom) |
| `did:web:dogaka.etzhayyim.com:asset:{nanoid}` | Asset (character / set / prop / lookdev) |
| `did:web:dogaka.etzhayyim.com:actor:worldArchitect` | World model AI (stage 1) |
| `did:web:dogaka.etzhayyim.com:actor:usdRigger` | USD scene assembly AI (stage 2) |
| `did:web:dogaka.etzhayyim.com:actor:geomReconstructor` | Neural geometry AI (stage 3) |
| `did:web:dogaka.etzhayyim.com:actor:temporalSolver` | 4D temporal field AI (stage 4) |
| `did:web:dogaka.etzhayyim.com:actor:neuralRenderer` | Neural rasterizer AI (stage 5) |
| `did:web:dogaka.etzhayyim.com:actor:cinematicRefiner` | Diffusion refinement AI (stage 6) |
| `did:web:dogaka.etzhayyim.com:actor:compositor` | EXR compositing AI (stage 7) |
| `did:web:dogaka.etzhayyim.com:actor:finalizer` | Encode AI (stage 8) |
| `did:web:dogaka.etzhayyim.com:actor:director` | Shot direction / camera planning AI |
| `did:web:dogaka.etzhayyim.com:actor:dop` | Cinematography / lighting AI |
| `did:web:dogaka.etzhayyim.com:actor:soundDesigner` | Audio AI |

8 pipeline actor DIDs + 3 creative actor DIDs are registered at boot via `ensureActorDids(sdk)`. Stage records (`com.etzhayyim.apps.cine.*`) carry `producerDid` = the actor that ran that stage.

## Design E 3-Tier Write

| Tier | 用途 | 関数 | Collection NSID |
|---|---|---|---|
| **1 Social** | 作品/ショット公開、PV、最終納品告知 | `AppBskyFeedPost(did, text, {embed.video.mediaCid})` | `app.bsky.feed.post` |
| **2 Domain** | project / sequence / shot / pipeline stage records | XRPC → bpmn-dispatcher → LangServer pod (ADR-2605111200) | `com.etzhayyim.apps.dogaka.*` + `com.etzhayyim.apps.cine.*` |
| **3 State** | viewer 設定 / pen prefs / queue priorities / PII | `Preferences()` | server-side |

PII (スタッフ本名 / 連絡先 / 契約金額) と人事評価コメントは Tier 3。撮影現場 NDA データは `signal:v1:` field encrypt。

## Domain Record Types (Tier 2, camelCase)

App-local (`com.etzhayyim.apps.dogaka.*`):

| Kind | NSID | 内容 |
|---|---|---|
| `project` | `com.etzhayyim.apps.dogaka.project` | 作品 (title, genre, targetRuntime, coverCid) |
| `sequence` | `com.etzhayyim.apps.dogaka.sequence` | シーケンス (projectRef, sequenceNum, title) |
| `shot` | `com.etzhayyim.apps.dogaka.shot` | ショット (sequenceRef, shotNum, durationMs, lensMm, framing) |
| `asset` | `com.etzhayyim.apps.dogaka.asset` | character / set / prop / lookdev (usdCid, kind) |
| `cameraPath` | `com.etzhayyim.apps.dogaka.cameraPath` | カメラパス (shotRef, usdCid, frameStart, frameEnd) |
| `take` | `com.etzhayyim.apps.dogaka.take` | shot のレンダリング試行 (shotRef, pipelineRunId, takeNum) |
| `chatMessage` | `com.etzhayyim.apps.dogaka.chatMessage` | プロジェクト内 LLM 対話 |

Shared pipeline ledger (`com.etzhayyim.apps.cine.*`) — see `00-contracts/lexicons/com/etzhayyim/apps/cine/`:

| Stage | NSID | 役割 |
|---|---|---|
| 1 World Model | `com.etzhayyim.apps.cine.worldModel` | Prompt + style + ref → latent world |
| 2 USD Scene | `com.etzhayyim.apps.cine.usdScene` | Pixar USD (usda + usdc) — canonical scene |
| 3 Neural Geometry | `com.etzhayyim.apps.cine.neuralGeom` | 3DGS / NeRF / SDF / mesh / hybrid |
| 4 Temporal Field | `com.etzhayyim.apps.cine.temporalField` | 4D Gaussian / dynamic NeRF / neural flow |
| 5 Neural Render | `com.etzhayyim.apps.cine.neuralRender` | Multi-AOV EXR rasterization |
| 6 Diffusion Pass | `com.etzhayyim.apps.cine.diffusionPass` | img2img / video-diffusion refine |
| 7 EXR Sequence | `com.etzhayyim.apps.cine.exrSeq` | Composited multi-channel EXR |
| 8 Encode | `com.etzhayyim.apps.cine.encode` | Final mp4 / mov / mkv |

Stage records use a shared `pipelineRunId` (TID) to group the 8 artifacts of one take. `subjectKind = "dogaka.shot"` and `subjectRef = strongRef(shot)`.

## Pipeline Execution `[DESIGN]`

```
Browser (KAMI viewport)
  → XRPC POST /xrpc/com.etzhayyim.apps.dogaka.renderShot {shotId, lookdev, takeOpts}
    → dogaka edge worker (src/app.ts) — proxy only (ADR-2605111200)
      → dispatcher.etzhayyim.com → bpmn-dispatcher → AgentGateway MCP
        → K8s LangServer pod (kami-cine pipeline)
          ├ stage 1  worldModel.generate(...)      → record + CID
          ├ stage 2  usdScene.compose(...)         → record + CID
          ├ stage 3  neuralGeom.reconstruct(...)   → record + CID
          ├ stage 4  temporalField.evolve(...)     → record + CID
          ├ stage 5  neuralRender.rasterize(...)   → EXR seq + CID
          ├ stage 6  diffusionPass.refine(...)     → refined seq + CID
          ├ stage 7  exrSeq.composite(...)         → composited EXR + CID
          └ stage 8  encode.finalize(...)          → mediaCid (mp4)
          (each stage INSERT INTO graphar.vertex_dogaka_cine_<stage> from pod)
  → derive: AppBskyFeedPost(shot.did, "Shot 042 take 3 finalized", {embed.video.mediaCid})
```

Heavy compute (geom reconstruction, diffusion) is **pod-side only** — CF Worker is edge proxy per ADR-2605111200; it never holds `env.HYPERDRIVE`.

## Reactive Pipeline (subscribeRepos)

`kotodama.jsonld` `triggers.subscribeRepos.collections` lists both the app-local atoms and the shared `com.etzhayyim.apps.cine.*` stages so the dogaka worker can observe upstream stage completion and forward-fire the next stage's job.

## Read Path (KAMI viewport)

- Shot list / asset library / take history: XRPC query → pod SELECT
- Per-stage artifact preview (USD inspector, splat viewer, EXR thumbnail, video player): client fetches `https://cdn.etzhayyim.com/blob/<cid>` directly
- Live cooperative editing: convo-based (`chat.bsky.convo.*`) project room

## KAMI Engine Integration

| 機能 | KAMI Component | 用途 |
|---|---|---|
| Viewport | `kami-render` wgpu PBR + `kami-scene-graph` | USD prim viewport, real-time preview |
| USD parser | `kami-cine-usd` (planned crate) | usda/usdc → KAMI scene |
| 3DGS preview | `kami-engine-sdk` `gsplat/*` | live splat viewer |
| Camera path | `kami-app` `CameraMode` | director camera + dolly / crane / handheld templates |
| Stage dispatcher | XRPC → bpmn-dispatcher | per-stage job submission |

Future Rust crates (deferred — not in this pass): `kami-cine-world-model`, `kami-cine-usd`, `kami-cine-neural-geom`, `kami-cine-temporal-field`, `kami-cine-neural-render`, `kami-cine-diffusion-pass`, `kami-cine-exr`, `kami-cine-encode`. See WIT contract for trait shapes.

## Build & Deploy

```bash
cd 60-apps/etzhayyim-project-dogaka/appview/etzhayyim-wasm-dogaka-d0g4k4x1
etzhayyim build
etzhayyim deploy --smoke-url https://d0g4k4x1.etzhayyim.com/health
```
