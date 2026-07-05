const { chromium } = require("playwright");
const {
  classifyCandidates,
} = require("./classifier");
const {
  resolveAdvertiserLandingPages,
} = require("./resolver");
async function autoScroll(page, maxScrolls = 5) {
  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });

    await page.waitForTimeout(1200);
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
}

async function scanWebsite({
  url,
  waitTimeMs = 5000,
  maxScrolls = 5,
}) {
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
    });

    const context = await browser.newContext({
      viewport: {
        width: 1440,
        height: 1200,
      },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    });

    const page = await context.newPage();

    const startedAt = Date.now();

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(waitTimeMs);

    await autoScroll(page, maxScrolls);

    const candidates = await page.evaluate(() => {
      function cleanText(value) {
        return value
          ? value.replace(/\s+/g, " ").trim().slice(0, 1000)
          : "";
      }

      function absoluteUrl(value) {
        if (!value) return null;

        try {
          return new URL(value, window.location.href).href;
        } catch {
          return null;
        }
      }

      function getDomain(value) {
        if (!value) return null;

        try {
          return new URL(value).hostname
            .replace(/^www\./, "")
            .toLowerCase();
        } catch {
          return null;
        }
      }

      const currentDomain = getDomain(window.location.href);

      const adKeywords = [
        "advert",
        "advertisement",
        "sponsor",
        "sponsored",
        "promo",
        "promotion",
        "banner",
        "partner",
        "native-ad",
        "native_ad",
      ];

      const commonAdSizes = [
        [300, 250],
        [336, 280],
        [728, 90],
        [970, 90],
        [970, 250],
        [320, 50],
        [320, 100],
        [300, 600],
        [160, 600],
      ];

      function hasAdKeyword(value) {
        const normalized = String(value || "").toLowerCase();

        return adKeywords.some((keyword) =>
          normalized.includes(keyword)
        );
      }

      function isAdSize(width, height) {
        return commonAdSizes.some(([adWidth, adHeight]) => {
          return (
            Math.abs(width - adWidth) <= 40 &&
            Math.abs(height - adHeight) <= 40
          );
        });
      }

      const selectors = [
        "iframe",
        "a[href]",
        "img",
        "[class*='ad']",
        "[id*='ad']",
        "[class*='sponsor']",
        "[id*='sponsor']",
        "[class*='promo']",
        "[id*='promo']",
      ];

      const elements = Array.from(
        document.querySelectorAll(selectors.join(","))
      );

      const results = [];
      const seen = new Set();

      elements.forEach((element, index) => {
        const rect = element.getBoundingClientRect();

        const width = Math.round(rect.width);
        const height = Math.round(rect.height);

        if (width < 40 || height < 20) {
          return;
        }

        const tagName = element.tagName.toLowerCase();

        const anchor =
          tagName === "a"
            ? element
            : element.closest("a");

        const image =
          tagName === "img"
            ? element
            : element.querySelector("img");

        const href = absoluteUrl(
          anchor?.getAttribute("href")
        );

        const imageUrl = absoluteUrl(
          image?.getAttribute("src")
        );

        const iframeSrc =
          tagName === "iframe"
            ? absoluteUrl(element.getAttribute("src"))
            : null;

        const className =
          typeof element.className === "string"
            ? element.className
            : "";

        const elementId = element.id || "";

        const text = cleanText(element.innerText);

        const hrefDomain = getDomain(href);
        const iframeDomain = getDomain(iframeSrc);

        const externalLink =
          hrefDomain &&
          hrefDomain !== currentDomain;

        const externalIframe =
          iframeDomain &&
          iframeDomain !== currentDomain;

        const keywordSignal =
          hasAdKeyword(className) ||
          hasAdKeyword(elementId) ||
          hasAdKeyword(text);

        const sizeSignal = isAdSize(width, height);

        const imageSignal =
          Boolean(imageUrl) &&
          width >= 120 &&
          height >= 40;

        const iframeSignal =
          tagName === "iframe" &&
          (externalIframe || sizeSignal);

        let score = 0;

        if (externalLink) score += 3;
        if (externalIframe) score += 3;
        if (keywordSignal) score += 4;
        if (sizeSignal) score += 4;
        if (imageSignal) score += 1;
        if (iframeSignal) score += 2;

        if (score < 3) {
          return;
        }

        const uniqueKey = [
          href,
          imageUrl,
          iframeSrc,
          text.slice(0, 100),
        ].join("|");

        if (seen.has(uniqueKey)) {
          return;
        }

        seen.add(uniqueKey);

        results.push({
          candidateIndex: index,
          score,
          tagName,
          text,
          href,
          hrefDomain,
          imageUrl,
          iframeSrc,
          className: cleanText(className),
          elementId: elementId || null,
          width,
          height,
          signals: {
            externalLink: Boolean(externalLink),
            externalIframe: Boolean(externalIframe),
            keywordSignal,
            sizeSignal,
            imageSignal,
            iframeSignal,
          },
        });
      });

      return results
        .sort((a, b) => b.score - a.score)
        .slice(0, 100);
    });

    const classifiedAdvertisers =
  classifyCandidates(candidates);

const advertisers =
  await resolveAdvertiserLandingPages(
    page,
    classifiedAdvertisers
  );
return {
  success: true,
  requestedUrl: url,
  finalUrl: page.url(),
  pageTitle: await page.title(),
  httpStatus: response?.status() ?? null,
  durationMs: Date.now() - startedAt,
  candidateCount: candidates.length,
  advertiserCount: advertisers.length,
  advertisers,
  candidates,
};
  } catch (error) {
    return {
      success: false,
      requestedUrl: url,
      error: error.message,
      candidates: [],
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  scanWebsite,
};