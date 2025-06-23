require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function scrapeHighGrowthHashtags(topic) {
  console.log('🚀 Launching browser...');
  const browser = await puppeteer.launch({
    headless: false, // Set to true after testing
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1400,900'
    ]
  });

  const page = await browser.newPage();
  
  try {
    // Configure browser to appear human
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    // Navigate to hashtag inspiration page
    console.log(`🌐 Searching for "${topic}"...`);
    await page.goto('https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en', {
      waitUntil: 'networkidle2',
      timeout: 120000
    });

    // Input search topic
    await page.type('input[placeholder="Search hashtags"]', topic);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000); // Wait for results

    // Scroll to load all results
    await autoScroll(page);

    // Extract hashtag data
    console.log('📊 Analyzing results...');
    const hashtags = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.hashtag-item')).map(item => {
        const name = item.querySelector('.hashtag-name')?.textContent?.trim() || '';
        const growthText = item.querySelector('.growth-rate')?.textContent || '';
        const growth = parseInt(growthText.replace(/\D/g, '')) || 0;
        const posts = item.querySelector('.video-count')?.textContent?.trim() || '';

        return { name, growth, posts };
      });
    });

    // Filter for high-growth hashtags
    const highGrowthHashtags = hashtags
      .filter(h => h.growth > 200)
      .sort((a, b) => b.growth - a.growth);

    // Display results
    console.log('\n💎 HIGH-GROWTH HASHTAGS (>200%):');
    console.table(highGrowthHashtags);
    console.log(`✅ Found ${highGrowthHashtags.length} hashtags for "${topic}"`);

    return highGrowthHashtags;

  } catch (err) {
    console.error('❌ Error:', err);
    await page.screenshot({ path: 'error.png' });
    console.log('📸 Screenshot saved to error.png');
  } finally {
    await browser.close();
  }
}

// Improved scrolling function
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let scrollCount = 0;
      const maxScrolls = 10;
      const timer = setInterval(() => {
        window.scrollBy(0, window.innerHeight);
        scrollCount++;
        if (scrollCount >= maxScrolls || 
            window.scrollY + window.innerHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 2000);
    });
  });
}

// Example usage
scrapeHighGrowthHashtags('fitness')
  .catch(console.error);