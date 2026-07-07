require("dotenv").config();

const OpenAI = require("openai");

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

function cleanText(value, maxLength = 1000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
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

function getRootDomain(value) {
  const hostname = getHostname(value);

  if (!hostname) {
    return null;
  }

  const parts = hostname.split(".");

  if (parts.length < 2) {
    return hostname;
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
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
}

function cleanCompanyName(value) {
  if (!value) {
    return null;
  }

  const cleaned = cleanText(value, 120)
    .replace(/^www\./i, "")
    .replace(
      /\.(com|io|co|net|org|ai|app|xyz|care)$/i,
      ""
    )
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 2) {
    return null;
  }

  return cleaned;
}

function companyNameFromDomain(domain) {
  if (!domain) {
    return null;
  }

  const parts = domain.split(".");

  if (!parts.length) {
    return null;
  }

  return cleanCompanyName(parts[0]);
}

function normalizeResult(result) {
  if (!result || typeof result !== "object") {
    return null;
  }

  return {
    companyName:
      cleanCompanyName(result.companyName),

    confidence: Math.max(
      0,
      Math.min(
        Number(result.confidence || 0),
        100
      )
    ),

    reason:
      cleanText(result.reason, 500) || null,
  };
}

async function enrichSingleAdvertiser(
  advertiser
) {
  const companyDomain = getRootDomain(
    advertiser.landingPage
  );

  if (!companyDomain) {
    return {
      ...advertiser,
      enriched: false,
      enrichmentError:
        "No resolved landing page domain",
    };
  }

  const fallbackCompanyName =
    cleanCompanyName(
      advertiser.advertiserName
    ) ||
    companyNameFromDomain(companyDomain);

  if (!client) {
    console.log(
      "OPENAI_API_KEY missing. Using domain fallback:",
      companyDomain
    );

    if (!fallbackCompanyName) {
      return {
        ...advertiser,
        enriched: false,
        enrichmentError:
          "Unable to determine company name",
      };
    }

    return {
      ...advertiser,

      enriched: true,

      enrichment: {
        isRealAdvertiser: true,
        companyName:
          fallbackCompanyName,
        companyDomain,
        confidence: 80,
        reason:
          "Advertiser identity derived from resolved landing page domain.",
      },

      enrichmentWarning:
        "OPENAI_API_KEY missing",
    };
  }

  const input = {
    advertiserName:
      advertiser.advertiserName || null,

    companyDomain,

    landingPage:
      advertiser.landingPage || null,

    sourceText:
      cleanText(
        advertiser.sourceText,
        700
      ),
  };

  try {
    const response =
      await client.responses.create({
        model: "gpt-4.1-mini",

        instructions: `
You clean advertiser identity data.

The advertiser landing page has already been
resolved by the browser scanner.

Your job is NOT to decide whether an ad exists.

Your job is to return the clean public brand name
for the supplied company domain.

Rules:

1. companyDomain is the resolved advertiser domain.
2. Do not change companyDomain.
3. advertiserName may contain useful ad metadata.
4. Prefer the explicit advertiserName when it is a clean brand name.
5. Otherwise derive a readable brand name from companyDomain.
6. Do not invent a different company or domain.
7. Return a short public brand name.
8. confidence must be 0 to 100.

Return JSON only.
        `.trim(),

        input: JSON.stringify(input),

        text: {
          format: {
            type: "json_schema",
            name: "advertiser_enrichment",
            strict: true,
            schema: {
              type: "object",

              properties: {
                companyName: {
                  type: "string",
                },

                confidence: {
                  type: "number",
                },

                reason: {
                  type: [
                    "string",
                    "null",
                  ],
                },
              },

              required: [
                "companyName",
                "confidence",
                "reason",
              ],

              additionalProperties: false,
            },
          },
        },
      });

    const parsed = JSON.parse(
      response.output_text
    );

    const normalized =
      normalizeResult(parsed);

    const companyName =
      normalized?.companyName ||
      fallbackCompanyName;

    if (!companyName) {
      return {
        ...advertiser,
        enriched: false,
        enrichmentError:
          "Unable to determine company name",
      };
    }

    return {
      ...advertiser,

      enriched: true,

      enrichment: {
        isRealAdvertiser: true,
        companyName,
        companyDomain,
        confidence:
          normalized?.confidence || 80,
        reason:
          normalized?.reason ||
          "Resolved landing page domain supports advertiser identity.",
      },
    };
  } catch (error) {
    console.log(
      "AI enrichment failed:",
      error.message
    );

    if (!fallbackCompanyName) {
      return {
        ...advertiser,
        enriched: false,
        enrichmentError: error.message,
      };
    }

    return {
      ...advertiser,

      enriched: true,

      enrichment: {
        isRealAdvertiser: true,
        companyName:
          fallbackCompanyName,
        companyDomain,
        confidence: 80,
        reason:
          "Advertiser identity derived from resolved landing page domain.",
      },

      enrichmentWarning:
        error.message,
    };
  }
}

async function enrichAdvertisers(
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
        enrichSingleAdvertiser(advertiser)
      )
    );

    results.push(...batchResults);
  }

  return results;
}

module.exports = {
  enrichAdvertisers,
};