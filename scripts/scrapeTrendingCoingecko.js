const fs = require("fs");
const path = require("path");

const API_URL = "https://api.coingecko.com/api/v3/search/trending";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTrending(retries = 3) {
  console.log(`\n=== Fetching trending coins from CoinGecko API ===`);
  console.log(`URL: ${API_URL}\n`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${retries}...`);

      const response = await fetch(API_URL, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      const { nfts, ...cleanData } = data;
      
      console.log(`✓ Successfully fetched trending data`);
      console.log(`  - Coins: ${cleanData.coins?.length || 0}`);
      console.log(`  - Categories: ${cleanData.categories?.length || 0}`);

      return cleanData;

    } catch (error) {
      console.error(`✗ Attempt ${attempt} failed:`, error.message);

      if (attempt < retries) {
        const delay = 2000 * attempt;
        console.log(`⏳ Retrying in ${delay / 1000} seconds...`);
        await sleep(delay);
      } else {
        throw new Error(`Failed after ${retries} attempts: ${error.message}`);
      }
    }
  }
}

async function saveTrendingData(data) {
  const outputDir = path.join(process.cwd(), "data");
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`✓ Created output directory: ${outputDir}`);
  }

  const outputPath = path.join(outputDir, "coingecko-trending.json");

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf-8");

  const fileSizeKB = (fs.statSync(outputPath).size / 1024).toFixed(2);
  console.log(`✓ Saved to ${outputPath} (${fileSizeKB} KB)`);

  return outputPath;
}

async function main() {
  try {
    console.log("Starting CoinGecko Trending API scraper...");
    console.log(`Timestamp: ${new Date().toISOString()}\n`);

    const trendingData = await fetchTrending();
    const outputPath = await saveTrendingData(trendingData);

    console.log("\n=== Summary ===");
    console.log(`✓ Total trending coins: ${trendingData.coins?.length || 0}`);
    console.log(`✓ Total trending categories: ${trendingData.categories?.length || 0}`);
    console.log(`✓ Output file: ${outputPath}`);
    console.log("\nDone!");

  } catch (error) {
    console.error("\n✗ Fatal error:", error.message);
    process.exit(1);
  }
}

main();
