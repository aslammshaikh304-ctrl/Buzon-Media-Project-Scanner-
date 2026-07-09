const { supabase } = require("./supabase");

const TEST_DELAY_DAYS = 3;

async function getTestCampaignLead() {
  const { data, error } = await supabase
    .from("campaign_leads")
    .select(`
      id,
      campaign_id,
      advertiser_id,
      status,
      follow_up_count,
      next_follow_up_at,
      advertisers (
        company_name
      )
    `)
    .in("status", [
      "pending",
      "queued",
      "sent",
    ])
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

function createFollowUpDate() {
  return new Date(
    Date.now() +
      TEST_DELAY_DAYS *
        24 *
        60 *
        60 *
        1000
  ).toISOString();
}

async function scheduleTestFollowUp(
  campaignLead
) {
  const nextFollowUpAt =
    createFollowUpDate();

  const { data, error } = await supabase
    .from("campaign_leads")
    .update({
      status: "sent",
      failure_reason: null,
      follow_up_count: 0,
      next_follow_up_at:
        nextFollowUpAt,
    })
    .eq("id", campaignLead.id)
    .select(`
      id,
      status,
      follow_up_count,
      next_follow_up_at
    `)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function verifyScheduledLead(
  campaignLeadId
) {
  const { data, error } = await supabase
    .from("campaign_leads")
    .select(`
      id,
      status,
      follow_up_count,
      next_follow_up_at
    `)
    .eq("id", campaignLeadId)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function main() {
  console.log(
    "\n========== FOLLOW-UP SCHEDULING TEST =========="
  );

  try {
    console.log(
      "\n1. Finding test campaign lead..."
    );

    const campaignLead =
      await getTestCampaignLead();

    if (!campaignLead) {
      console.log(
        "No campaign lead available for testing."
      );

      return;
    }

    console.log("Test lead:", {
      id: campaignLead.id,
      company:
        campaignLead.advertisers
          ?.company_name,
      status: campaignLead.status,
      followUpCount:
        campaignLead.follow_up_count,
      nextFollowUpAt:
        campaignLead.next_follow_up_at,
    });

    console.log(
      "\n2. Scheduling first follow-up..."
    );

    const scheduledLead =
      await scheduleTestFollowUp(
        campaignLead
      );

    console.log(
      "Scheduled lead:",
      scheduledLead
    );

    console.log(
      "\n3. Verifying database state..."
    );

    const verifiedLead =
      await verifyScheduledLead(
        campaignLead.id
      );

    console.log(
      "Verified lead:",
      verifiedLead
    );

    const passed =
      verifiedLead.status === "sent" &&
      verifiedLead.follow_up_count === 0 &&
      Boolean(
        verifiedLead.next_follow_up_at
      );

    console.log(
      "\n========== TEST RESULT =========="
    );

    console.log(
      passed
        ? "PASSED: Follow-up scheduling works"
        : "FAILED: Follow-up scheduling is incorrect"
    );

    console.log(
      "================================="
    );
  } catch (error) {
    console.error(
      "Follow-up scheduling test failed:",
      error
    );

    process.exitCode = 1;
  }
}

main();