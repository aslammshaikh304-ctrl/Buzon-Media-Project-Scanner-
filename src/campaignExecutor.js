const { supabase } = require("./supabase");

const {
  sendEmail,
  getAvailableSmtpAccount,
} = require("./emailSender");

const DEFAULT_FOLLOW_UP_DELAY_DAYS = 3;

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
async function getEmailTemplate(templateId) {
  if (!templateId) {
    return null;
  }

  const { data, error } = await supabase
    .from("email_templates")
    .select("*")
    .eq("id", templateId)
    .single();

  if (error) {
    throw error;
  }

  return data;
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

function getFirstFollowUpAt(campaign) {
  const delayDays = Number(
    campaign.follow_up_delay_days ||
      DEFAULT_FOLLOW_UP_DELAY_DAYS
  );

  const safeDelayDays =
    Number.isFinite(delayDays) &&
    delayDays > 0
      ? delayDays
      : DEFAULT_FOLLOW_UP_DELAY_DAYS;

  return new Date(
    Date.now() +
      safeDelayDays *
        24 *
        60 *
        60 *
        1000
  ).toISOString();
}

async function markLeadSent(
  campaignLeadId,
  campaign
) {
  const nextFollowUpAt =
    getFirstFollowUpAt(campaign);

  await updateCampaignLeadStatus(
    campaignLeadId,
    "sent",
    {
      failure_reason: null,
      follow_up_count: 0,
      next_follow_up_at:
        nextFollowUpAt,
    }
  );

  return nextFollowUpAt;
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

function replaceVariables(
  text,
  advertiser,
  contact,
  smtp
) {
  if (!text) {
    return "";
  }

  return text
    .replaceAll(
      "{{company}}",
      advertiser?.company_name || ""
    )
    .replaceAll(
      "{{website}}",
      advertiser?.website_url ||
        advertiser?.domain ||
        ""
    )
    .replaceAll(
      "{{publisher}}",
      advertiser?.publisher || ""
    )
    .replaceAll(
      "{{contact}}",
      contact?.name || ""
    )
    .replaceAll(
      "{{email}}",
      contact?.email || ""
    )
    .replaceAll(
      "{{sender}}",
      smtp?.sender_name ||
        smtp?.name ||
        ""
    );
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
      campaignLeadId:
        campaignLead.id,
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
      campaignLeadId:
        campaignLead.id,
    };
  }

  /*
 * Load campaign template
 */

const template =
  await getEmailTemplate(
    campaign.template_id
  );

if (!template) {
  throw new Error(
    "Campaign template not found."
  );
}

/*
 * Load preferred SMTP account
 */

const smtp =
  await getAvailableSmtpAccount(
    campaign.smtp_account_id
  );

if (!smtp) {
  throw new Error(
    "No SMTP account available."
  );
}

/*
 * Build email
 */

const subject =
  replaceVariables(
    template.subject,
    advertiser,
    contact,
    smtp
  );

const html =
  replaceVariables(
    template.body,
    advertiser,
    contact,
    smtp
  );

const text =
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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

  const sendResult =
  await sendEmail({
    preferredSmtpAccountId:
      campaign.smtp_account_id,

    to: contact.email,

    subject,

    text,

    html,
  });

  if (sendResult.success) {
    const nextFollowUpAt =
      await markLeadSent(
        campaignLead.id,
        campaign
      );

    console.log(
      `Lead sent successfully: ${sendResult.messageId}`
    );

    console.log(
      `First follow-up scheduled: ${nextFollowUpAt}`
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
      nextFollowUpAt,
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
async function getEmailTemplate(templateId) {
  const { data, error } = await supabase
    .from("email_templates")
    .select("*")
    .eq("id", templateId)
    .single();

  if (error) throw error;

  return data;
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
  getFirstFollowUpAt,
  processCampaignLead,
  executeCampaign,
  runCampaignExecutor,
};