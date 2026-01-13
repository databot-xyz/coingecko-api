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

async function scrapeDefiLlamaWithMouse(page, retries = 2) {
  const url = BASE_URL;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      await sleep(3000);

      await page.waitForSelector("#table-wrapper", { timeout: 30000 });

      await page.click("#table-wrapper");
      await sleep(500);

      const allProtocols = new Map();
      const totalPresses = 150;

      for (let i = 0; i < totalPresses; i++) {
        await page.keyboard.press("ArrowDown");
        await sleep(100);

        if (i % 5 === 0) {
          const protocols = await page.evaluate(() => {
            const results = [];
            const wrapper = document.querySelector("#table-wrapper");
            if (!wrapper) return results;

            const rows = Array.from(
              wrapper.querySelectorAll('div[style*="position: absolute"]')
            ).filter(
              (el) =>
                el.style.transform && el.style.transform.includes("translateY")
            );

            rows.forEach((row) => {
              try {
                const cells = Array.from(
                  row.querySelectorAll('div[data-chainpage="true"]')
                );
                if (cells.length < 2) return;

                const protocol = {
                  rank: null,
                  name: null,
                  logo: null,
                  chains: null,
                  tvl: null,
                  volume_7d: null,
                  fees_7d: null,
                  revenue_7d: null,
                  mcap_tvl: null,
                  volume_30d: null,
                  fees_30d: null,
                  revenue_30d: null,
                  volume_24h: null,
                  fees_24h: null,
                  revenue_24h: null,
                };

                const nameCell = cells[0];
                if (nameCell) {
                  const rankSpan = nameCell.querySelector("span.shrink-0");
                  if (rankSpan) {
                    protocol.rank =
                      parseInt(rankSpan.textContent.trim()) || null;
                  }

                  const img = nameCell.querySelector("img");
                  if (img) {
                    protocol.logo = img.getAttribute("src");
                  }

                  const nameLink = nameCell.querySelector("a.text-sm");
                  if (nameLink) {
                    protocol.name = nameLink.textContent.trim();
                  }

                  const chainsSpan = nameCell.querySelector(
                    'span[class*="text-[0.7rem]"]'
                  );
                  if (chainsSpan) {
                    protocol.chains = chainsSpan.textContent.trim();
                  }
                }

                if (cells[1]) protocol.tvl = cells[1].textContent.trim();
                if (cells[2]) protocol.volume_7d = cells[2].textContent.trim();
                if (cells[3]) protocol.fees_7d = cells[3].textContent.trim();
                if (cells[4]) protocol.revenue_7d = cells[4].textContent.trim();
                if (cells[5]) protocol.mcap_tvl = cells[5].textContent.trim();
                if (cells[6]) protocol.volume_30d = cells[6].textContent.trim();
                if (cells[7]) protocol.fees_30d = cells[7].textContent.trim();
                if (cells[8])
                  protocol.revenue_30d = cells[8].textContent.trim();
                if (cells[9]) protocol.volume_24h = cells[9].textContent.trim();
                if (cells[10]) protocol.fees_24h = cells[10].textContent.trim();
                if (cells[11])
                  protocol.revenue_24h = cells[11].textContent.trim();

                results.push(protocol);
              } catch (err) {
                // Skip
              }
            });

            return results;
          });

          protocols.forEach((p) => {
            if (p.name) {
              allProtocols.set(p.name, p);
            }
          });
        }
      }

      const protocols = Array.from(allProtocols.values()).sort((a, b) => {
        if (a.rank === null) return 1;
        if (b.rank === null) return -1;
        return a.rank - b.rank;
      });

      const parsedProtocols = protocols.map((p) => ({
        ...p,
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

    const protocols = await scrapeDefiLlamaWithMouse(page);

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
