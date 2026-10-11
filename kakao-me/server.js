// 카카오톡 "나와의 채팅"으로 메시지를 보내는 작은 프로그램
// 실행: node server.js  →  브라우저에서 http://localhost:3000 열기
// 필요한 것: Node.js 18 이상 (추가 설치 없음)

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth`;
const DATA_FILE = path.join(__dirname, "config.json"); // 내 컴퓨터에만 저장돼요 (깃허브에 안 올라가요)

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch (e) { return {}; }
}
function save(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

// 카카오가 돌려주는 오류 코드를 쉬운 말로 바꿔요
function explain(err) {
  const s = JSON.stringify(err || {});
  if (s.includes("KOE006") || s.includes("redirect")) return `리다이렉트 URI가 등록되지 않았어요. 카카오 개발자 사이트에 ${REDIRECT_URI} 를 그대로 등록해 주세요.`;
  if (s.includes("KOE010") || s.includes("client_secret") || s.includes("Bad client credentials")) return "클라이언트 시크릿이 필요하거나 틀렸어요. 카카오 개발자 사이트의 클라이언트 시크릿 코드를 3번 칸에 넣어 주세요.";
  if (s.includes("KOE101") || s.includes("KOE004") || s.includes("invalid_client")) return "REST API 키가 틀렸어요. 앱 키 화면의 REST API 키를 다시 복사해 주세요.";
  if (s.includes("KOE003")) return "카카오 로그인이 꺼져 있어요. 카카오 로그인 메뉴에서 '사용함'으로 켜 주세요.";
  if (s.includes("KOE205") || s.includes("-402") || s.includes("insufficient scopes")) return "메시지 보내기 권한이 없어요. 동의항목에서 '카카오톡 메시지 전송'을 켜고, 다시 로그인해 주세요.";
  if (s.includes("not logged in")) return "아직 로그인 전이에요. 3번 '카카오로 로그인'을 먼저 눌러 주세요.";
  if (s.includes("-401") || s.includes("invalid_grant")) return "로그인이 만료됐어요. '카카오로 로그인'을 다시 눌러 주세요.";
  return "카카오에서 오류가 났어요: " + s;
}

async function kakaoToken(params) {
  const cfg = load();
  const body = new URLSearchParams({ client_id: cfg.restKey, ...params });
  if (cfg.secret) body.set("client_secret", cfg.secret);
  const r = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw j;
  cfg.accessToken = j.access_token;
  cfg.expiresAt = Date.now() + (j.expires_in - 60) * 1000;
  if (j.refresh_token) cfg.refreshToken = j.refresh_token;
  save(cfg);
  return cfg.accessToken;
}

async function getToken() {
  const cfg = load();
  if (cfg.accessToken && Date.now() < cfg.expiresAt) return cfg.accessToken;
  if (cfg.refreshToken) return kakaoToken({ grant_type: "refresh_token", refresh_token: cfg.refreshToken });
  throw { msg: "-401 not logged in" };
}

async function sendToMe(text) {
  const token = await getToken();
  const template = { object_type: "text", text, link: {} };
  const r = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.result_code !== 0) throw j;
}

function readBody(req) {
  return new Promise(res => { let d = ""; req.on("data", c => (d += c)); req.on("end", () => { try { res(JSON.parse(d || "{}")); } catch (e) { res({}); } }); });
}
function json(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); }

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(path.join(__dirname, "index.html")));
    }
    if (url.pathname === "/api/status") {
      const c = load();
      return json(res, 200, { hasKey: !!c.restKey, hasSecret: !!c.secret, loggedIn: !!c.refreshToken, redirectUri: REDIRECT_URI });
    }
    if (url.pathname === "/api/config" && req.method === "POST") {
      const b = await readBody(req); const c = load();
      c.restKey = String(b.restKey || "").trim();
      c.secret = String(b.secret || "").trim();
      save(c);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/login") {
      const c = load();
      const q = new URLSearchParams({ client_id: c.restKey || "", redirect_uri: REDIRECT_URI, response_type: "code", scope: "talk_message" });
      res.writeHead(302, { Location: "https://kauth.kakao.com/oauth/authorize?" + q });
      return res.end();
    }
    if (url.pathname === "/oauth") {
      let msg = "로그인 성공! 이제 메시지를 보낼 수 있어요.";
      if (url.searchParams.get("error")) msg = explain({ error: url.searchParams.get("error"), d: url.searchParams.get("error_description") });
      else {
        try { await kakaoToken({ grant_type: "authorization_code", redirect_uri: REDIRECT_URI, code: url.searchParams.get("code") }); }
        catch (e) { msg = explain(e); }
      }
      res.writeHead(302, { Location: "/?msg=" + encodeURIComponent(msg) });
      return res.end();
    }
    if (url.pathname === "/api/send" && req.method === "POST") {
      const b = await readBody(req);
      const text = String(b.text || "").trim();
      if (!text) return json(res, 400, { error: "보낼 내용을 적어 주세요." });
      try { await sendToMe(text.slice(0, 200)); return json(res, 200, { ok: true }); }
      catch (e) { return json(res, 400, { error: explain(e) }); }
    }
    if (url.pathname === "/api/logout" && req.method === "POST") {
      const c = load(); delete c.accessToken; delete c.refreshToken; delete c.expiresAt; save(c);
      return json(res, 200, { ok: true });
    }
    res.writeHead(404); res.end("없는 페이지예요");
  } catch (e) {
    json(res, 500, { error: String(e && e.message || e) });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("  카카오 나에게 보내기 준비 완료!");
  console.log(`  브라우저에서 http://localhost:${PORT} 를 열어 주세요.`);
  console.log("  끄려면 이 창에서 Ctrl + C 를 누르세요.");
  console.log("");
});
