const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const START_PAGE = 1;
const MAX_PAGE = 100;
const BASE_URL = "https://www.coingecko.com";
const RESTART_INTERVAL = 20;

async function scrapeOnePage(page, pageNumber, scrapeTimestamp, retries = 2) {
  const url = `${BASE_URL}?page=${pageNumber}`;

  console.log(`\n=== Scraping page ${pageNumber} → ${url} ===`);

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      await sleep(3000);

      const tableSelector = "table.gecko-homepage-coin-table tbody tr";

      const tableExists = await page.evaluate(() => {
        return !!document.querySelector("table.gecko-homepage-coin-table");
      });

      if (!tableExists) {
        console.log(`⚠️  Table not found on page ${pageNumber}`);
        return [];
      }

      await page.waitForSelector(tableSelector, { timeout: 30000 });

      const rows = await page.evaluate(
        (selector, pageNumber, scrapeTimestamp) => {
          const trs = Array.from(document.querySelectorAll(selector));

          function parsePriceCell(cell) {
            if (!cell) return { text: null, usd: null };

            const span = cell.querySelector("span");
            if (!span) return { text: null, usd: null };

            const text = span.textContent.trim();
            const raw = span.getAttribute("data-price-usd");
            if (!raw) return { text, usd: null };

            const n = Number(raw);
            return { text, usd: Number.isNaN(n) ? raw : n };
          }

          function parsePercentCell(cell) {
            if (!cell) return { text: null, pct: null };

            const span = cell.querySelector("span");
            if (!span) return { text: null, pct: null };

            const text = span.textContent.trim();
            const rawJson = span.getAttribute("data-json");
            if (!rawJson) return { text, pct: null };

            try {
              const obj = JSON.parse(rawJson);
              const v = obj?.usd;
              const n = Number(v);
              return { text, pct: Number.isNaN(n) ? v : n };
            } catch {
              return { text, pct: null };
            }
          }

          return trs.map((row) => {
            const cells = row.querySelectorAll("td");

            const result = {
              id: null,
              symbol: null,
              name: null,
              image: null,
              current_price: null,
              market_cap: null,
              market_cap_rank: null,
              fully_diluted_variation: null,
              total_volume: null,
              price_change_percentage_24h: null,
              last_updated: scrapeTimestamp,
            };

            if (!cells.length) return result;

            const starIcon = row.querySelector("i[data-coin-id]");
            const coinIdAttr = starIcon?.getAttribute("data-coin-id") || null;

            const rankText = cells[1]?.innerText.trim() || null;
            const rankNum = rankText ? Number(rankText) : null;
            result.market_cap_rank = Number.isNaN(rankNum) ? rankText : rankNum;

            const coinCell = cells[2];
            if (coinCell) {
              const anchor = coinCell.querySelector("a");
              if (anchor) {
                const href = anchor.getAttribute("href") || "";
                const parts = href.split("/");
                const slug = parts[parts.length - 1] || null;
                result.id = slug || coinIdAttr || null;
              } else {
                result.id = coinIdAttr || null;
              }

              const img = coinCell.querySelector("img");
              if (img) result.image = img.getAttribute("src") || null;

              const nameContainer = coinCell.querySelector("a div div");
              if (nameContainer) {
                const firstNode = nameContainer.childNodes[0];
                if (firstNode && firstNode.textContent) {
                  result.name = firstNode.textContent.trim();
                }
                const symbolEl = nameContainer.querySelector("div");
                if (symbolEl) {
                  const symText = symbolEl.textContent.trim();
                  result.symbol = symText ? symText.toLowerCase() : null;
                }
              }
            } else {
              result.id = coinIdAttr || null;
            }

            const { usd: current_price } = parsePriceCell(cells[4]);
            result.current_price = current_price;

            const { pct: price_change_percentage_24h } = parsePercentCell(
              cells[6]
            );
            result.price_change_percentage_24h = price_change_percentage_24h;

            const { usd: total_volume } = parsePriceCell(cells[9]);
            result.total_volume = total_volume;

            const { usd: market_cap } = parsePriceCell(cells[10]);
            result.market_cap = market_cap;

            const { usd: fdv } = parsePriceCell(cells[11]);
            result.fully_diluted_variation = fdv;

            return result;
          });
        },
        tableSelector,
        pageNumber,
        scrapeTimestamp
      );

      console.log(`✓ Page ${pageNumber}: extracted ${rows.length} rows`);
      return rows;
    } catch (err) {
      console.error(
        `✗ Attempt ${attempt}/${retries + 1} failed on page ${pageNumber}:`,
        err.message
      );

      if (attempt <= retries) {
        console.log(`⏳ Retrying in 5 seconds...`);
        await sleep(5000);
      } else {
        throw err;
      }
    }
  }
}

async function createBrowser() {
  return await puppeteer.launch({
    headless: true,
    protocolTimeout: 180000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });
}

async function createPage(browser) {
  const page = await browser.newPage();

  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(60000);

  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/122.0.0.0 Safari/537.36"
  );

  await page.setViewport({ width: 1400, height: 900 });

  return page;
}

async function scrapeCoinGeckoAllPages() {
  let browser = await createBrowser();
  let page = await createPage(browser);

  const allCoins = [];
  const scrapeTimestamp = new Date().toISOString();
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 3;

  for (let p = START_PAGE; p <= MAX_PAGE; p++) {
    console.log(`\n[DEBUG] Starting iteration for page ${p}/${MAX_PAGE}`);
    
    if ((p - START_PAGE) % RESTART_INTERVAL === 0 && p !== START_PAGE) {
      console.log(`\n🔄 Restarting browser at page ${p} to free resources...`);
      await browser.close();
      await sleep(2000);

      browser = await createBrowser();
      page = await createPage(browser);
      console.log(`[DEBUG] Browser restarted successfully`);
    }

    try {
      console.log(`[DEBUG] Calling scrapeOnePage(${p}) - consecutiveErrors=${consecutiveErrors}`);
      const rows = await scrapeOnePage(page, p, scrapeTimestamp);
      console.log(`[DEBUG] scrapeOnePage returned ${rows.length} rows`);

      if (rows.length === 0) {
        console.log(`⚠️  No rows found on page ${p}, stopping...`);
        break;
      }

      allCoins.push(...rows);
      consecutiveErrors = 0;

      console.log(`✓ Page ${p} SUCCESS - Progress: ${allCoins.length} total coins scraped (errors reset to 0)`);

      const delay = 3000 + Math.random() * 3000;
      console.log(`[DEBUG] Sleeping ${delay.toFixed(0)}ms before next page...`);
      await sleep(delay);
    } catch (err) {
      consecutiveErrors++;
      console.error(
        `✗ Error on page ${p} (${consecutiveErrors}/${maxConsecutiveErrors}):`,
        err.message
      );
      console.log(`[DEBUG] consecutiveErrors incremented to ${consecutiveErrors}`);

      if (consecutiveErrors >= maxConsecutiveErrors) {
        console.log(`\n⚠️  Too many consecutive errors, stopping at page ${p}`);
        break;
      }

      console.log(`[DEBUG] Sleeping 8s before retry...`);
      await sleep(8000);
    }
  }

  await browser.close();
  return allCoins;
}

(async () => {
  try {
    console.log("Starting CoinGecko scraper...");
    console.log(`Pages: ${START_PAGE} to ${MAX_PAGE}`);
    console.log(`Browser restart interval: every ${RESTART_INTERVAL} pages\n`);

    const coins = await scrapeCoinGeckoAllPages();

    console.log(`\n✓ Total rows scraped: ${coins.length}`);

    const outputDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
      console.log(`Created output directory: ${outputDir}`);
    }

    const outputPath = path.join(outputDir, "coingecko-homepages-schema.json");

    fs.writeFileSync(outputPath, JSON.stringify(coins, null, 2), "utf-8");

    console.log(`✓ Saved to ${outputPath}`);
    console.log("\nDone!");
  } catch (err) {
    console.error("✗ Fatal error:", err);
    process.exit(1);
  }
})();
