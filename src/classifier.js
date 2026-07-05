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

function cleanCompanyName(value) {
  if (!value) {
    return null;
  }

  return normalizeText(value)
    .replace(/\.(com|io|co|net|org|ai)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\d{2,4}\s*[xX]\s*\d{2,4}\b/g, "")
    .replace(/\b(www|https|http)\b/gi, "")
    .trim()
    .slice(0, 120);
}

function extractAdvertiserFromAdUrl(candidate) {
  const urls = [
    candidate.href,
    candidate.iframeSrc,
  ].filter(Boolean);

  for (const value of urls) {
    try {
      const decoded = decodeURIComponent(value);

      const creativeMatch = decoded.match(
        /creative[^/]*\/([^/?&#]+)/i
      );

      if (creativeMatch?.[1]) {
        const possibleName = creativeMatch[1]
          .replace(/^\d+[-_]?/, "")
          .replace(/\.(html?|php)$/i, "");

        if (
          possibleName &&
          !/^\d+$/.test(possibleName)
        ) {
          return cleanCompanyName(possibleName);
        }
      }

      const clickTagMatch = decoded.match(
        /clickTag=([^&]+)/i
      );

      if (clickTagMatch?.[1]) {
        const clickUrl = decodeURIComponent(
          clickTagMatch[1]
        );

        const domain = getDomain(clickUrl);

        if (domain) {
          return cleanCompanyName(
            domain.split(".")[0]
          );
        }
      }
    } catch {
      // Ignore malformed tracking URLs.
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
    if (text.toUpperCase().startsWith(label)) {
      text = text.slice(label.length).trim();
      break;
    }
  }

  const firstWord = text.match(
    /^([A-Z][A-Za-z0-9.-]{1,50})\b/
  );

  if (firstWord?.[1]) {
    return cleanCompanyName(firstWord[1]);
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

  const adNetworks = [
    "servedbyadbutler",
    "doubleclick",
    "googlesyndication",
    "googleadservices",
    "adnxs",
    "taboola",
    "outbrain",
    "adform",
  ];

  const networkSignal = adNetworks.some(
    (network) => combined.includes(network)
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
  const articleType = detectArticleType(candidate);

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

  const landingPage =
    candidate.href || candidate.iframeSrc || null;

  const confidence = calculateConfidence({
    candidate,
    type,
    advertiserName,
  });

  return {
    type,
    advertiserName,
    landingPage,
    creativeUrl: candidate.imageUrl || null,
    sourceText: normalizeText(candidate.text).slice(
      0,
      500
    ),
    confidence,
    candidateScore: candidate.score,
  };
}

function classifyCandidates(candidates = []) {
  const results = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const classification =
      classifyCandidate(candidate);

    if (!classification) {
      continue;
    }

    const uniqueKey = [
      classification.type,
      classification.advertiserName,
      classification.landingPage,
    ].join("|");

    if (seen.has(uniqueKey)) {
      continue;
    }

    seen.add(uniqueKey);

    results.push(classification);
  }

  return results.sort(
    (a, b) => b.confidence - a.confidence
  );
}

module.exports = {
  classifyCandidate,
  classifyCandidates,
};