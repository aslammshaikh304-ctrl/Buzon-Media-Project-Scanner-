function getHostname(value) {
  try {
    return new URL(value).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

function isIgnoredDomain(value) {
  const hostname = getHostname(value);

  if (!hostname) return true;

  const ignoredDomains = [
    "servedbyadbutler.com",
    "adbutler.com",
    "googleapis.com",
    "gstatic.com",
    "google.com",
    "googleusercontent.com",
    "cloudflare.com",
    "cloudflareinsights.com",
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "facebook.com",
    "facebook.net",
    "twitter.com",
    "x.com",
    "jsdelivr.net",
    "cdnjs.com",
    "unpkg.com",
    "adnxs.com",
    "taboola.com",
    "outbrain.com",
    "adform.net",
  ];

  return ignoredDomains.some(
    (domain) =>
      hostname === domain ||
      hostname.endsWith(`.${domain}`)
  );
}

function isValidAdvertiserUrl(value) {
  return (
    /^https?:\/\//i.test(value || "") &&
    !isIgnoredDomain(value)
  );
}

function withTimeout(
  promise,
  timeoutMs = 12000
) {
  let timeoutId;

  const timeoutPromise = new Promise(
    (resolve) => {
      timeoutId = setTimeout(
        () => resolve(null),
        timeoutMs
      );
    }
  );

  return Promise.race([
    promise,
    timeoutPromise,
  ]).finally(() => {
    clearTimeout(timeoutId);
  });
}

async function resolveByAdClick(
  page,
  advertiser
) {
  const originalLandingPage =
    advertiser.originalLandingPage ||
    advertiser.landingPage;

  if (!originalLandingPage) {
    return null;
  }

  let adPage = null;

  try {
    adPage = await page.context().newPage();

    await adPage.goto(originalLandingPage, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });

    await adPage.waitForTimeout(1500);

    const beforeClickUrl = adPage.url();

    if (
      beforeClickUrl !== originalLandingPage &&
      isValidAdvertiserUrl(beforeClickUrl)
    ) {
      return beforeClickUrl;
    }

    const links = adPage.locator("a[href]");
    const linkCount = await links.count();

    for (
      let index = 0;
      index < Math.min(linkCount, 10);
      index++
    ) {
      try {
        const href = await links
          .nth(index)
          .getAttribute("href");

        if (!href) continue;

        const absoluteUrl = new URL(
          href,
          adPage.url()
        ).href;

        if (
          isValidAdvertiserUrl(absoluteUrl)
        ) {
          return absoluteUrl;
        }
      } catch {
        // Ignore invalid link.
      }
    }

    const popupPromise = adPage
      .waitForEvent("popup", {
        timeout: 5000,
      })
      .catch(() => null);

    const viewport = await adPage.evaluate(
      () => ({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    );

    await adPage.mouse
      .click(
        Math.floor(viewport.width / 2),
        Math.floor(viewport.height / 2)
      )
      .catch(() => null);

    const popup = await popupPromise;

    if (popup) {
      await popup
        .waitForLoadState("domcontentloaded", {
          timeout: 7000,
        })
        .catch(() => null);

      const popupUrl = popup.url();

      await popup.close().catch(() => null);

      if (isValidAdvertiserUrl(popupUrl)) {
        return popupUrl;
      }
    }

    await adPage.waitForTimeout(1500);

    const afterClickUrl = adPage.url();

    if (
      afterClickUrl !== originalLandingPage &&
      isValidAdvertiserUrl(afterClickUrl)
    ) {
      return afterClickUrl;
    }

    return null;
  } catch {
    return null;
  } finally {
    if (adPage) {
      await adPage.close().catch(() => null);
    }
  }
}

async function resolveSingleAdvertiser(
  page,
  advertiser
) {
  if (advertiser.type !== "banner_ad") {
    return advertiser;
  }

  const originalLandingPage =
    advertiser.originalLandingPage ||
    advertiser.landingPage;

  const resolvedLandingPage =
    await withTimeout(
      resolveByAdClick(page, advertiser),
      12000
    );

  return {
    ...advertiser,
    originalLandingPage,
    landingPage:
      resolvedLandingPage ||
      advertiser.landingPage,
    landingPageResolved:
      Boolean(resolvedLandingPage),
  };
}

async function resolveAdvertiserLandingPages(
  page,
  advertisers = []
) {
  const concurrency = 5;
  const results = [];

  for (
    let index = 0;
    index < advertisers.length;
    index += concurrency
  ) {
    const batch = advertisers.slice(
      index,
      index + concurrency
    );

    const batchResults = await Promise.all(
      batch.map((advertiser) =>
        resolveSingleAdvertiser(
          page,
          advertiser
        )
      )
    );

    results.push(...batchResults);
  }

  return results;
}

module.exports = {
  resolveAdvertiserLandingPages,
};