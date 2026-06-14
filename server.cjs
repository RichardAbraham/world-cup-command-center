const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 4173;
const HOST = "0.0.0.0";
const SOURCES = {
  matches: "https://api.openligadb.de/getmatchdata/wm2026/2026",
  standings: "https://api.openligadb.de/getbltable/wm2026/2026",
  liveScores: "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
};
const cache = new Map();

function easternDateKey(date, offset = 0) {
  const eastern = new Date(new Date(date).toLocaleString("en-US", { timeZone: "America/Toronto" }));
  eastern.setDate(eastern.getDate() + offset);
  return `${eastern.getFullYear()}${String(eastern.getMonth() + 1).padStart(2, "0")}${String(eastern.getDate()).padStart(2, "0")}`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "WorldCupBroadcastCommandCenter/1.0" },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Feed returned ${response.status}`);
  return response.json();
}

function mergeLiveScores(matches, scoreboard) {
  const aliases = { NLD: "NED", KAT: "QAT", SAR: "KSA", BHG: "BIH" };
  const normalizeCode = code => aliases[String(code).toUpperCase()] || String(code).toUpperCase();
  const liveByTeams = new Map();
  for (const event of scoreboard.events || []) {
    const competitors = event.competitions?.[0]?.competitors || [];
    const home = competitors.find(team => team.homeAway === "home");
    const away = competitors.find(team => team.homeAway === "away");
    if (!home || !away) continue;
    liveByTeams.set(`${normalizeCode(home.team.abbreviation)}-${normalizeCode(away.team.abbreviation)}`, {
      homeScore: Number(home.score),
      awayScore: Number(away.score),
      status: event.status?.type
    });
  }
  return matches.map(match => {
    const key = `${normalizeCode(match.team1?.shortName)}-${normalizeCode(match.team2?.shortName)}`;
    const live = liveByTeams.get(key);
    if (!live || live.status?.state === "pre") return match;
    return {
      ...match,
      status: live.status?.state === "post" ? "completed" : "live",
      matchIsFinished: Boolean(live.status?.completed),
      matchResults: [{
        resultName: live.status?.description || "Current score",
        pointsTeam1: live.homeScore,
        pointsTeam2: live.awayScore,
        resultOrderID: 99
      }]
    };
  });
}

async function getLiveData(kind) {
  const cached = cache.get(kind);
  try {
    let data = await fetchJson(SOURCES[kind]);
    if (kind === "matches") {
      const dates = `${easternDateKey(new Date(), -1)}-${easternDateKey(new Date(), 1)}`;
      const scoreboard = await fetchJson(`${SOURCES.liveScores}?dates=${dates}`);
      data = mergeLiveScores(data, scoreboard);
    }
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
}).listen(PORT, HOST, () => console.log(`Broadcast Command Center running on port ${PORT}`));
