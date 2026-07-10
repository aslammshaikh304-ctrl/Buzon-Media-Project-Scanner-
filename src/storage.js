const crypto = require("crypto");

const { supabase } = require("./supabase");

const {
  discoverContacts,
} = require("./contactDiscovery");

const {
  saveDiscoveredContact,
} = require("./contactStorage");

const {
  qualifyLead,
} = require("./leadQualifier");

/* ========================================
   BLOCKED ADVERTISER DOMAINS
======================================== */

const BLOCKED_ADVERTISER_DOMAINS =
  new Set([
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

/* ========================================
   URL NORMALIZATION
======================================== */

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

/* ========================================
   DOMAIN NORMALIZATION
======================================== */

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

/* ========================================
   COMPANY NAME NORMALIZATION
======================================== */

function normalizeCompanyName(value) {
  if (!value) {
    return null;
  }

  const cleaned = String(value)
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

/* ========================================
   TEXT NORMALIZATION
======================================== */

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

/* ========================================
   BLOCKED DOMAIN CHECK
======================================== */

function isBlockedAdvertiserDomain(
  domain
) {
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

/* ========================================
   ADVERTISER DOMAIN
======================================== */

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

/* ========================================
   ADVERTISER NAME
======================================== */

function getAdvertiserName(advertiser) {
  return normalizeCompanyName(
    advertiser.companyName ||
      advertiser.advertiserName
  );
}

/* ========================================
   LANDING PAGE
======================================== */

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

/* ========================================
   AD TYPE
======================================== */

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

/* ========================================
   ADVERTISEMENT FINGERPRINT
======================================== */

function createAdvertisementFingerprint({
  websiteId,
  advertiserId,
  adType,
  creativeUrl,
  sourceUrl,
  destinationUrl,
  contextText,
}) {
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

/* ========================================
   PREPARE UNIQUE ADVERTISERS
======================================== */

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
/* ========================================
   GET WEBSITE
======================================== */

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

/* ========================================
   UPSERT MASTER ADVERTISER
======================================== */

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

/* ========================================
   UPSERT ADVERTISEMENT
======================================== */

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

/* ========================================
   GET ACTIVE CAMPAIGN
======================================== */

async function getActiveCampaign() {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("status", "active")
    .order("created_at", {
      ascending: true,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to find active campaign: ${error.message}`
    );
  }

  return data;
}

/* ========================================
   AUTO ENROLL ADVERTISER
======================================== */

async function autoEnrollAdvertiser({
  advertiser,
  discoveredContact,
}) {
  if (!advertiser?.id) {
    return {
      enrolled: false,
      reason: "advertiser_missing",
    };
  }

  if (!discoveredContact?.email) {
    return {
      enrolled: false,
      reason: "email_missing",
    };
  }

  const campaign =
    await getActiveCampaign();

  if (!campaign) {
    console.log(
      `No active campaign. Auto enrollment skipped: ${advertiser.company_name}`
    );

    return {
      enrolled: false,
      reason: "active_campaign_missing",
    };
  }

  const {
    data: existingCampaignLead,
    error: lookupError,
  } = await supabase
    .from("campaign_leads")
    .select("id, status")
    .eq("campaign_id", campaign.id)
    .eq("advertiser_id", advertiser.id)
    .maybeSingle();

  if (lookupError) {
    throw new Error(
      `Campaign lead lookup failed: ${lookupError.message}`
    );
  }

  if (existingCampaignLead) {
    console.log(
      `Campaign lead already exists: ${advertiser.company_name}`
    );

    return {
      enrolled: false,
      reason: "already_enrolled",
      campaignId: campaign.id,
      campaignLeadId:
        existingCampaignLead.id,
    };
  }

  const {
    data: campaignLead,
    error: insertError,
  } = await supabase
    .from("campaign_leads")
    .insert({
      campaign_id: campaign.id,
      advertiser_id: advertiser.id,
      status: "pending",
      follow_up_count: 0,
      failure_reason: null,
    })
    .select()
    .single();

  if (insertError) {
    throw new Error(
      `Campaign enrollment failed: ${insertError.message}`
    );
  }

  console.log(
    `AUTO ENROLLED: ${advertiser.company_name} → ${campaign.name}`
  );

  return {
    enrolled: true,
    campaignId: campaign.id,
    campaignName: campaign.name,
    campaignLeadId: campaignLead.id,
  };
}
/* ========================================
   SAVE SCAN RESULT
======================================== */

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

  const website =
    await getWebsiteByUrl(
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

    if (
      advertisementResult.created
    ) {
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
        advertiser.creativeUrl ||
        null,

      source_text:
        advertiser.sourceText ||
        null,

      confidence:
        advertiser.confidence ||
        null,

      candidate_score:
        advertiser.candidateScore ||
        null,

      landing_page_resolved:
        Boolean(
          advertiser.companyDomain ||
            advertiser
              .landingPageResolved
        ),
    });
  }

  if (
    scanAdvertisers.length > 0
  ) {
    const {
      error: scanAdvertisersError,
    } = await supabase
      .from("scan_advertisers")
      .insert(scanAdvertisers);

    if (scanAdvertisersError) {
      throw new Error(
        `Failed to save scan advertisers: ${scanAdvertisersError.message}`
      );
    }
  }

  console.log(
    `Scan stored: ${website.name}`
  );

  console.log(
    `Advertisers processed: ${scanAdvertisers.length}`
  );

  console.log(
    `Advertisements created: ${createdAdvertisements}`
  );

  console.log(
    `Advertisements updated: ${updatedAdvertisements}`
  );

  /*
   * ========================================
   * ADVERTISER INTELLIGENCE + OUTREACH
   * ========================================
   *
   * Every verified advertiser detected:
   *
   * 1. Discover contact
   * 2. Save contact
   * 3. Score lead
   * 4. Save intelligence
   * 5. If valid email exists:
   *    auto-enroll into active campaign
   *
   * Hot / Warm / Cold DOES NOT block
   * campaign enrollment.
   */

  const intelligenceResults = [];

  for (
    const scanAdvertiser
    of scanAdvertisers
  ) {
    const advertiserId =
      scanAdvertiser.advertiser_id;

    try {
      const {
        data: advertiser,
        error: advertiserError,
      } = await supabase
        .from("advertisers")
        .select("*")
        .eq("id", advertiserId)
        .single();

      if (
        advertiserError ||
        !advertiser
      ) {
        throw new Error(
          advertiserError?.message ||
            "Advertiser not found"
        );
      }

      console.log(
        "\n================================"
      );

      console.log(
        `Processing advertiser intelligence: ${advertiser.company_name}`
      );

      /*
       * CONTACT DISCOVERY
       */

      let discoveredContact = null;

      try {
        discoveredContact =
          await discoverContacts(
            advertiser,
            website.domain
          );

        console.log(
          `Contact discovery completed: ${advertiser.company_name}`
        );
      } catch (error) {
        console.error(
          `Contact discovery failed for ${advertiser.company_name}:`,
          error.message
        );
      }

      /*
       * CONTACT STORAGE
       */

      if (discoveredContact) {
        try {
          await saveDiscoveredContact(
            discoveredContact
          );

          console.log(
            `Contact storage completed: ${advertiser.company_name}`
          );
        } catch (error) {
          console.error(
            `Contact storage failed for ${advertiser.company_name}:`,
            error.message
          );
        }
      }

      /*
       * LEAD INTELLIGENCE
       *
       * Score is intelligence only.
       * It does not control outreach.
       */

      const qualification =
        qualifyLead(
          advertiser,
          discoveredContact
        );

      /*
       * UPDATE ADVERTISER INTELLIGENCE
       */

      const {
        error: qualificationError,
      } = await supabase
        .from("advertisers")
        .update({
          lead_score:
            qualification.leadScore,

          lead_priority:
            qualification.leadPriority,

          qualification_status:
            qualification
              .qualificationStatus,

          qualification_reason:
            qualification
              .qualificationReason,

          qualified_at:
            qualification.qualifiedAt,
        })
        .eq("id", advertiser.id);

      if (qualificationError) {
        throw new Error(
          `Advertiser intelligence update failed: ${qualificationError.message}`
        );
      }

      console.log(
        `Advertiser intelligence updated: ${advertiser.company_name}`
      );

      console.log(
        `Score: ${qualification.leadScore}`
      );

      console.log(
        `Priority: ${qualification.leadPriority}`
      );

      console.log(
        `Qualification status: ${qualification.qualificationStatus}`
      );

      /*
       * AUTO CAMPAIGN ENROLLMENT
       *
       * Valid advertiser email is the
       * outreach gate.
       */

      let enrollmentResult = {
        enrolled: false,
        reason: "email_missing",
      };

      if (
        discoveredContact?.email
      ) {
        enrollmentResult =
          await autoEnrollAdvertiser({
            advertiser,
            discoveredContact,
          });
      }

      intelligenceResults.push({
        advertiserId:
          advertiser.id,

        companyName:
          advertiser.company_name,

        contactDiscovered:
          Boolean(discoveredContact),

        email:
          discoveredContact?.email ||
          null,

        leadScore:
          qualification.leadScore,

        leadPriority:
          qualification.leadPriority,

        qualificationStatus:
          qualification
            .qualificationStatus,

        campaignEnrolled:
          enrollmentResult.enrolled,

        campaignEnrollmentReason:
          enrollmentResult.reason ||
          null,

        campaignId:
          enrollmentResult.campaignId ||
          null,

        campaignName:
          enrollmentResult.campaignName ||
          null,

        campaignLeadId:
          enrollmentResult
            .campaignLeadId ||
          null,

        success: true,
      });
    } catch (error) {
      console.error(
        `Advertiser intelligence failed for ${advertiserId}:`,
        error.message
      );

      intelligenceResults.push({
        advertiserId,

        success: false,

        error: error.message,
      });
    }
  }
    /*
   * ========================================
   * FINAL SCAN SUMMARY
   * ========================================
   */

  const campaignEnrolledCount =
    intelligenceResults.filter(
      (result) =>
        result.success === true &&
        result.campaignEnrolled === true
    ).length;

  const reachableAdvertiserCount =
    intelligenceResults.filter(
      (result) =>
        result.success === true &&
        Boolean(result.email)
    ).length;

  const failedIntelligenceCount =
    intelligenceResults.filter(
      (result) =>
        result.success === false
    ).length;

  console.log(
    "\n================================"
  );

  console.log(
    "SCAN STORAGE SUMMARY"
  );

  console.log(
    "================================"
  );

  console.log(
    `Website: ${website.name}`
  );

  console.log(
    `Advertisers detected: ${scanAdvertisers.length}`
  );

  console.log(
    `Reachable advertisers: ${reachableAdvertiserCount}`
  );

  console.log(
    `Auto-enrolled advertisers: ${campaignEnrolledCount}`
  );

  console.log(
    `Intelligence failures: ${failedIntelligenceCount}`
  );

  console.log(
    "================================\n"
  );

  return {
    success: true,

    scanId: scan.id,

    websiteId: website.id,

    websiteName: website.name,

    advertisersProcessed:
      scanAdvertisers.length,

    advertiserCount:
      scanAdvertisers.length,

    advertisementsCreated:
      createdAdvertisements,

    advertisementsUpdated:
      updatedAdvertisements,

    reachableAdvertisers:
      reachableAdvertiserCount,

    campaignEnrolled:
      campaignEnrolledCount,

    intelligenceFailures:
      failedIntelligenceCount,

    intelligenceResults,
  };
}

/* ========================================
   EXPORTS
======================================== */

module.exports = {
  normalizeDomain,

  normalizeWebsiteUrl,

  normalizeText,

  normalizeAdType,

  getAdvertiserDomain,

  getAdvertiserName,

  getLandingPage,

  prepareAdvertisers,

  createAdvertisementFingerprint,

  getWebsiteByUrl,

  upsertMasterAdvertiser,

  upsertAdvertisement,

  getActiveCampaign,

  autoEnrollAdvertiser,

  saveScanResult,
};