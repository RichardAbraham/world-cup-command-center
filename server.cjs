const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 4173;
const HOST = "127.0.0.1";
const SOURCES = {
  matches: "https://api.openligadb.de/getmatchdata/wm2026/2026",
  standings: "https://api.openligadb.de/getbltable/wm2026/2026"
};
const cache = new Map();

async function getLiveData(kind) {
  const cached = cache.get(kind);
  try {
    const response = await fetch(SOURCES[kind], {
      headers: { Accept: "application/json", "User-Agent": "WorldCupBroadcastCommandCenter/1.0" },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Feed returned ${response.status}`);
    const data = await response.json();
    const result = { data, updatedAt: new Date().toISOString(), cached: false };
    cache.set(kind, result);
    return result;
  } catch (error) {
    if (cached) return { ...cached, cached: true, warning: error.message };
    throw error;
  }
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function file(response, filename, contentType) {
  fs.readFile(path.join(__dirname, filename), (error, contents) => {
    if (error) return json(response, 404, { error: "Not found" });
    response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    response.end(contents);
  });
}

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/matches" || url.pathname === "/api/standings") {
    const kind = url.pathname.slice(5);
    try {
      return json(response, 200, await getLiveData(kind));
    } catch (error) {
      return json(response, 502, { error: `Unable to reach the live ${kind} feed`, detail: error.message });
    }
  }
  if (url.pathname === "/" || url.pathname === "/index.html") return file(response, "index.html", "text/html; charset=utf-8");
  return json(response, 404, { error: "Not found" });
}).listen(PORT, HOST, () => console.log(`Broadcast Command Center running at http://${HOST}:${PORT}`));
