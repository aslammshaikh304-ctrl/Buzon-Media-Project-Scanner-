const { supabase } = require("./supabase");

const {
  runFollowUpExecutor,
} = require("./followUpExecutor");

async function getScheduledLead() {
  const { data, error } = await supabase
    .from("campaign_leads")
    .select(`
      id,
      status,
      follow_up_count,
      next_follow_up_at,
      advertisers (
        company_name
      )
    `)
    .eq("status", "sent")
    .not("next_follow_up_at", "is", null)
    .order("next_follow_up_at", {
      ascending: true,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function forceFollowUpDue(
  campaignLeadId
) {
  const dueAt = new Date(
    Date.now() - 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("campaign_leads")
    .update({
      next_follow_up_at: dueAt,
    })
    .eq("id", campaignLeadId)
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

async function getLeadState(
  campaignLeadId
) {
  const { data, error } = await supabase
    .from("campaign_leads")
    .select(`
      id,
      status,
      follow_up_count,
      next_follow_up_at,
      failure_reason
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
    "\n========== DUE FOLLOW-UP TEST =========="
  );

  try {
    console.log(
      "\n1. Finding scheduled lead..."
    );

    const campaignLead =
      await getScheduledLead();

    if (!campaignLead) {
      console.log(
        "No scheduled campaign lead found."
      );

      return;
    }

    console.log("Scheduled lead:", {
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
      "\n2. Forcing follow-up due now..."
    );

    const dueLead =
      await forceFollowUpDue(
        campaignLead.id
      );

    console.log(
      "Due lead:",
      dueLead
    );

    console.log(
      "\n3. Running follow-up executor..."
    );

    const executorResults =
      await runFollowUpExecutor();

    console.log(
      "\nExecutor results:"
    );

    console.dir(executorResults, {
      depth: null,
    });

    console.log(
      "\n4. Checking final lead state..."
    );

    const finalLead =
      await getLeadState(
        campaignLead.id
      );

    console.log(
      "Final lead:",
      finalLead
    );

    console.log(
      "\n========== TEST COMPLETE =========="
    );
  } catch (error) {
    console.error(
      "Due follow-up test failed:",
      error
    );

    process.exitCode = 1;
  }
}

main();