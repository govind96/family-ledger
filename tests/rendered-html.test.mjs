import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/", environment = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
      DB: undefined,
      ...environment,
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders a safe local preview without real account data", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Family Ledger/);
  assert.match(html, /Family portfolio/);
  assert.match(html, /Total portfolio value/);
  assert.match(html, /Portfolio holdings/);
  assert.match(html, /Top positions/);
  assert.match(html, /View HDFC Bank Limited details/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Largest value/);
  assert.doesNotMatch(html, /holding-drawer|drawer-backdrop/);
  assert.doesNotMatch(html, /Family allocation|One view across every owner/);
  assert.doesNotMatch(
    html,
    /Latest trusted snapshot|Family coverage|Every holding, one calm view/,
  );
  assert.match(html, /Demo data/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
  assert.doesNotMatch(html, /password|one[- ]time password/i);
});

test("sets defensive headers on dashboard responses", async () => {
  const response = await render();
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("permits only a validated loopback price helper in secure local mode", async () => {
  const response = await render("/", {
    LOCAL_SECURE_MODE: "1",
    LOCAL_PRICE_FEED_URL:
      "http://127.0.0.1:45678/local-price-feed/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/snapshot",
  });
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /connect-src 'self' http:\/\/127\.0\.0\.1:45678/,
  );

  const unsafe = await render("/", {
    LOCAL_SECURE_MODE: "1",
    LOCAL_PRICE_FEED_URL: "https://market-data.example/prices",
  });
  assert.doesNotMatch(
    unsafe.headers.get("content-security-policy") ?? "",
    /market-data\.example/,
  );
});

test("secure loopback mode never falls back to demo or hosted sign-in", async () => {
  const response = await render("/", {
    LOCAL_SECURE_MODE: "1",
  });
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Local data unavailable/);
  assert.doesNotMatch(html, /Safe preview using synthetic holdings/);
  assert.doesNotMatch(html, /Sign in securely/);
});
