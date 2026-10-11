// 쿠팡 베스트 조회기 - 내 컴퓨터에서 실행하는 작은 서버
// 쿠팡 파트너스 API 키를 config.json에 넣고 `node server.js`로 실행한 뒤
// 브라우저에서 http://localhost:3000 을 열면 돼요. (Node.js 18 이상, 추가 설치 없음)

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const HOST = "https://api-gateway.coupang.com";
const BASE = "/v2/providers/affiliate_open_api/apis/openapi/products";

function loadKeys() {
  const file = path.join(__dirname, "config.json");
  if (!fs.existsSync(file)) return null;
  try {
    const { accessKey, secretKey } = JSON.parse(fs.readFileSync(file, "utf8"));
    if (accessKey && secretKey) return { accessKey, secretKey };
  } catch (e) {
    console.error("config.json을 읽지 못했어요:", e.message);
  }
  return null;
}

// 쿠팡 파트너스 서명 방식(HMAC-SHA256)
function authHeader(keys, method, urlPath, query) {
  const datetime = new Date().toISOString().slice(2, 19).replace(/[-:]/g, "") + "Z"; // yyMMddTHHmmssZ
  const message = datetime + method + urlPath + query;
  const signature = crypto.createHmac("sha256", keys.secretKey).update(message).digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${keys.accessKey}, signed-date=${datetime}, signature=${signature}`;
}

async function callCoupang(keys, urlPath, params) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(HOST + urlPath + (query ? "?" + query : ""), {
    headers: { Authorization: authHeader(keys, "GET", urlPath, query) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body.rCode && body.rCode !== "0")) {
    throw new Error(body.rMessage || body.message || `쿠팡 응답 오류 (${res.status})`);
  }
  return body.data;
}

function send(res, status, type, data) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(data);
}
const json = (res, status, obj) => send(res, status, "application/json; charset=utf-8", JSON.stringify(obj));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const keys = loadKeys();
  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const page = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
      const head = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
      return send(res, 200, "text/html; charset=utf-8", head + page);
    }
    if (url.pathname === "/api/health") {
      return json(res, 200, { ok: !!keys });
    }
    if (!keys) {
      return json(res, 400, { error: "API 키가 없어요. config.json에 accessKey와 secretKey를 적어 주세요." });
    }
    if (url.pathname === "/api/best") {
      const category = String(Number(url.searchParams.get("category")) || 1016);
      const data = await callCoupang(keys, `${BASE}/bestcategories/${category}`, { limit: "20", imageSize: "230x230" });
      return json(res, 200, { items: data || [] });
    }
    if (url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return json(res, 400, { error: "검색어를 적어 주세요." });
      const data = await callCoupang(keys, `${BASE}/search`, { keyword: q, limit: "10", imageSize: "230x230" });
      return json(res, 200, { items: (data && data.productData) || [] });
    }
    json(res, 404, { error: "없는 주소예요." });
  } catch (e) {
    json(res, 502, { error: e.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`쿠팡 베스트 조회기: http://localhost:${PORT}`);
  console.log(loadKeys() ? "API 키를 찾았어요. 실시간 데이터로 보여줘요." : "config.json이 없어서 예시 데이터로 보여줘요.");
});
