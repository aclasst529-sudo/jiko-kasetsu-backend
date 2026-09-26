const THRESHOLD = 0.6;
const ALLOWED_ORIGIN = "*";

function cors(resp) {
  resp.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  resp.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return resp;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/submit") {
        const b = await request.json();
        if (!b.session_id || !b.type_code || !b.scores) {
          return cors(new Response(JSON.stringify({ error: "invalid body" }), { status: 400 }));
        }
        const s = b.scores;
        await env.DB.prepare(
          `INSERT INTO responses
           (session_id, type_code, axis_a, axis_b, axis_c, axis_d,
            raw_a0, raw_a1, raw_b0, raw_b1, raw_c0, raw_c1, raw_c2, raw_d0, raw_d1)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          b.session_id, b.type_code, b.axis_bin.A, b.axis_bin.B, b.axis_bin.C, b.axis_bin.D,
          s.A[0], s.A[1], s.B[0], s.B[1], s.C[0], s.C[1], s.C[2], s.D[0], s.D[1]
        ).run();
        return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      if (request.method === "POST" && url.pathname === "/feedback") {
        const b = await request.json();
        if (!b.session_id || !b.axis || typeof b.accurate !== "number") {
          return cors(new Response(JSON.stringify({ error: "invalid body" }), { status: 400 }));
        }
        await env.DB.prepare(
          `INSERT INTO feedback (session_id, axis, accurate) VALUES (?,?,?)`
        ).bind(b.session_id, b.axis, b.accurate).run();
        return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      return cors(new Response("not found", { status: 404 }));
    } catch (e) {
      return cors(new Response(JSON.stringify({ error: String(e) }), { status: 500 }));
    }
  },
  async scheduled(event, env) {
    const period = new Date().toISOString().slice(0, 7);
    const rows = await env.DB.prepare(
      `SELECT axis, SUM(accurate) as accurate_count, COUNT(*) as total_count
       FROM feedback WHERE created_at >= datetime('now', '-30 days') GROUP BY axis`
    ).all();
    for (const r of rows.results) {
      const rate = r.total_count > 0 ? r.accurate_count / r.total_count : 1;
      if (rate < THRESHOLD && r.total_count >= 20) {
        await env.DB.prepare(
          `INSERT INTO review_queue (axis, period, accurate_count, total_count, accuracy_rate)
           VALUES (?,?,?,?,?)`
        ).bind(r.axis, period, r.accurate_count, r.total_count, rate).run();
      }
    }
  },
};
