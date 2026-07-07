const { chromium } = require("playwright");

const {
  classifyCandidates,
} = require("./classifier");

const {
  resolveAdvertiserLandingPages,
} = require("./resolver");

const {
  enrichAdvertisers,
} = require("./enricher");

function cleanUrl(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

function getHostname(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

async function autoScroll(
  page,
  maxScrolls = 5
) {
  for (
    let index = 0;
    index < maxScrolls;
    index += 1
  ) {
    await page
      .evaluate(() => {
        window.scrollBy(
          0,
          Math.max(
            window.innerHeight * 0.8,
            600
          )
        );
      })
      .catch(() => null);

    await page.waitForTimeout(1200);
  }

  await page
    .evaluate(() => {
      window.scrollTo(0, 0);
    })
    .catch(() => null);

  await page.waitForTimeout(1000);
}

async function extractFrameCandidates(
  frame,
  publisherDomain,
  frameIndex
) {
  try {
    return await frame.evaluate(
      ({
        publisherDomain,
        frameIndex,
      }) => {
        function cleanText(
          value,
          maxLength = 1000
        ) {
          return String(value || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, maxLength);
        }

        function absoluteUrl(value) {
          if (!value) {
            return null;
          }

          try {
            return new URL(
              value,
              window.location.href
            ).href;
          } catch {
            return null;
          }
        }

        function getDomain(value) {
          if (!value) {
            return null;
          }

          try {
            return new URL(value).hostname
              .replace(/^www\./, "")
              .toLowerCase();
          } catch {
            return null;
          }
        }

        function isSameDomain(
          domain,
          targetDomain
        ) {
          if (
            !domain ||
            !targetDomain
          ) {
            return false;
          }

          return (
            domain === targetDomain ||
            domain.endsWith(
              `.${targetDomain}`
            )
          );
        }

        const trackingDomains = [
          "servedbyadbutler.com",
          "adbutler.com",
          "doubleclick.net",
          "googlesyndication.com",
          "googleadservices.com",
          "adnxs.com",
          "taboola.com",
          "outbrain.com",
          "adform.net",
        ];

        const adKeywords = [
          "advert",
          "advertisement",
          "advertising",
          "sponsor",
          "sponsored",
          "promo",
          "promotion",
          "banner",
          "partner",
          "native-ad",
          "native_ad",
          "ad-slot",
          "ad_slot",
          "adunit",
          "ad-unit",
          "ad_unit",
          "dfp",
          "google_ads",
          "adbutler",
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
          [468, 60],
          [234, 60],
        ];

        function hasTrackingDomain(
          value
        ) {
          const domain = getDomain(value);

          if (!domain) {
            return false;
          }

          return trackingDomains.some(
            (trackingDomain) =>
              domain === trackingDomain ||
              domain.endsWith(
                `.${trackingDomain}`
              )
          );
        }

        function hasAdKeyword(value) {
          const normalized = String(
            value || ""
          ).toLowerCase();

          return adKeywords.some(
            (keyword) =>
              normalized.includes(keyword)
          );
        }

        function isAdSize(
          width,
          height
        ) {
          return commonAdSizes.some(
            ([adWidth, adHeight]) =>
              Math.abs(
                width - adWidth
              ) <= 50 &&
              Math.abs(
                height - adHeight
              ) <= 50
          );
        }

        function getBackgroundImage(
          element
        ) {
          try {
            const style =
              window.getComputedStyle(
                element
              );

            const backgroundImage =
              style.backgroundImage;

            if (
              !backgroundImage ||
              backgroundImage === "none"
            ) {
              return null;
            }

            const match =
              backgroundImage.match(
                /url\(["']?(.*?)["']?\)/
              );

            return absoluteUrl(
              match?.[1]
            );
          } catch {
            return null;
          }
        }

        const frameUrl =
          window.location.href;

        const frameDomain =
          getDomain(frameUrl);

        const selectors = [
          "iframe",
          "a[href]",
          "img",
          "[class*='ad']",
          "[class*='Ad']",
          "[class*='AD']",
          "[id*='ad']",
          "[id*='Ad']",
          "[id*='AD']",
          "[class*='sponsor']",
          "[id*='sponsor']",
          "[class*='promo']",
          "[id*='promo']",
          "[data-ad]",
          "[data-ad-slot]",
          "[data-ad-unit]",
          "[data-google-query-id]",
          "[data-zone]",
          "[data-banner]",
        ];

        const elements = Array.from(
          document.querySelectorAll(
            selectors.join(",")
          )
        );

        const results = [];
        const seen = new Set();

        elements.forEach(
          (element, elementIndex) => {
            try {
              const rect =
                element.getBoundingClientRect();

              const width = Math.round(
                rect.width
              );

              const height = Math.round(
                rect.height
              );

              const tagName =
                element.tagName
                  .toLowerCase();

              const anchor =
                tagName === "a"
                  ? element
                  : element.closest("a") ||
                    element.querySelector(
                      "a[href]"
                    );

              const image =
                tagName === "img"
                  ? element
                  : element.querySelector(
                      "img"
                    );

              const href = absoluteUrl(
                anchor?.getAttribute("href")
              );

              const imageUrl =
                absoluteUrl(
                  image?.getAttribute("src")
                ) ||
                absoluteUrl(
                  image?.getAttribute(
                    "data-src"
                  )
                ) ||
                getBackgroundImage(
                  element
                );

              const iframeSrc =
                tagName === "iframe"
                  ? absoluteUrl(
                      element.getAttribute(
                        "src"
                      )
                    )
                  : null;

              const className =
                typeof element.className ===
                "string"
                  ? element.className
                  : "";

              const elementId =
                element.id || "";

              const text = cleanText(
                element.innerText ||
                  element.textContent
              );

              const ariaLabel =
                cleanText(
                  element.getAttribute(
                    "aria-label"
                  ),
                  300
                );

              const title = cleanText(
                element.getAttribute("title"),
                300
              );

              const altText = cleanText(
                image?.getAttribute("alt"),
                300
              );

              const datasetText =
                cleanText(
                  Object.entries(
                    element.dataset || {}
                  )
                    .map(
                      ([key, value]) =>
                        `${key} ${value}`
                    )
                    .join(" "),
                  500
                );

              const sourceText =
                cleanText(
                  [
                    text,
                    ariaLabel,
                    title,
                    altText,
                    datasetText,
                  ]
                    .filter(Boolean)
                    .join(" "),
                  1000
                );

              const hrefDomain =
                getDomain(href);

              const iframeDomain =
                getDomain(iframeSrc);

              const externalLink =
                Boolean(hrefDomain) &&
                !isSameDomain(
                  hrefDomain,
                  publisherDomain
                );

              const externalIframe =
                Boolean(iframeDomain) &&
                !isSameDomain(
                  iframeDomain,
                  publisherDomain
                );

              const networkSignal =
                hasTrackingDomain(href) ||
                hasTrackingDomain(
                  iframeSrc
                ) ||
                hasTrackingDomain(frameUrl);

              const keywordSignal =
                hasAdKeyword(className) ||
                hasAdKeyword(elementId) ||
                hasAdKeyword(sourceText) ||
                hasAdKeyword(href) ||
                hasAdKeyword(iframeSrc) ||
                hasAdKeyword(frameUrl);

              const sizeSignal =
                isAdSize(width, height);

              const imageSignal =
                Boolean(imageUrl) &&
                width >= 100 &&
                height >= 30;

              const iframeSignal =
                tagName === "iframe" &&
                (
                  externalIframe ||
                  networkSignal ||
                  sizeSignal ||
                  keywordSignal
                );

              const adFrameSignal =
                frameIndex > 0 &&
                (
                  networkSignal ||
                  hasAdKeyword(frameUrl)
                );

              let score = 0;

              if (externalLink) {
                score += 3;
              }

              if (externalIframe) {
                score += 3;
              }

              if (networkSignal) {
                score += 8;
              }

              if (keywordSignal) {
                score += 4;
              }

              if (sizeSignal) {
                score += 4;
              }

              if (imageSignal) {
                score += 1;
              }

              if (iframeSignal) {
                score += 3;
              }

              if (adFrameSignal) {
                score += 5;
              }

              if (
                width < 20 ||
                height < 10
              ) {
                if (
                  !networkSignal &&
                  !adFrameSignal
                ) {
                  return;
                }
              }

              if (score < 3) {
                return;
              }

              const uniqueKey = [
                href,
                imageUrl,
                iframeSrc,
                frameUrl,
                sourceText.slice(0, 100),
              ].join("|");

              if (seen.has(uniqueKey)) {
                return;
              }

              seen.add(uniqueKey);

              results.push({
                candidateId:
                  `${frameIndex}-${elementIndex}`,
                candidateIndex:
                  elementIndex,
                frameIndex,
                frameUrl,
                frameDomain,
                score,
                tagName,
                text: sourceText,
                href,
                hrefDomain,
                imageUrl,
                iframeSrc,
                className:
                  cleanText(
                    className,
                    500
                  ),
                elementId:
                  elementId || null,
                width,
                height,
                signals: {
                  externalLink,
                  externalIframe,
                  networkSignal,
                  keywordSignal,
                  sizeSignal,
                  imageSignal,
                  iframeSignal,
                  adFrameSignal,
                },
              });
            } catch {
              // Ignore individual DOM errors.
            }
          }
        );

        /*
         * If this is itself an ad-network
         * frame, preserve the frame URL as
         * a candidate even when its inner
         * DOM is hidden or unusual.
         */
        if (
          frameIndex > 0 &&
          (
            hasTrackingDomain(frameUrl) ||
            hasAdKeyword(frameUrl)
          )
        ) {
          const frameKey =
            `frame|${frameUrl}`;

          if (!seen.has(frameKey)) {
            results.push({
              candidateId:
                `${frameIndex}-frame`,
              candidateIndex: -1,
              frameIndex,
              frameUrl,
              frameDomain,
              score: 10,
              tagName: "iframe",
              text: "",
              href: null,
              hrefDomain: null,
              imageUrl: null,
              iframeSrc: frameUrl,
              className: "",
              elementId: null,
              width:
                window.innerWidth || 0,
              height:
                window.innerHeight || 0,
              signals: {
                externalLink: false,
                externalIframe:
                  !isSameDomain(
                    frameDomain,
                    publisherDomain
                  ),
                networkSignal:
                  hasTrackingDomain(
                    frameUrl
                  ),
                keywordSignal:
                  hasAdKeyword(frameUrl),
                sizeSignal: isAdSize(
                  window.innerWidth || 0,
                  window.innerHeight || 0
                ),
                imageSignal: false,
                iframeSignal: true,
                adFrameSignal: true,
              },
            });
          }
        }

        return results;
      },
      {
        publisherDomain,
        frameIndex,
      }
    );
  } catch {
    return [];
  }
}

async function extractCandidates(
  page,
  publisherDomain
) {
  const frames = page.frames();

  console.log(
    `Scanning ${frames.length} frames`
  );

  const frameResults =
    await Promise.all(
      frames.map(
        async (frame, frameIndex) => {
          const candidates =
            await extractFrameCandidates(
              frame,
              publisherDomain,
              frameIndex
            );

          console.log(
            `Frame ${frameIndex}: ${candidates.length} candidates - ${frame.url()}`
          );

          return candidates;
        }
      )
    );

  const candidates =
    frameResults.flat();

  const seen = new Set();

  return candidates
    .filter((candidate) => {
      const key = [
        candidate.href,
        candidate.imageUrl,
        candidate.iframeSrc,
        candidate.frameUrl,
        candidate.text?.slice(0, 100),
      ]
        .join("|")
        .toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    })
    .sort(
      (first, second) =>
        second.score - first.score
    )
    .slice(0, 200);
}

async function scanWebsite({
  url,
  waitTimeMs = 5000,
  maxScrolls = 5,
}) {
  let browser;

  try {
    const requestedUrl = cleanUrl(url);

    if (!requestedUrl) {
      throw new Error(
        "Invalid website URL"
      );
    }

    browser = await chromium.launch({
      headless: true,
    });

    const context =
      await browser.newContext({
        viewport: {
          width: 1440,
          height: 1200,
        },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      });

    const page =
      await context.newPage();

    const startedAt = Date.now();

    const response = await page.goto(
      requestedUrl,
      {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      }
    );

    await page.waitForTimeout(
      waitTimeMs
    );

    await autoScroll(
      page,
      maxScrolls
    );

    /*
     * Give lazy ads time to render after
     * the final scroll.
     */
    await page.waitForTimeout(3000);

    const finalUrl = page.url();

    const publisherDomain =
      getHostname(finalUrl);

    if (!publisherDomain) {
      throw new Error(
        "Unable to determine publisher domain"
      );
    }

    const candidates =
      await extractCandidates(
        page,
        publisherDomain
      );

    console.log(
      `Total candidates: ${candidates.length}`
    );

    const classifiedAdvertisers =
      classifyCandidates(
        candidates,
        publisherDomain
      );

    console.log(
      `Classified advertisers: ${classifiedAdvertisers.length}`
    );
const resolvedAdvertisers =
      await resolveAdvertiserLandingPages(
        page,
        classifiedAdvertisers,
        publisherDomain
      );

    console.log(
      "\n=== RESOLVER DEBUG ==="
    );

    console.dir(
      resolvedAdvertisers.map(
        (advertiser) => ({
          candidateId:
            advertiser.candidateId,
          advertiserName:
            advertiser.advertiserName,
          type: advertiser.type,
          landingPage:
            advertiser.landingPage,
          originalLandingPage:
            advertiser.originalLandingPage,
          landingPageResolved:
            advertiser.landingPageResolved,
        })
      ),
      {
        depth: null,
      }
    );

    console.log(
      "=== END RESOLVER DEBUG ===\n"
    );

    const enrichedAdvertisers =
      await enrichAdvertisers(
        resolvedAdvertisers
      );

    const verifiedAdvertisers =
      enrichedAdvertisers
        .filter((advertiser) => {
          return (
            advertiser.enriched === true &&
            advertiser.enrichment
              ?.isRealAdvertiser === true &&
            advertiser.enrichment
              .companyName &&
            advertiser.enrichment
              .companyDomain
          );
        })
        .map((advertiser) => ({
          companyName:
            advertiser.enrichment
              .companyName,
          companyDomain:
            advertiser.enrichment
              .companyDomain,
          type: advertiser.type,
          confidence:
            advertiser.enrichment
              .confidence,
        }));

    const uniqueAdvertisers =
      Array.from(
        new Map(
          verifiedAdvertisers.map(
            (advertiser) => [
              advertiser.companyDomain,
              advertiser,
            ]
          )
        ).values()
      );

    return {
      success: true,
      requestedUrl,
      finalUrl,
      website: publisherDomain,
      pageTitle: await page.title(),
      httpStatus:
        response?.status() ?? null,
      scanDurationMs:
        Date.now() - startedAt,
      candidateCount:
        candidates.length,
      classifiedCount:
        classifiedAdvertisers.length,
      resolvedCount:
        resolvedAdvertisers.length,
      advertisersFound:
        uniqueAdvertisers.length,
      advertiserCount:
        uniqueAdvertisers.length,
      advertisers:
        uniqueAdvertisers,
    };
  } catch (error) {
    console.error(
      "SCAN ERROR:",
      error
    );

    return {
      success: false,
      requestedUrl: url,
      error: error.message,
      candidates: [],
      advertisers: [],
      advertiserCount: 0,
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