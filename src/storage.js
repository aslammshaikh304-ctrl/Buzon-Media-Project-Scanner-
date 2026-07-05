const { supabase } = require("./supabase");

async function getWebsiteByUrl(url) {
  let domain;

  try {
    domain = new URL(url).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    throw new Error("Invalid website URL");
  }

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

async function saveScanResult(result) {
  const website = await getWebsiteByUrl(
    result.requestedUrl
  );

  if (!website) {
    throw new Error(
      `Website not found in database: ${result.requestedUrl}`
    );
  }

  const { data: scan, error: scanError } =
    await supabase
      .from("scans")
      .insert({
        website_id: website.id,
        requested_url: result.requestedUrl,
        final_url: result.finalUrl,
        page_title: result.pageTitle,
        http_status: result.httpStatus,
        duration_ms: result.durationMs,
        candidate_count: result.candidateCount,
        advertiser_count: result.advertiserCount,
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

  const advertisers = (
    result.advertisers || []
  ).map((advertiser) => ({
    scan_id: scan.id,
    website_id: website.id,
    type: advertiser.type,
    advertiser_name:
      advertiser.advertiserName,
    landing_page: advertiser.landingPage,
    original_landing_page:
      advertiser.originalLandingPage || null,
    creative_url:
      advertiser.creativeUrl || null,
    source_text:
      advertiser.sourceText || null,
    confidence:
      advertiser.confidence || null,
    candidate_score:
      advertiser.candidateScore || null,
    landing_page_resolved:
      advertiser.landingPageResolved || false,
  }));

  if (advertisers.length > 0) {
    const { error: advertisersError } =
      await supabase
        .from("scan_advertisers")
        .insert(advertisers);

    if (advertisersError) {
      throw new Error(
        `Failed to save advertisers: ${advertisersError.message}`
      );
    }
  }

  const { error: websiteUpdateError } =
    await supabase
      .from("websites")
      .update({
        last_scanned_at: new Date().toISOString(),
        next_scan_at: new Date(
          Date.now() +
            website.scan_frequency_minutes *
              60 *
              1000
        ).toISOString(),
        scan_status: result.success
          ? "completed"
          : "failed",
        total_ads_found:
          Number(website.total_ads_found || 0) +
          Number(result.advertiserCount || 0),
      })
      .eq("id", website.id);

  if (websiteUpdateError) {
    throw new Error(
      `Failed to update website: ${websiteUpdateError.message}`
    );
  }

  return {
    scanId: scan.id,
    websiteId: website.id,
    savedAdvertisers: advertisers.length,
  };
}

module.exports = {
  saveScanResult,
};