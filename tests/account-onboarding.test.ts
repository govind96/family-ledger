import assert from "node:assert/strict";
import test from "node:test";
import { startAccountOnboardingServer } from "../scripts/lib/account-onboarding-server";

test("serves the account form only through its capability URL on loopback", async () => {
  const server = await startAccountOnboardingServer({
    dashboardUrl: "http://localhost:3000",
  });
  try {
    const response = await fetch(server.url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.match(
      response.headers.get("content-security-policy") ?? "",
      /default-src 'none'/,
    );

    const html = await response.text();
    assert.match(html, /Add a CDSL EASI account/);
    assert.match(html, /name="username"/);
    assert.match(html, /name="password"/);
    assert.match(html, /name="formToken"/);
    assert.match(html, /macOS Keychain/);
    assert.match(
      html,
      /name="ownerLabel"[^>]*spellcheck="false">/,
      "owner label must remain optional",
    );
    assert.match(
      html,
      /name="boidLast4"[^>]*spellcheck="false">/,
      "BO ID suffix must remain optional",
    );
    assert.match(html, /name="username"[^>]*required>/);
    assert.match(html, /name="password"[^>]*required>/);

    const setupUrl = new URL(server.url);
    assert.match(setupUrl.pathname, /^\/local-account-setup\/[\w-]{43}$/);
    const tokenless = await fetch(`${setupUrl.origin}/`);
    assert.equal(tokenless.status, 404);
  } finally {
    await server.close();
  }
});

test("accepts in-app loopback submissions that omit Origin when the form token is valid", async () => {
  const server = await startAccountOnboardingServer();
  try {
    const page = await fetch(server.url);
    const html = await page.text();
    const token = html.match(/name="formToken" value="([A-Za-z0-9_-]{43})"/)?.[1];
    assert.ok(token);

    const response = await fetch(`${server.url}/accounts`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ownerLabel: "Synthetic Owner",
        accountLabel: "Synthetic Account",
        brokerLabel: "Synthetic Broker",
        boidLast4: "0000",
        username: "bad",
        password: "Synthet1c!",
        ownerConsented: "yes",
        formToken: token,
      }),
    });
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /INVALID_FORM_ORIGIN/);
  } finally {
    await server.close();
  }
});

test("rejects cross-origin form submissions before reading credentials", async () => {
  const server = await startAccountOnboardingServer();
  try {
    const response = await fetch(`${server.url}/accounts`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://attacker.example",
      },
      body: new URLSearchParams({
        ownerLabel: "Synthetic Owner",
        accountLabel: "Synthetic Account",
        brokerLabel: "Synthetic Broker",
        boidLast4: "0000",
        username: "synthetic_user",
        password: "synthetic_password",
        ownerConsented: "yes",
      }),
    });
    assert.equal(response.status, 403);
    assert.equal(await response.text(), "INVALID_FORM_ORIGIN");
  } finally {
    await server.close();
  }
});
