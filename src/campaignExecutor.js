const { supabase } = require("./supabase");

const {
  sendEmail,
} = require("./emailSender");

async function getActiveCampaigns() {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("status", "active");

  if (error) {
    throw error;
  }

  return data || [];
}

async function getPendingCampaignLeads(
  campaignId
) {
  const { data, error } = await supabase
    .from("campaign_leads")
    .select(`
      *,
      advertisers (
        id,
        company_name,
        domain,
        website_url,
        lead_score,
        lead_priority,
        qualification_status,
        contacts (*)
      )
    `)
    .eq("campaign_id", campaignId)
    .in("status", ["pending", "queued"])
    .limit(10);

  if (error) {
    throw error;
  }

  return data || [];
}

function getPrimaryContact(advertiser) {
  const contacts =
    advertiser?.contacts || [];

  if (!contacts.length) {
    return null;
  }

  return (
    contacts.find(
      (contact) =>
        contact.is_primary &&
        contact.email
    ) ||
    contacts.find(
      (contact) => contact.email
    ) ||
    null
  );
}

async function updateCampaignLeadStatus(
  campaignLeadId,
  status,
  additionalData = {}
) {
  const payload = {
    status,
    ...additionalData,
  };

  const { error } = await supabase
    .from("campaign_leads")
    .update(payload)
    .eq("id", campaignLeadId);

  if (error) {
    throw error;
  }
}

async function markLeadQueued(
  campaignLeadId,
  reason = null
) {
  await updateCampaignLeadStatus(
    campaignLeadId,
    "queued",
    {
      failure_reason: reason,
    }
  );
}

async function markLeadSent(
  campaignLeadId
) {
  await updateCampaignLeadStatus(
    campaignLeadId,
    "sent",
    {
      failure_reason: null,
    }
  );
}

async function markLeadFailed(
  campaignLeadId,
  reason
) {
  await updateCampaignLeadStatus(
    campaignLeadId,
    "failed",
    {
      failure_reason: reason,
    }
  );
}

function createOutreachEmail({
  advertiser,
  campaign,
}) {
  const companyName =
    advertiser.company_name ||
    advertiser.domain ||
    "there";

  const subject =
    `Advertising partnership with ${companyName}`;

  const text = `Hi,

I came across ${companyName} while researching active advertisers in the crypto space.

We work with crypto-focused companies looking to expand their advertising reach across relevant websites and audiences.

I wanted to see if advertising partnerships are something your team is currently exploring.

If yes, I would be happy to share more details.

Best regards`;

  const html = `
    <p>Hi,</p>

    <p>
      I came across <strong>${companyName}</strong>
      while researching active advertisers in the
      crypto space.
    </p>

    <p>
      We work with crypto-focused companies looking
      to expand their advertising reach across
      relevant websites and audiences.
    </p>

    <p>
      I wanted to see if advertising partnerships
      are something your team is currently exploring.
    </p>

    <p>
      If yes, I would be happy to share more details.
    </p>

    <p>
      Best regards
    </p>
  `;

  return {
    subject,
    text,
    html,
    campaignName: campaign.name,
  };
}

async function processCampaignLead(
  campaignLead,
  campaign
) {
  const advertiser =
    campaignLead.advertisers;

  console.log(
    "\n--------------------------------"
  );

  console.log(
    `Processing campaign lead: ${
      advertiser?.company_name ||
      "Unknown"
    }`
  );

  if (!advertiser) {
    await markLeadFailed(
      campaignLead.id,
      "Advertiser not found"
    );

    console.log(
      "Lead failed: advertiser missing"
    );

    return {
      status: "failed",
      campaignLeadId: campaignLead.id,
    };
  }

  const contact =
    getPrimaryContact(advertiser);

  if (!contact?.email) {
    await markLeadFailed(
      campaignLead.id,
      "No reachable email contact"
    );

    console.log(
      "Lead failed: no reachable email"
    );

    return {
      status: "failed",
      campaignLeadId: campaignLead.id,
    };
  }

  const emailContent =
    createOutreachEmail({
      advertiser,
      campaign,
    });

  console.log(
    "Advertiser:",
    advertiser.company_name
  );

  console.log(
    "Email:",
    contact.email
  );

  console.log(
    "Score:",
    advertiser.lead_score
  );

  console.log(
    "Priority:",
    advertiser.lead_priority
  );

  console.log(
    "Sending outreach email..."
  );

  const sendResult = await sendEmail({
    to: contact.email,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });

  if (sendResult.success) {
    await markLeadSent(
      campaignLead.id
    );

    console.log(
      `Lead sent successfully: ${sendResult.messageId}`
    );

    return {
      status: "sent",
      campaignLeadId:
        campaignLead.id,
      advertiserId:
        advertiser.id,
      companyName:
        advertiser.company_name,
      email: contact.email,
      messageId:
        sendResult.messageId,
      smtpAccountId:
        sendResult.smtpAccountId,
    };
  }

  if (sendResult.queued) {
    await markLeadQueued(
      campaignLead.id,
      sendResult.error
    );

    console.log(
      `Lead remains queued: ${sendResult.error}`
    );

    return {
      status: "queued",
      campaignLeadId:
        campaignLead.id,
      advertiserId:
        advertiser.id,
      companyName:
        advertiser.company_name,
      email: contact.email,
      reason: sendResult.error,
    };
  }

  await markLeadFailed(
    campaignLead.id,
    sendResult.error ||
      "Unknown email sending error"
  );

  console.log(
    `Lead failed: ${sendResult.error}`
  );

  return {
    status: "failed",
    campaignLeadId:
      campaignLead.id,
    advertiserId:
      advertiser.id,
    companyName:
      advertiser.company_name,
    email: contact.email,
    reason:
      sendResult.error,
  };
}

async function executeCampaign(campaign) {
  console.log(
    "\n================================"
  );

  console.log(
    `Executing campaign: ${campaign.name}`
  );

  const leads =
    await getPendingCampaignLeads(
      campaign.id
    );

  console.log(
    `Found ${leads.length} campaign leads ready for processing`
  );

  const results = [];

  for (const campaignLead of leads) {
    try {
      const result =
        await processCampaignLead(
          campaignLead,
          campaign
        );

      if (result) {
        results.push(result);
      }
    } catch (error) {
      console.error(
        "Campaign lead processing failed:",
        error
      );

      try {
        await markLeadFailed(
          campaignLead.id,
          error.message ||
            "Campaign processing error"
        );
      } catch (statusError) {
        console.error(
          "Failed to update lead status:",
          statusError
        );
      }

      results.push({
        status: "failed",
        campaignLeadId:
          campaignLead.id,
        reason:
          error.message ||
          "Campaign processing error",
      });
    }
  }

  return results;
}

async function runCampaignExecutor() {
  console.log(
    "\n========== CAMPAIGN EXECUTOR =========="
  );

  const campaigns =
    await getActiveCampaigns();

  console.log(
    `Found ${campaigns.length} active campaigns`
  );

  const results = [];

  for (const campaign of campaigns) {
    try {
      const campaignResults =
        await executeCampaign(campaign);

      results.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        results: campaignResults,
      });
    } catch (error) {
      console.error(
        `Campaign execution failed for ${campaign.name}:`,
        error
      );

      results.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        error:
          error.message ||
          "Campaign execution failed",
      });
    }
  }

  console.log(
    "\n========== EXECUTOR SUMMARY =========="
  );

  console.dir(results, {
    depth: null,
  });

  return results;
}

module.exports = {
  getActiveCampaigns,
  getPendingCampaignLeads,
  getPrimaryContact,
  createOutreachEmail,
  processCampaignLead,
  executeCampaign,
  runCampaignExecutor,
};