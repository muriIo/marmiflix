// Injects realistic Upstash REST round-trip latency in front of the local
// serverless-redis-http proxy (docker-compose.test.yml), so a local load
// test actually exercises the same CAS race window production sees instead
// of the near-zero latency of talking to Redis over loopback.
//
// Usage:
//   node loadtest/slow-redis-proxy.js
//   LATENCY_MS=80 JITTER_MS=60 PORT=8180 UPSTREAM=http://localhost:8079 node loadtest/slow-redis-proxy.js
//
// Then point the app at it instead of the bare srh proxy:
//   UPSTASH_REDIS_REST_URL=http://localhost:8180 UPSTASH_REDIS_REST_TOKEN=local-dev-token npm run start

// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain CommonJS script, run directly via `node`
const http = require("node:http");

const PORT = Number(process.env.PORT || 8180);
const UPSTREAM = process.env.UPSTREAM || "http://localhost:8079";
const LATENCY_MS = Number(process.env.LATENCY_MS || 60);
const JITTER_MS = Number(process.env.JITTER_MS || 40);

const upstreamUrl = new URL(UPSTREAM);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    const delay = LATENCY_MS + Math.random() * JITTER_MS;
    await sleep(delay);

    const proxyReq = http.request(
      {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on("error", (err) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`upstream error: ${err.message}`);
    });
    proxyReq.end(body);
  });
});

server.listen(PORT, () => {
  console.log(
    `slow-redis-proxy listening on :${PORT} -> ${UPSTREAM} (base ${LATENCY_MS}ms + up to ${JITTER_MS}ms jitter per call)`,
  );
});
