function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
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

function isSameDomain(domain, publisherDomain) {
  if (!domain || !publisherDomain) {
    return false;
  }

  return (
    domain === publisherDomain ||
    domain.endsWith(`.${publisherDomain}`)
  );
}

const GARBAGE_NAMES = new Set([
  "index",
  "home",
  "news",
  "crypto",
  "world",
  "submit",
  "review",
  "reviews",
  "press",
  "release",
  "article",
  "sponsored",
  "sponsor",
  "sponsors",
  "premium sponsor",
  "premium sponsors",
  "advertisement",
  "advertising",
  "advert",
  "banner",
  "creative",
  "click",
  "redirect",
  "unknown",
  "null",
  "cp",
  "image",
  "images",
  "img",
  "imagex",
  "asset",
  "assets",
  "static",
  "cdn",
  "media",
  "upload",
  "uploads",
  "account",
  "accounts",
  "login",
  "signin",
  "signup",
  "register",
  "stage",
  "staging",
  "exclusive",
]);

const GENERIC_NAME_WORDS = new Set([
  "sponsor",
  "sponsors",
  "sponsored",
  "advert",
  "advertisement",
  "advertising",
  "banner",
  "creative",
  "image",
  "images",
  "asset",
  "assets",
  "static",
  "cdn",
  "media",
  "account",
  "accounts",
  "login",
  "signin",
  "signup",
  "register",
]);

const TRACKING_DOMAINS = [
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

function cleanCompanyName(value) {
  if (!value) {
    return null;
  }

  const cleaned = normalizeText(value)
    .replace(/\.(com|io|co|net|org|ai)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(
      /\b\d{2,4}\s*[xX]\s*\d{2,4}\b/g,
      ""
    )
    .replace(/\b(www|https|http)\b/gi, "")
    .replace(/\b(index|html?|php)\b/gi, "")
    .replace(/[^\w\s.&'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  if (!cleaned || cleaned.length < 2) {
    return null;
  }

  if (/^\d+$/.test(cleaned)) {
    return null;
  }

  if (/^x\d+$/i.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function isValidAdvertiserName(value) {
  const cleaned = cleanCompanyName(value);

  if (!cleaned) {
    return false;
  }

  const normalized = cleaned.toLowerCase();

  if (GARBAGE_NAMES.has(normalized)) {
    return false;
  }

  const words = normalized
    .split(/\s+/)
    .filter(Boolean);

  if (
    words.length > 0 &&
    words.every((word) =>
      GENERIC_NAME_WORDS.has(word)
    )
  ) {
    return false;
  }

  if (
    /^(img|image|asset|cdn|static)\d*$/i.test(
      normalized
    )
  ) {
    return false;
  }

  if (
    /^(stage|staging)\d*$/i.test(normalized)
  ) {
    return false;
  }

  if (
    /^[a-f0-9]{12,}$/i.test(normalized)
  ) {
    return false;
  }

  return true;
}

function validateAdvertiserName(value) {
  const cleaned = cleanCompanyName(value);

  if (!isValidAdvertiserName(cleaned)) {
    return null;
  }

  return cleaned;
}

function isTrackingDomain(domain) {
  if (!domain) {
    return false;
  }

  return TRACKING_DOMAINS.some(
    (trackingDomain) =>
      domain === trackingDomain ||
      domain.endsWith(`.${trackingDomain}`)
  );
}

function getRootDomainName(domain) {
  if (!domain) {
    return null;
  }

  const parts = domain.split(".");

  if (parts.length < 2) {
    return null;
  }

  const commonSecondLevelDomains = new Set([
    "co.uk",
    "com.au",
    "co.in",
    "co.jp",
    "com.br",
    "com.sg",
    "com.mx",
    "co.nz",
  ]);

  const lastTwoParts = parts
    .slice(-2)
    .join(".");

  if (
    commonSecondLevelDomains.has(lastTwoParts) &&
    parts.length >= 3
  ) {
    return parts[parts.length - 3];
  }

  return parts[parts.length - 2];
}

function extractNameFromDomain(value) {
  const domain = getDomain(value);

  if (!domain || isTrackingDomain(domain)) {
    return null;
  }

  const domainPart = getRootDomainName(domain);

  return validateAdvertiserName(domainPart);
}

function extractAdvertiserFromAdUrl(candidate) {
  const urls = [
  candidate.href,
  candidate.iframeSrc,
  candidate.frameUrl,
].filter(Boolean);

  for (const value of urls) {
    try {
      let decoded = value;

      for (
        let index = 0;
        index < 3;
        index += 1
      ) {
        try {
          const nextDecoded =
            decodeURIComponent(decoded);

          if (nextDecoded === decoded) {
            break;
          }

          decoded = nextDecoded;
        } catch {
          break;
        }
      }

      const metadataMatch = decoded.match(
        /__ab_advertiser_name=([^&\\]+)/i
      );

      if (metadataMatch?.[1]) {
        const metadataName =
          validateAdvertiserName(
            metadataMatch[1]
          );

        if (metadataName) {
          return metadataName;
        }
      }

      const clickTagMatch = decoded.match(
        /clickTag=([^&\\]+)/i
      );

      if (clickTagMatch?.[1]) {
        let clickUrl = clickTagMatch[1];

        try {
          clickUrl =
            decodeURIComponent(clickUrl);
        } catch {
          // Keep original value.
        }

        const domainName =
          extractNameFromDomain(clickUrl);

        if (domainName) {
          return domainName;
        }
      }

      const creativeMatch = decoded.match(
        /creative[^/]*\/(?:\d+[-_]?)?([^/?&#]+)/i
      );

      if (creativeMatch?.[1]) {
        const creativeName =
          validateAdvertiserName(
            creativeMatch[1]
          );

        if (creativeName) {
          return creativeName;
        }
      }

      const directDomainName =
        extractNameFromDomain(value);

      if (directDomainName) {
        return directDomainName;
      }
    } catch {
      // Ignore malformed ad URLs.
    }
  }

  return null;
}

function extractArticleAdvertiser(candidate) {
  let text = normalizeText(candidate.text);

  if (!text) {
    return null;
  }

  const publisherLabels = [
    "CHAINWIRE",
    "GLOBE NEWSWIRE",
    "PR NEWSWIRE",
    "BUSINESS WIRE",
    "ACCESSWIRE",
  ];

  for (const label of publisherLabels) {
    if (
      text.toUpperCase().startsWith(label)
    ) {
      text = text
        .slice(label.length)
        .trim();

      break;
    }
  }

  const patterns = [
    /^([A-Z][A-Za-z0-9.&'-]+\s+[A-Z][A-Za-z0-9.&'-]+)\s+(?:Launches|Introduces|Announces|Unveils|Partners|Raises|Secures|Expands|Releases)\b/,
    /^([A-Z][A-Za-z0-9.&'-]+)\s+(?:Launches|Introduces|Announces|Unveils|Partners|Raises|Secures|Expands|Releases)\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      const companyName =
        validateAdvertiserName(match[1]);

      if (companyName) {
        return companyName;
      }
    }
  }

  return null;
}

function detectArticleType(candidate) {
  const combined = [
    candidate.text,
    candidate.className,
    candidate.elementId,
    candidate.href,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    combined.includes("press-release") ||
    combined.includes("press_release") ||
    combined.includes("chainwire") ||
    combined.includes("press release")
  ) {
    return "pr_article";
  }

  if (
    combined.includes("sponsored") ||
    combined.includes("sponsor") ||
    combined.includes("partner content") ||
    combined.includes("paid content")
  ) {
    return "sponsored_article";
  }

  if (
    combined.includes("review") ||
    combined.includes("reviews")
  ) {
    return "review_post";
  }

  return null;
}

function detectBanner(candidate) {
  const combined = [
    candidate.href,
    candidate.iframeSrc,
    candidate.className,
    candidate.elementId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const networkSignal =
    TRACKING_DOMAINS.some((network) =>
      combined.includes(network)
    );

  return (
    networkSignal ||
    candidate.signals?.sizeSignal ||
    candidate.signals?.iframeSignal
  );
}

function calculateConfidence({
  candidate,
  type,
  advertiserName,
}) {
  let confidence = 40;

  confidence += Math.min(
    Number(candidate.score || 0) * 4,
    28
  );

  if (type === "banner_ad") {
    confidence += 10;
  }

  if (
    type === "pr_article" ||
    type === "sponsored_article"
  ) {
    confidence += 12;
  }

  if (advertiserName) {
    confidence += 10;
  }

  if (
    candidate.href ||
    candidate.iframeSrc
  ) {
    confidence += 5;
  }

  return Math.min(confidence, 99);
}

function classifyCandidate(candidate) {
  const articleType =
    detectArticleType(candidate);

  let type = null;

  if (articleType) {
    type = articleType;
  } else if (detectBanner(candidate)) {
    type = "banner_ad";
  }

  if (!type) {
    return null;
  }

  let advertiserName = null;

  if (type === "banner_ad") {
    advertiserName =
      extractAdvertiserFromAdUrl(candidate);
  } else {
    advertiserName =
      extractArticleAdvertiser(candidate);
  }

  advertiserName =
    validateAdvertiserName(advertiserName);

  const landingPage =
    candidate.href ||
    candidate.iframeSrc ||
    null;

  const confidence = calculateConfidence({
    candidate,
    type,
    advertiserName,
  });

    return {
    candidateId:
      candidate.candidateId || null,
    frameUrl:
      candidate.frameUrl || null,
    type,
    advertiserName,
    landingPage,
    originalLandingPage:
      candidate.href ||
      candidate.iframeSrc ||
      null,
    creativeUrl:
      candidate.imageUrl || null,
    sourceText: normalizeText(
      candidate.text
    ).slice(0, 500),
    confidence,
    candidateScore: candidate.score,
  };
}

function classifyCandidates(
  candidates = [],
  publisherDomain = null
) {
  const results = [];
  const seen = new Set();

  const publisherName =
    getRootDomainName(publisherDomain);

  for (const candidate of candidates) {
    const classification =
      classifyCandidate(candidate);

    if (!classification) {
      continue;
    }

    const hrefDomain = getDomain(
      candidate.href
    );

    const iframeDomain = getDomain(
      candidate.iframeSrc
    );

    const candidateUsesTrackingNetwork =
      isTrackingDomain(hrefDomain) ||
      isTrackingDomain(iframeDomain);

    if (
      classification.type === "banner_ad" &&
      isSameDomain(
        hrefDomain,
        publisherDomain
      ) &&
      !candidateUsesTrackingNetwork
    ) {
      continue;
    }

    classification.advertiserName =
      validateAdvertiserName(
        classification.advertiserName
      );

    if (
      classification.advertiserName &&
      publisherName &&
      classification.advertiserName
        .toLowerCase() ===
        publisherName.toLowerCase()
    ) {
      classification.advertiserName = null;
    }

    if (
      classification.type !== "banner_ad" &&
      !classification.advertiserName
    ) {
      continue;
    }

    if (
  classification.type === "banner_ad" &&
  !classification.advertiserName &&
  !classification.creativeUrl &&
  !classification.landingPage
) {
  continue;
}

    const uniqueKey =
      classification.advertiserName
        ? [
            classification.type,
            classification.advertiserName.toLowerCase(),
          ].join("|")
        : [
            classification.type,
            classification.landingPage,
          ].join("|");

    if (seen.has(uniqueKey)) {
      continue;
    }

    seen.add(uniqueKey);

    results.push(classification);
  }

  return results.sort(
    (a, b) =>
      b.confidence - a.confidence
  );
}

module.exports = {
  classifyCandidate,
  classifyCandidates,
};