const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BASE_URL = "https://defillama.com/protocols/prediction-market";

function parseValue(text) {
  if (!text || text === "") return null;

  text = text.replace(/\$/g, "").trim();

  if (text.endsWith("b")) {
    return parseFloat(text.replace("b", "")) * 1e9;
  }
  if (text.endsWith("m")) {
    return parseFloat(text.replace("m", "")) * 1e6;
  }
  if (text.endsWith("k")) {
    return parseFloat(text.replace("k", "")) * 1e3;
  }

  const cleaned = text.replace(/[\s,]/g, "");
  const num = parseFloat(cleaned);

  return isNaN(num) ? null : num;
}

async function scrapeDefiLlama(page, retries = 2) {
  const url = BASE_URL;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      // DefiLlama keeps background price/websocket traffic running
      // permanently, so "networkidle2" never resolves and just burns the
      // full timeout on every attempt. Wait for DOM content instead, then
      // gate real readiness on the table actually having rows.
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      await page.waitForSelector("table tbody tr td a[href^='/protocol/']", {
        timeout: 30000,
      });
      await sleep(1000);

      // The rankings table now renders every row up front as a plain
      // <table> (no virtualization), so a single pass over tbody rows
      // captures everything — no scroll/keyboard simulation needed.
      const raw = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("table tbody tr"));

        return rows
          .map((row) => {
            const cells = Array.from(row.querySelectorAll("td"));
            const nameCell = cells[0];
            const nameLink = nameCell
              ? nameCell.querySelector('a[href^="/protocol/"]')
              : null;
            if (!nameLink) return null;

            const img = nameCell.querySelector("img");
            const nameWrapper = nameLink.closest("span");
            const chainsSpan = nameWrapper
              ? nameWrapper.nextElementSibling
              : null;

            return {
              name: nameLink.textContent.trim(),
              logo: img ? img.getAttribute("src") : null,
              chains: chainsSpan ? chainsSpan.textContent.trim() : null,
              tvl: cells[1] ? cells[1].textContent.trim() : null,
              volume_7d: cells[2] ? cells[2].textContent.trim() : null,
              fees_7d: cells[3] ? cells[3].textContent.trim() : null,
              revenue_7d: cells[4] ? cells[4].textContent.trim() : null,
              mcap_tvl: cells[5] ? cells[5].textContent.trim() : null,
              volume_30d: cells[6] ? cells[6].textContent.trim() : null,
              fees_30d: cells[7] ? cells[7].textContent.trim() : null,
              revenue_30d: cells[8] ? cells[8].textContent.trim() : null,
              volume_24h: cells[9] ? cells[9].textContent.trim() : null,
              fees_24h: cells[10] ? cells[10].textContent.trim() : null,
              revenue_24h: cells[11] ? cells[11].textContent.trim() : null,
            };
          })
          .filter(Boolean);
      });

      // Table rows are already in rank order top to bottom.
      const parsedProtocols = raw.map((p, i) => ({
        rank: i + 1,
        name: p.name,
        logo: p.logo,
        chains: p.chains,
        tvl: parseValue(p.tvl),
        volume_7d: parseValue(p.volume_7d),
        fees_7d: parseValue(p.fees_7d),
        revenue_7d: parseValue(p.revenue_7d),
        mcap_tvl: parseValue(p.mcap_tvl),
        volume_30d: parseValue(p.volume_30d),
        fees_30d: parseValue(p.fees_30d),
        revenue_30d: parseValue(p.revenue_30d),
        volume_24h: parseValue(p.volume_24h),
        fees_24h: parseValue(p.fees_24h),
        revenue_24h: parseValue(p.revenue_24h),
      }));

      return parsedProtocols;
    } catch (err) {
      console.error(`✗ Attempt ${attempt}/${retries + 1} failed:`, err.message);

      if (attempt <= retries) {
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

(async () => {
  let browser;
  try {
    browser = await createBrowser();
    const page = await createPage(browser);

    const protocols = await scrapeDefiLlama(page);

    await browser.close();

    const outputDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    const outputPath = path.join(
      outputDir,
      "defillama-prediction-markets.json"
    );

    fs.writeFileSync(outputPath, JSON.stringify(protocols, null, 2), "utf-8");
  } catch (err) {
    console.error("✗ Fatal error:", err);
    if (browser) await browser.close();
    process.exit(1);
  }
})();
