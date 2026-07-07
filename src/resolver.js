function getHostname(value) {
  try {
    return new URL(value).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

function getRootDomain(value) {
  const hostname = getHostname(value);

  if (!hostname) {
    return null;
  }

  const parts = hostname.split(".");

  if (parts.length < 2) {
    return hostname;
  }

  const secondLevelDomains = new Set([
    "co.uk",
    "com.au",
    "co.in",
    "co.jp",
    "com.br",
    "com.sg",
    "com.mx",
    "co.nz",
  ]);

  const lastTwo = parts
    .slice(-2)
    .join(".");

  if (
    secondLevelDomains.has(lastTwo) &&
    parts.length >= 3
  ) {
    return parts.slice(-3).join(".");
  }

  return lastTwo;
}

function cleanAdvertiserName(value) {
  if (!value) {
    return null;
  }

  const cleaned = String(value)
    .replace(/^www\./i, "")
    .replace(
      /\.(com|io|co|net|org|ai|app|xyz|care)$/i,
      ""
    )
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  if (!cleaned || cleaned.length < 2) {
    return null;
  }

  if (/^\d+$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function getAdvertiserNameFromUrl(value) {
  const rootDomain = getRootDomain(value);

  if (!rootDomain) {
    return null;
  }

  return cleanAdvertiserName(
    rootDomain.split(".")[0]
  );
}

function isSameDomain(
  value,
  publisherDomain
) {
  const hostname = getHostname(value);

  if (!hostname || !publisherDomain) {
    return false;
  }

  const normalizedPublisher =
    publisherDomain
      .replace(/^www\./, "")
      .toLowerCase();

  return (
    hostname === normalizedPublisher ||
    hostname.endsWith(
      `.${normalizedPublisher}`
    )
  );
}

function isAdTechDomain(value) {
  const hostname = getHostname(value);

  if (!hostname) {
    return true;
  }

  const domains = [
    "servedbyadbutler.com",
    "adbutler.com",
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "adnxs.com",
    "taboola.com",
    "outbrain.com",
    "adform.net",
    "czilladx.com",
    "request-global.czilladx.com",
  ];

  return domains.some(
    (domain) =>
      hostname === domain ||
      hostname.endsWith(`.${domain}`)
  );
}

function isIgnoredFinalDomain(value) {
  const hostname = getHostname(value);

  if (!hostname) {
    return true;
  }

  const domains = [
    "google.com",
    "googleapis.com",
    "gstatic.com",
    "googleusercontent.com",
    "cloudflare.com",
    "cloudflareinsights.com",
    "facebook.com",
    "facebook.net",
    "twitter.com",
    "x.com",
    "youtube.com",
    "youtu.be",
    "jsdelivr.net",
    "cdnjs.com",
    "unpkg.com",
  ];

  return domains.some(
    (domain) =>
      hostname === domain ||
      hostname.endsWith(`.${domain}`)
  );
}

function isValidFinalUrl(
  value,
  publisherDomain
) {
  return (
    /^https?:\/\//i.test(value || "") &&
    !isSameDomain(value, publisherDomain) &&
    !isAdTechDomain(value) &&
    !isIgnoredFinalDomain(value)
  );
}

function extractNestedUrls(value) {
  const results = [];

  if (!value) {
    return results;
  }

  let current = String(value);

  for (let i = 0; i < 5; i++) {
    try {
      current = decodeURIComponent(current);
    } catch {
      // Stop decoding.
    }

    const matches = current.match(
      /https?:\/\/[^\s"'<>]+/gi
    );

    if (matches) {
      for (const match of matches) {
        const cleaned = match
          .replace(/[),\]}]+$/g, "");

        if (!results.includes(cleaned)) {
          results.push(cleaned);
        }
      }
    }
  }

  return results;
}

async function resolveViaRequest(
  context,
  url,
  publisherDomain
) {
  if (!url) {
    return null;
  }

  try {
    console.log(
      "Direct redirect request:",
      url.slice(0, 300)
    );

    const response =
      await context.request.get(url, {
        timeout: 20000,
        failOnStatusCode: false,
        maxRedirects: 15,
      });

    const finalUrl = response.url();

    console.log(
      "Request final URL:",
      finalUrl
    );

    if (
      isValidFinalUrl(
        finalUrl,
        publisherDomain
      )
    ) {
      return finalUrl;
    }
  } catch (error) {
    console.log(
      "Direct request failed:",
      error.message
    );
  }

  return null;
}

async function resolveViaPage(
  context,
  url,
  publisherDomain
) {
  if (!url) {
    return null;
  }

  let resolverPage;

  try {
    resolverPage = await context.newPage();

    const navigationUrls = [];

    const captureRequest = (request) => {
      try {
        if (
          request.isNavigationRequest() &&
          request.resourceType() === "document"
        ) {
          navigationUrls.push(
            request.url()
          );
        }
      } catch {
        // Ignore.
      }
    };

    resolverPage.on(
      "request",
      captureRequest
    );

    await resolverPage
      .goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      })
      .catch(() => null);

    await resolverPage.waitForTimeout(5000);

    navigationUrls.push(
      resolverPage.url()
    );

    console.log(
      "Page navigation URLs:",
      navigationUrls
    );

    const validUrls = navigationUrls.filter(
      (candidateUrl) =>
        isValidFinalUrl(
          candidateUrl,
          publisherDomain
        )
    );

    if (validUrls.length) {
      return validUrls[
        validUrls.length - 1
      ];
    }

    return null;
  } catch (error) {
    console.log(
      "Resolver page failed:",
      error.message
    );

    return null;
  } finally {
    if (resolverPage) {
      await resolverPage
        .close()
        .catch(() => null);
    }
  }
}

async function resolveSingleAdvertiser(
  page,
  advertiser,
  publisherDomain
) {
  if (advertiser.type !== "banner_ad") {
    return advertiser;
  }

  const originalLandingPage =
    advertiser.originalLandingPage ||
    advertiser.landingPage;

  console.log(
    "\nResolving advertiser:",
    advertiser.advertiserName
  );

  console.log(
    "Original URL:",
    originalLandingPage
  );

  const context = page.context();

  const nestedUrls = extractNestedUrls(
    originalLandingPage
  );

  console.log(
    "Nested URLs:",
    nestedUrls
  );

  for (
    const nestedUrl of nestedUrls.reverse()
  ) {
    if (
      isValidFinalUrl(
        nestedUrl,
        publisherDomain
      )
    ) {
      console.log(
        "Resolved from nested URL:",
        nestedUrl
      );

      return {
        ...advertiser,
        advertiserName:
          getAdvertiserNameFromUrl(
            nestedUrl
          ),
        originalLandingPage,
        landingPage: nestedUrl,
        landingPageResolved: true,
      };
    }
  }

  let resolvedLandingPage =
    await resolveViaRequest(
      context,
      originalLandingPage,
      publisherDomain
    );

  if (!resolvedLandingPage) {
    resolvedLandingPage =
      await resolveViaPage(
        context,
        originalLandingPage,
        publisherDomain
      );
  }

  console.log(
    "Resolved landing page:",
    resolvedLandingPage
  );

  return {
    ...advertiser,
    advertiserName:
      resolvedLandingPage
        ? getAdvertiserNameFromUrl(
            resolvedLandingPage
          )
        : advertiser.advertiserName,
    originalLandingPage,
    landingPage:
      resolvedLandingPage || null,
    landingPageResolved:
      Boolean(resolvedLandingPage),
  };
}

async function resolveAdvertiserLandingPages(
  page,
  advertisers = [],
  publisherDomain = null
) {
  const results = [];

  for (const advertiser of advertisers) {
    const result =
      await resolveSingleAdvertiser(
        page,
        advertiser,
        publisherDomain
      );

    results.push(result);
  }

  const seen = new Set();

  return results.filter((advertiser) => {
    if (advertiser.type !== "banner_ad") {
      return true;
    }

    if (
      !advertiser.landingPageResolved ||
      !advertiser.landingPage
    ) {
      return false;
    }

    const rootDomain = getRootDomain(
      advertiser.landingPage
    );

    if (!rootDomain) {
      return false;
    }

    const key = [
      advertiser.type,
      rootDomain,
    ]
      .join("|")
      .toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

module.exports = {
  resolveAdvertiserLandingPages,
};
