const { supabase } = require("./supabase");

const {
  scanWebsite,
} = require("./scanner");

const {
  saveScanResult,
} = require("./storage");

const {
  runCampaignExecutor,
} = require("./campaignExecutor");

const {
  runReplyDetector,
} = require("./replyDetector");

const {
  runReplyClassifier,
} = require("./replyClassifier");

const CONCURRENCY_LIMIT = 3;

let scanSchedulerRunning = false;
let campaignExecutorRunning = false;
let replyPipelineRunning = false;

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

async function scanScheduledWebsite(
  website
) {
  try {
    console.log(
      `Scanning: ${website.name}`
    );

    const result = await scanWebsite({
      url: website.url,
      waitTimeMs: 5000,
      maxScrolls: 5,
    });

    if (!result.success) {
      console.error(
        `Scan failed: ${website.name}`
      );

      return {
        websiteId: website.id,
        status: "failed",
      };
    }

    await saveScanResult(result);

    await updateNextScan(website);

    console.log(
      `Completed: ${website.name}`
    );

    return {
      websiteId: website.id,
      status: "completed",
    };
  } catch (error) {
    console.error(
      `Scheduled scan failed for ${website.name}:`,
      error.message
    );

    return {
      websiteId: website.id,
      status: "failed",
      error: error.message,
    };
  }
}

async function runScheduledScans() {
  if (scanSchedulerRunning) {
    console.log(
      "Scan scheduler already running. Skipping check."
    );

    return [];
  }

  scanSchedulerRunning = true;

  try {
    console.log(
      "\n========== SCAN SCHEDULER =========="
    );

    console.log(
      "Checking for due websites..."
    );

    const websites =
      await getDueWebsites();

    console.log(
      `Found ${websites.length} due websites`
    );

    const results = [];

    for (
      let index = 0;
      index < websites.length;
      index += CONCURRENCY_LIMIT
    ) {
      const batch = websites.slice(
        index,
        index + CONCURRENCY_LIMIT
      );

      const batchResults =
        await Promise.all(
          batch.map((website) =>
            scanScheduledWebsite(website)
          )
        );

      results.push(...batchResults);
    }

    return results;
  } catch (error) {
    console.error(
      "Scan scheduler error:",
      error.message
    );

    return [];
  } finally {
    scanSchedulerRunning = false;

    console.log(
      "Scan scheduler cycle completed."
    );
  }
}

async function runScheduledCampaigns() {
  if (campaignExecutorRunning) {
    console.log(
      "Campaign executor already running. Skipping cycle."
    );

    return [];
  }

  campaignExecutorRunning = true;

  try {
    console.log(
      "\n========== CAMPAIGN SCHEDULER =========="
    );

    const results =
      await runCampaignExecutor();

    console.log(
      "Campaign scheduler cycle completed."
    );

    return results;
  } catch (error) {
    console.error(
      "Campaign scheduler error:",
      error.message
    );

    return [];
  } finally {
    campaignExecutorRunning = false;
  }
}

async function runScheduledReplies() {
  if (replyPipelineRunning) {
    console.log(
      "Reply pipeline already running. Skipping cycle."
    );

    return {
      detectorResults: [],
      classifierResults: [],
      skipped: true,
    };
  }

  replyPipelineRunning = true;

  try {
    console.log(
      "\n========== REPLY PIPELINE =========="
    );

    console.log(
      "Running reply detector..."
    );

    const detectorResults =
      await runReplyDetector();

    console.log(
      "Reply detector completed."
    );

    console.log(
      "Running reply classifier..."
    );

    const classifierResults =
      await runReplyClassifier();

    console.log(
      "Reply classifier completed."
    );

    console.log(
      "Reply pipeline cycle completed."
    );

    return {
      detectorResults,
      classifierResults,
      skipped: false,
    };
  } catch (error) {
    console.error(
      "Reply pipeline error:",
      error.message
    );

    return {
      detectorResults: [],
      classifierResults: [],
      skipped: false,
      error: error.message,
    };
  } finally {
    replyPipelineRunning = false;
  }
}

async function runAutomationCycle() {
  console.log(
    "\n========================================"
  );

  console.log(
    "BUZON AUTOMATION CYCLE STARTED"
  );

  console.log(
    "========================================"
  );

  const startedAt = Date.now();

  const results =
    await Promise.allSettled([
      runScheduledScans(),
      runScheduledCampaigns(),
      runScheduledReplies(),
    ]);

  const scanResult = results[0];
  const campaignResult = results[1];
  const replyResult = results[2];

  if (scanResult.status === "rejected") {
    console.error(
      "Scan automation cycle rejected:",
      scanResult.reason
    );
  }

  if (
    campaignResult.status === "rejected"
  ) {
    console.error(
      "Campaign automation cycle rejected:",
      campaignResult.reason
    );
  }

  if (replyResult.status === "rejected") {
    console.error(
      "Reply automation cycle rejected:",
      replyResult.reason
    );
  }

  const durationSeconds = (
    (Date.now() - startedAt) /
    1000
  ).toFixed(2);

  console.log(
    "\n========================================"
  );

  console.log(
    `BUZON AUTOMATION CYCLE COMPLETED IN ${durationSeconds}s`
  );

  console.log(
    "========================================"
  );

  return {
    scanResult,
    campaignResult,
    replyResult,
  };
}

module.exports = {
  getDueWebsites,
  updateNextScan,
  scanScheduledWebsite,
  runScheduledScans,
  runScheduledCampaigns,
  runScheduledReplies,
  runAutomationCycle,
};