import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { waitForHoldingTableReady } from "../scripts/lib/cdsl-connector";

test("waits for CDSL's delayed holdings rows to finish rendering", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();

  await page.setContent(`
    <table>
      <thead>
        <tr>
          <th>ISIN</th>
          <th>ISIN Name</th>
          <th>ISIN Listing</th>
          <th>Balance (Numbers)</th>
          <th>Last Closing Price (in INR)</th>
          <th>Current Holding Value (in INR)</th>
        </tr>
      </thead>
      <tbody id="holdings"></tbody>
    </table>
    <script>
      setTimeout(() => {
        document.querySelector("#holdings").innerHTML =
          '<tr><td>INE002A01018</td><td>Example Limited</td><td>Listed</td><td>10</td><td>100</td><td id="value"></td></tr>';
      }, 75);
      setTimeout(() => {
        document.querySelector("#value").textContent = "1000";
      }, 175);
    </script>
  `);

  const startedAt = Date.now();
  const rowCount = await waitForHoldingTableReady(page, {
    timeoutMs: 2_000,
    pollIntervalMs: 25,
    stableSamples: 3,
  });

  assert.equal(rowCount, 1);
  assert.ok(Date.now() - startedAt >= 200);
});

test("times out rather than parsing a holdings table with no data rows", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();

  await page.setContent(`
    <table>
      <thead><tr><th>ISIN</th><th>Holding Value</th></tr></thead>
      <tbody><tr><td colspan="2">Loading...</td></tr></tbody>
    </table>
  `);

  await assert.rejects(
    waitForHoldingTableReady(page, {
      timeoutMs: 100,
      pollIntervalMs: 20,
      stableSamples: 2,
    }),
    /HOLDINGS_DATA_LOAD_TIMED_OUT/,
  );
});
