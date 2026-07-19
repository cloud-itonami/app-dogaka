// dogaka.etzhayyim.com — 3D cinematic edge proxy.
// CF Worker = edge-only per ADR-2605111200. All pipeline execution (8-stage
// kami-cine: world-model -> usd-scene -> neural-geom -> temporal-field ->
// neural-render -> diffusion-pass -> exr-seq -> encode) runs in K8s
// LangServer pods reached via dispatcher.etzhayyim.com -> bpmn-dispatcher ->
// AgentGateway MCP.

interface SecretBinding {
  get(): Promise<string>;
}

interface Env {
  DISPATCHER_URL?: string;
  DISPATCHER_INTERNAL_SECRET?: string | SecretBinding;
  APP_NANOID?: string;
}

interface ExportedHandler<E> {
  fetch(req: Request, env: E): Promise<Response>;
}

const NSID_PREFIX_APP = "com.etzhayyim.apps.dogaka.";
const NSID_PREFIX_CINE = "com.etzhayyim.apps.cine.";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health" || url.pathname === "/_app/meta") {
      return json({
        ok: true,
        actor: "did:web:dogaka.etzhayyim.com",
        nanoid: env.APP_NANOID ?? "d0g4k4x1",
        execution: "edge-proxy+agentgateway-mcp+langserver",
        pipeline: "etzhayyim:kami-cine@1.0.0",
        stages: [
          "com.etzhayyim.apps.cine.worldModel",
          "com.etzhayyim.apps.cine.usdScene",
          "com.etzhayyim.apps.cine.neuralGeom",
          "com.etzhayyim.apps.cine.temporalField",
          "com.etzhayyim.apps.cine.neuralRender",
          "com.etzhayyim.apps.cine.diffusionPass",
          "com.etzhayyim.apps.cine.exrSeq",
          "com.etzhayyim.apps.cine.encode",
        ],
      });
    }

    const nsid = url.pathname.startsWith("/xrpc/") ? url.pathname.slice("/xrpc/".length) : "";
    const isAppNsid = nsid.startsWith(NSID_PREFIX_APP) || nsid.startsWith(NSID_PREFIX_CINE);
    if (isAppNsid && (req.method === "POST" || req.method === "GET")) {
      const body = await bodyWithQuery(req, url);
      if ((body as { __invalidJson?: boolean }).__invalidJson) return json({ error: "InvalidJson" }, 400);
      return proxyToDispatcher(env, nsid, body);
    }

    return json({ error: "NotFound", message: "dogaka not found" }, 404);
  },
} satisfies ExportedHandler<Env>;

async function bodyWithQuery(req: Request, url: URL): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    const text = await req.text();
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { __invalidJson: true };
    }
  }
  url.searchParams.forEach((v, k) => {
    if (!(k in body)) body[k] = v;
  });
  return body;
}

async function proxyToDispatcher(env: Env, nsid: string, body: Record<string, unknown>): Promise<Response> {
  const base = (env.DISPATCHER_URL ?? "https://dispatcher.etzhayyim.com").replace(/\/+$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const trust = await internalTrustSecret(env);
  if (trust) headers["x-internal-trust"] = trust;
  const resp = await fetch(`${base}/xrpc/${nsid}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: {
      "content-type": resp.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

async function internalTrustSecret(env: Env): Promise<string> {
  const binding = env.DISPATCHER_INTERNAL_SECRET;
  if (!binding) return "";
  try {
    return typeof binding === "string" ? binding : await binding.get();
  } catch {
    return "";
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
