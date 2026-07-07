const crypto = require("crypto");

const { supabase } = require("./supabase");

const BLOCKED_ADVERTISER_DOMAINS = new Set([
  "youtube.com",
  "youtu.be",
  "google.com",
  "googleads.g.doubleclick.net",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "servedbyadbutler.com",
  "adbutler.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
]);

function normalizeWebsiteUrl(value) {
  if (!value) {
    return null;
  }

  const rawValue = String(value).trim();

  try {
    return new URL(rawValue).href;
  } catch {
    try {
      return new URL(
        `https://${rawValue}`
      ).href;
    } catch {
      return null;
    }
  }
}

function normalizeDomain(value) {
  if (!value) {
    return null;
  }

  let rawValue = String(value)
    .trim()
    .toLowerCase();

  try {
    rawValue = new URL(
      rawValue.includes("://")
        ? rawValue
        : `https://${rawValue}`
    ).hostname;
  } catch {
    rawValue = rawValue
      .replace(/^https?:\/\//, "")
      .split("/")[0];
  }

  return rawValue
    .replace(/^www\./, "")
    .replace(/\.$/, "")
    .trim();
}

function normalizeCompanyName(value) {
  if (!value) {
    return null;
  }

  const cleaned = String(value)
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

function normalizeText(
  value,
  maxLength = 5000
) {
  if (!value) {
    return null;
  }

  const cleaned = String(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

  return cleaned || null;
}

function isBlockedAdvertiserDomain(domain) {
  const normalizedDomain =
    normalizeDomain(domain);

  if (!normalizedDomain) {
    return true;
  }

  for (
    const blockedDomain
    of BLOCKED_ADVERTISER_DOMAINS
  ) {
    if (
      normalizedDomain === blockedDomain ||
      normalizedDomain.endsWith(
        `.${blockedDomain}`
      )
    ) {
      return true;
    }
  }

  return false;
}

function getAdvertiserDomain(advertiser) {
  if (advertiser.companyDomain) {
    return normalizeDomain(
      advertiser.companyDomain
    );
  }

  if (advertiser.landingPage) {
    return normalizeDomain(
      advertiser.landingPage
    );
  }

  return null;
}

function getAdvertiserName(advertiser) {
  return normalizeCompanyName(
    advertiser.companyName ||
      advertiser.advertiserName
  );
}

function getLandingPage(advertiser) {
  if (advertiser.companyDomain) {
    const domain = normalizeDomain(
      advertiser.companyDomain
    );

    if (domain) {
      return `https://${domain}`;
    }
  }

  return normalizeWebsiteUrl(
    advertiser.landingPage
  );
}

function normalizeAdType(value) {
  const normalized = String(
    value || ""
  )
    .trim()
    .toLowerCase();

  const allowedTypes = new Set([
    "banner_ad",
    "sponsored_article",
    "native_ad",
    "video_ad",
  ]);

  if (allowedTypes.has(normalized)) {
    return normalized;
  }

  return "banner_ad";
}

function createAdvertisementFingerprint({
  websiteId,
  advertiserId,
  adType,
  creativeUrl,
  sourceUrl,
  destinationUrl,
  contextText,
}) {
  /*
   * A fingerprint identifies the detected ad.
   *
   * We intentionally do not include scan_id.
   * The same ad found during another scan must
   * resolve to the same advertisement record.
   */

  const fingerprintSource = [
    websiteId || "",
    advertiserId || "",
    adType || "",
    creativeUrl || "",
    sourceUrl || "",
    destinationUrl || "",
    contextText || "",
  ]
    .map((value) =>
      String(value)
        .trim()
        .toLowerCase()
    )
    .join("|");

  return crypto
    .createHash("sha256")
    .update(fingerprintSource)
    .digest("hex");
}

function prepareAdvertisers(
  advertisers = []
) {
  const uniqueAdvertisers = new Map();

  for (const advertiser of advertisers) {
    const domain =
      getAdvertiserDomain(advertiser);

    const companyName =
      getAdvertiserName(advertiser);

    if (!domain || !companyName) {
      continue;
    }

    if (
      isBlockedAdvertiserDomain(domain)
    ) {
      console.log(
        `Blocked false positive advertiser: ${companyName} (${domain})`
      );

      continue;
    }

    const existing =
      uniqueAdvertisers.get(domain);

    if (!existing) {
      uniqueAdvertisers.set(
        domain,
        advertiser
      );

      continue;
    }

    const existingConfidence = Number(
      existing.confidence || 0
    );

    const currentConfidence = Number(
      advertiser.confidence || 0
    );

    if (
      currentConfidence >
      existingConfidence
    ) {
      uniqueAdvertisers.set(
        domain,
        advertiser
      );
    }
  }

  return Array.from(
    uniqueAdvertisers.values()
  );
}

async function getWebsiteByUrl(url) {
  const normalizedUrl =
    normalizeWebsiteUrl(url);

  if (!normalizedUrl) {
    throw new Error(
      "Invalid website URL"
    );
  }

  const domain = normalizeDomain(
    normalizedUrl
  );

  const { data, error } = await supabase
    .from("websites")
    .select("*")
    .eq("domain", domain)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to find website: ${error.message}`
    );
  }

  return data;
}

async function upsertMasterAdvertiser(
  advertiser
) {
  const domain =
    getAdvertiserDomain(advertiser);

  const companyName =
    getAdvertiserName(advertiser);

  if (!domain || !companyName) {
    return null;
  }

  const now = new Date().toISOString();

  const {
    data: existingAdvertiser,
    error: findError,
  } = await supabase
    .from("advertisers")
    .select("*")
    .eq("domain", domain)
    .maybeSingle();

  if (findError) {
    throw new Error(
      `Failed to find master advertiser: ${findError.message}`
    );
  }

  if (existingAdvertiser) {
    const {
      data: updatedAdvertiser,
      error: updateError,
    } = await supabase
      .from("advertisers")
      .update({
        company_name: companyName,
        website_url: `https://${domain}`,
        last_seen_at: now,
      })
      .eq(
        "id",
        existingAdvertiser.id
      )
      .select()
      .single();

    if (updateError) {
      throw new Error(
        `Failed to update master advertiser: ${updateError.message}`
      );
    }

    return updatedAdvertiser;
  }

  const {
    data: createdAdvertiser,
    error: createError,
  } = await supabase
    .from("advertisers")
    .insert({
      company_name: companyName,
      domain,
      website_url: `https://${domain}`,
      first_seen_at: now,
      last_seen_at: now,
      status: "new",
    })
    .select()
    .single();

  if (createError) {
    throw new Error(
      `Failed to create master advertiser: ${createError.message}`
    );
  }

  return createdAdvertiser;
}

async function upsertAdvertisement({
  advertiser,
  masterAdvertiser,
  website,
  scan,
}) {
  const now = new Date().toISOString();

  const adType = normalizeAdType(
    advertiser.type
  );

  const creativeUrl =
    normalizeWebsiteUrl(
      advertiser.creativeUrl
    );

  const sourceUrl =
    normalizeWebsiteUrl(
      advertiser.originalLandingPage
    );

  const destinationUrl =
    getLandingPage(advertiser);

  const finalUrl =
    normalizeWebsiteUrl(
      advertiser.landingPage
    ) || destinationUrl;

  const contextText = normalizeText(
    advertiser.sourceText
  );

  const fingerprint =
    createAdvertisementFingerprint({
      websiteId: website.id,
      advertiserId:
        masterAdvertiser.id,
      adType,
      creativeUrl,
      sourceUrl,
      destinationUrl,
      contextText,
    });

  const {
    data: existingAdvertisement,
    error: findError,
  } = await supabase
    .from("advertisements")
    .select("*")
    .eq("fingerprint", fingerprint)
    .maybeSingle();

  if (findError) {
    throw new Error(
      `Failed to find advertisement: ${findError.message}`
    );
  }

  if (existingAdvertisement) {
    const {
      data: updatedAdvertisement,
      error: updateError,
    } = await supabase
      .from("advertisements")
      .update({
        advertiser_id:
          masterAdvertiser.id,

        website_id: website.id,

        scan_id: scan.id,

        last_seen_at: now,

        final_url:
          finalUrl ||
          existingAdvertisement.final_url,

        destination_url:
          destinationUrl ||
          existingAdvertisement.destination_url,

        source_url:
          sourceUrl ||
          existingAdvertisement.source_url,

        image_url:
          creativeUrl ||
          existingAdvertisement.image_url,

        context_text:
          contextText ||
          existingAdvertisement.context_text,
      })
      .eq(
        "id",
        existingAdvertisement.id
      )
      .select()
      .single();

    if (updateError) {
      throw new Error(
        `Failed to update advertisement: ${updateError.message}`
      );
    }

    return {
      advertisement:
        updatedAdvertisement,

      created: false,
    };
  }

  const {
    data: createdAdvertisement,
    error: createError,
  } = await supabase
    .from("advertisements")
    .insert({
      website_id: website.id,

      advertiser_id:
        masterAdvertiser.id,

      scan_id: scan.id,

      ad_type: adType,

      title:
        getAdvertiserName(advertiser),

      image_url: creativeUrl,

source_url:
  sourceUrl ||
  finalUrl ||
  destinationUrl,

destination_url:
  destinationUrl,

final_url: finalUrl,

context_text: contextText,
      fingerprint,

      detected_at: now,

      last_seen_at: now,

      status: "detected",
    })
    .select()
    .single();

  if (createError) {
    throw new Error(
      `Failed to create advertisement: ${createError.message}`
    );
  }

  return {
    advertisement:
      createdAdvertisement,

    created: true,
  };
}

async function saveScanResult(result) {
  const websiteUrl =
    result.requestedUrl ||
    result.finalUrl ||
    result.website;

  const normalizedWebsiteUrl =
    normalizeWebsiteUrl(websiteUrl);

  if (!normalizedWebsiteUrl) {
    throw new Error(
      `Invalid website URL: ${websiteUrl}`
    );
  }

  const website = await getWebsiteByUrl(
    normalizedWebsiteUrl
  );

  if (!website) {
    throw new Error(
      `Website not found in database: ${websiteUrl}`
    );
  }

  const preparedAdvertisers =
    prepareAdvertisers(
      result.advertisers || []
    );

  const advertiserCount =
    preparedAdvertisers.length;

  const scanDurationMs = Number(
    result.scanDurationMs ??
      result.durationMs ??
      0
  );

  const {
    data: scan,
    error: scanError,
  } = await supabase
    .from("scans")
    .insert({
      website_id: website.id,

      requested_url:
        normalizedWebsiteUrl,

      final_url:
        result.finalUrl ||
        normalizedWebsiteUrl,

      page_title:
        result.pageTitle || null,

      http_status:
        result.httpStatus || null,

      duration_ms: scanDurationMs,

      candidate_count: Number(
        result.candidateCount || 0
      ),

      advertiser_count:
        advertiserCount,

      status: result.success
        ? "completed"
        : "failed",
    })
    .select()
    .single();

  if (scanError) {
    throw new Error(
      `Failed to save scan: ${scanError.message}`
    );
  }

  const scanAdvertisers = [];

  let createdAdvertisements = 0;
  let updatedAdvertisements = 0;

  for (
    const advertiser
    of preparedAdvertisers
  ) {
    const masterAdvertiser =
      await upsertMasterAdvertiser(
        advertiser
      );

    if (!masterAdvertiser) {
      continue;
    }

    const advertisementResult =
      await upsertAdvertisement({
        advertiser,
        masterAdvertiser,
        website,
        scan,
      });

    if (advertisementResult.created) {
      createdAdvertisements += 1;
    } else {
      updatedAdvertisements += 1;
    }

    scanAdvertisers.push({
      scan_id: scan.id,

      website_id: website.id,

      advertiser_id:
        masterAdvertiser.id,

      type:
        advertiser.type || null,

      advertiser_name:
        getAdvertiserName(advertiser),

      landing_page:
        getLandingPage(advertiser),

      original_landing_page:
        advertiser.originalLandingPage ||
        null,

      creative_url:
        advertiser.creativeUrl || null,

      source_text:
        advertiser.sourceText || null,

      confidence:
        advertiser.confidence || null,

      candidate_score:
        advertiser.candidateScore || null,

      landing_page_resolved:
        Boolean(
          advertiser.companyDomain ||
            advertiser.landingPageResolved
        ),
    });
  }

  if (scanAdvertisers.length > 0) {
    const {
      error: advertisersError,
    } = await supabase
      .from("scan_advertisers")
      .insert(scanAdvertisers);

    if (advertisersError) {
      throw new Error(
        `Failed to save scan advertisers: ${advertisersError.message}`
      );
    }
  }

  const {
    error: websiteUpdateError,
  } = await supabase
    .from("websites")
    .update({
      last_scanned_at:
        new Date().toISOString(),

      next_scan_at: new Date(
        Date.now() +
          Number(
            website.scan_frequency_minutes ||
              60
          ) *
            60 *
            1000
      ).toISOString(),

      scan_status: result.success
        ? "completed"
        : "failed",

      total_ads_found:
        Number(
          website.total_ads_found || 0
        ) + scanAdvertisers.length,
    })
    .eq("id", website.id);

  if (websiteUpdateError) {
    throw new Error(
      `Failed to update website: ${websiteUpdateError.message}`
    );
  }

  console.log(
    `Saved scan ${scan.id}: ${scanAdvertisers.length} advertisers`
  );

  console.log(
    `Advertisements: ${createdAdvertisements} created, ${updatedAdvertisements} updated`
  );

  return {
    scanId: scan.id,

    websiteId: website.id,

    savedAdvertisers:
      scanAdvertisers.length,

    createdAdvertisements,

    updatedAdvertisements,
  };
}

module.exports = {
  saveScanResult,
};