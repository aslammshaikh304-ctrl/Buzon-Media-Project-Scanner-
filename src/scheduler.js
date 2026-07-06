const { supabase } = require("./supabase");
const { scanWebsite } = require("./scanner");
const { saveScanResult } = require("./storage");

const CONCURRENCY_LIMIT = 3;

let schedulerRunning = false;

async function getDueWebsites() {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("websites")
    .select("*")
    .eq("is_active", true)
    .lte("next_scan_at", now);

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

async function updateNextScan(website) {
  const frequency =
    website.scan_frequency_minutes || 60;

  const nextScanAt = new Date(
    Date.now() + frequency * 60 * 1000
  ).toISOString();

  const { error } = await supabase
    .from("websites")
    .update({
      next_scan_at: nextScanAt,
    })
    .eq("id", website.id);

  if (error) {
    throw new Error(error.message);
  }
}

async function scanScheduledWebsite(website) {
  try {
    console.log(`Scanning: ${website.name}`);

    const result = await scanWebsite({
      url: website.url,
      waitTimeMs: 5000,
      maxScrolls: 5,
    });

    if (!result.success) {
      console.error(
        `Scan failed: ${website.name}`
      );

      return;
    }

    await saveScanResult(result);

    await updateNextScan(website);

    console.log(`Completed: ${website.name}`);
  } catch (error) {
    console.error(
      `Scheduled scan failed for ${website.name}:`,
      error.message
    );
  }
}

async function runScheduledScans() {
  if (schedulerRunning) {
    console.log(
      "Scheduler already running. Skipping check."
    );

    return;
  }

  schedulerRunning = true;

  try {
    console.log("Checking for due websites...");

    const websites = await getDueWebsites();

    console.log(
      `Found ${websites.length} due websites`
    );

    for (
      let index = 0;
      index < websites.length;
      index += CONCURRENCY_LIMIT
    ) {
      const batch = websites.slice(
        index,
        index + CONCURRENCY_LIMIT
      );

      await Promise.all(
        batch.map((website) =>
          scanScheduledWebsite(website)
        )
      );
    }
  } catch (error) {
    console.error(
      "Scheduler error:",
      error.message
    );
  } finally {
    schedulerRunning = false;

    console.log("Scheduler cycle completed.");
  }
}

module.exports = {
  runScheduledScans,
};