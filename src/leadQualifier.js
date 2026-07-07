const HIGH_VALUE_EMAIL_PREFIXES = new Set([
  "sales",
  "advertise",
  "advertising",
  "partnership",
  "partnerships",
  "business",
  "marketing",
  "media",
]);

const MEDIUM_VALUE_EMAIL_PREFIXES = new Set([
  "contact",
  "hello",
  "info",
  "press",
  "pr",
]);

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getEmailPrefix(email) {
  if (!email || !email.includes("@")) {
    return null;
  }

  return normalizeText(
    email.split("@")[0]
  );
}

function clampScore(score) {
  return Math.max(
    0,
    Math.min(100, score)
  );
}

function qualifyLead(
  advertiser,
  contact = null
) {
  let score = 0;
  const reasons = [];

  const companyName = normalizeText(
    advertiser?.company_name
  );

  const domain = normalizeText(
    advertiser?.domain
  );

  const websiteUrl =
    advertiser?.website_url || null;

  const category = normalizeText(
    advertiser?.category
  );

  const email = normalizeText(
    contact?.email
  );

  const emailScore = Number(
    contact?.emailScore || 0
  );

  const emailPrefix =
    getEmailPrefix(email);

  if (companyName) {
    score += 5;
    reasons.push("company identified");
  }

  if (domain) {
    score += 10;
    reasons.push("company domain found");
  }

  if (websiteUrl) {
    score += 5;
    reasons.push("website resolved");
  }

  if (email) {
    score += 20;
    reasons.push("email found");

    if (
      HIGH_VALUE_EMAIL_PREFIXES.has(
        emailPrefix
      )
    ) {
      score += 20;
      reasons.push(
        "high-value business email"
      );
    } else if (
      MEDIUM_VALUE_EMAIL_PREFIXES.has(
        emailPrefix
      )
    ) {
      score += 10;
      reasons.push(
        "general business email"
      );
    }

    if (emailScore >= 80) {
      score += 10;
      reasons.push(
        "high email confidence"
      );
    } else if (emailScore >= 50) {
      score += 5;
      reasons.push(
        "medium email confidence"
      );
    }
  }

  if (contact?.linkedin) {
    score += 10;
    reasons.push("linkedin found");
  }

  if (contact?.contactFormUrl) {
    score += 10;
    reasons.push(
      "contact page found"
    );
  }

  if (contact?.telegram) {
    score += 5;
    reasons.push("telegram found");
  }

  if (contact?.twitter) {
    score += 5;
    reasons.push("twitter found");
  }

  const highIntentCategories = [
    "crypto",
    "casino",
    "gambling",
    "finance",
    "fintech",
    "trading",
    "exchange",
    "gaming",
  ];

  if (
    highIntentCategories.some(
      (keyword) =>
        category.includes(keyword)
    )
  ) {
    score += 10;
    reasons.push(
      "high-value advertiser category"
    );
  }

  score = clampScore(score);

  let leadPriority = "cold";
  let qualificationStatus =
    "qualified";

  if (score >= 70) {
    leadPriority = "hot";
  } else if (score >= 40) {
    leadPriority = "warm";
  }

  if (
    !email &&
    !contact?.linkedin &&
    !contact?.contactFormUrl &&
    !contact?.telegram &&
    !contact?.twitter
  ) {
    qualificationStatus = "rejected";
    reasons.push(
      "no reachable contact channel"
    );
  }

  const result = {
    advertiserId: advertiser?.id,
    companyName:
      advertiser?.company_name,

    leadScore: score,
    leadPriority,
    qualificationStatus,

    qualificationReason:
      reasons.join(", "),

    qualifiedAt:
      new Date().toISOString(),
  };

  console.log(
    `Lead qualified: ${result.companyName}`,
    result
  );

  return result;
}

module.exports = {
  qualifyLead,
};