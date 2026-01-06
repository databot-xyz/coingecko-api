const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const START_PAGE = 1;
const MAX_PAGE = 100;
const BASE_URL = "https://www.coingecko.com/en";

async function scrapeOnePage(page, pageNumber, scrapeTimestamp) {
  const url = `${BASE_URL}?page=${pageNumber}`;

  console.log(`\n=== Scraping page ${pageNumber} → ${url} ===`);

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await sleep(4000);

  const tableSelector = "table.gecko-homepage-coin-table tbody tr";

  await page.waitForSelector(tableSelector, { timeout: 60000 });

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
        if (!span) return { text, pct: null };

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
          high_24h: null,
          low_24h: null,
          price_change_24h: null,
          price_change_percentage_24h: null,
          market_cap_change_24h: null,
          market_cap_change_percentage_24h: null,
          circulating_supply: null,
          total_supply: null,
          max_supply: null,
          atl: null,
          atl_change_percentage: null,
          roi_times: null,
          roi_currency: null,
          roi_percentage: null,
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

        const { pct: price_change_percentage_24h } = parsePercentCell(cells[6]);
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

  console.log(`Page ${pageNumber}: extracted ${rows.length} rows`);
  return rows;
}

async function scrapeCoinGeckoAllPages() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(60000);

  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/122.0.0.0 Safari/537.36"
  );

  await page.setViewport({ width: 1400, height: 900 });

  const allCoins = [];
  const scrapeTimestamp = new Date().toISOString();

  for (let p = START_PAGE; p <= MAX_PAGE; p++) {
    try {
      const rows = await scrapeOnePage(page, p, scrapeTimestamp);
      allCoins.push(...rows);
      await sleep(1500);
    } catch (err) {
      console.error(`Error on page ${p}:`, err.message || err);
    }
  }

  await browser.close();
  return allCoins;
}

(async () => {
  try {
    const coins = await scrapeCoinGeckoAllPages();
    console.log(`\nTotal rows scraped: ${coins.length}`);

    const outputDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    const outputPath = path.join(outputDir, "coingecko-homepages-schema.json");
    fs.writeFileSync(outputPath, JSON.stringify(coins, null, 2), "utf-8");

    console.log(`Saved to ${outputPath}`);
  } catch (err) {
    console.error("Error scraping CoinGecko:", err);
    process.exit(1);
  }
})();
