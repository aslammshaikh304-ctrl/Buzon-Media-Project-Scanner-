const {
  supabase,
} = require("./supabase");

const {
  sendEmail,
} = require("./emailSender");

const MAX_FOLLOW_UPS = 2;

const FOLLOW_UP_DELAY_DAYS = {
  0: 3,
  1: 4,
};

function addDays(date, days) {
  const result = new Date(date);

  result.setDate(
    result.getDate() + days
  );

  return result;
}

async function getDueFollowUps() {
  const now =
    new Date().toISOString();

  const { data, error } =
    await supabase
      .from("campaign_leads")
      .select(`
        *,
        advertisers (
          id,
          company_name,
          domain,
          status,
          contacts (*)
        ),
        campaigns (
          id,
          name
        )
      `)
      .eq("status", "sent")
      .eq(
        "sequence_completed",
        false
      )
      .lte(
        "next_follow_up_at",
        now
      )
      .order(
        "next_follow_up_at",
        {
          ascending: true,
        }
      )
      .limit(50);

  if (error) {
    throw error;
  }

  return data || [];
}

function getPrimaryContact(
  advertiser
) {
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

function getFollowUpContent({
  advertiser,
  followUpNumber,
}) {
  const companyName =
    advertiser?.company_name ||
    "there";

  if (followUpNumber === 1) {
    return {
      subject:
        "Quick follow-up",

      text: `Hi ${companyName},

Just following up on my previous email.

I wanted to check if advertising opportunities or partnerships are something your team is currently exploring.

Happy to share more details if relevant.

Best regards`,
    };
  }

  return {
    subject:
      "Last follow-up",

    text: `Hi ${companyName},

Just wanted to follow up one last time.

If advertising or partnership opportunities are relevant for your team, I'd be happy to discuss further.

If not, no worries at all.

Best regards`,
  };
}

async function markSequenceCompleted(
  campaignLeadId
) {
  const { error } =
    await supabase
      .from("campaign_leads")
      .update({
        sequence_completed: true,
        next_follow_up_at: null,
      })
      .eq(
        "id",
        campaignLeadId
      );

  if (error) {
    throw error;
  }
}

async function updateAfterFollowUp({
  campaignLead,
  followUpNumber,
}) {
  if (
    followUpNumber >= MAX_FOLLOW_UPS
  ) {
    await markSequenceCompleted(
      campaignLead.id
    );

    return;
  }

  const delayDays =
    FOLLOW_UP_DELAY_DAYS[
      followUpNumber
    ] || 4;

  const nextFollowUpAt =
    addDays(
      new Date(),
      delayDays
    ).toISOString();

  const { error } =
    await supabase
      .from("campaign_leads")
      .update({
        follow_up_count:
          followUpNumber,

        last_follow_up_at:
          new Date().toISOString(),

        next_follow_up_at:
          nextFollowUpAt,
      })
      .eq(
        "id",
        campaignLead.id
      );

  if (error) {
    throw error;
  }
}

async function processFollowUp(
  campaignLead
) {
  const advertiser =
    campaignLead.advertisers;

  console.log(
    "\n--------------------------------"
  );

  console.log(
    `Processing follow-up: ${
      advertiser?.company_name ||
      "Unknown"
    }`
  );

  if (!advertiser) {
    await markSequenceCompleted(
      campaignLead.id
    );

    return {
      campaignLeadId:
        campaignLead.id,

      status: "completed",

      reason:
        "Advertiser missing",
    };
  }

  if (
    advertiser.status ===
      "interested" ||
    advertiser.status ===
      "not_interested" ||
    advertiser.status ===
      "needs_info"
  ) {
    await markSequenceCompleted(
      campaignLead.id
    );

    console.log(
      "Sequence stopped: advertiser replied"
    );

    return {
      campaignLeadId:
        campaignLead.id,

      status: "stopped",

      reason:
        "Advertiser replied",
    };
  }

  const contact =
    getPrimaryContact(advertiser);

  if (!contact?.email) {
    await markSequenceCompleted(
      campaignLead.id
    );

    return {
      campaignLeadId:
        campaignLead.id,

      status: "completed",

      reason:
        "No reachable email",
    };
  }

  const followUpNumber =
    Number(
      campaignLead.follow_up_count ||
      0
    ) + 1;

  if (
    followUpNumber >
    MAX_FOLLOW_UPS
  ) {
    await markSequenceCompleted(
      campaignLead.id
    );

    return {
      campaignLeadId:
        campaignLead.id,

      status: "completed",

      reason:
        "Maximum follow-ups reached",
    };
  }

  const content =
    getFollowUpContent({
      advertiser,
      followUpNumber,
    });

  console.log(
    `Sending follow-up #${followUpNumber} to ${contact.email}`
  );

  const sendResult =
    await sendEmail({
      to: contact.email,
      subject: content.subject,
      text: content.text,
    });

  if (!sendResult.success) {
    if (sendResult.queued) {
      console.log(
        `Follow-up remains queued: ${sendResult.error}`
      );

      return {
        campaignLeadId:
          campaignLead.id,

        status: "queued",

        reason:
          sendResult.error,
      };
    }

    console.log(
      `Follow-up failed: ${sendResult.error}`
    );

    return {
      campaignLeadId:
        campaignLead.id,

      status: "failed",

      reason:
        sendResult.error,
    };
  }

  await updateAfterFollowUp({
    campaignLead,
    followUpNumber,
  });

  console.log(
    `Follow-up #${followUpNumber} sent`
  );

  return {
    campaignLeadId:
      campaignLead.id,

    status: "sent",

    followUpNumber,

    messageId:
      sendResult.messageId,
  };
}

async function runFollowUpExecutor() {
  console.log(
    "\n========== FOLLOW-UP EXECUTOR =========="
  );

  const leads =
    await getDueFollowUps();

  console.log(
    `Found ${leads.length} due follow-ups`
  );

  const results = [];

  for (const campaignLead of leads) {
    try {
      const result =
        await processFollowUp(
          campaignLead
        );

      results.push(result);
    } catch (error) {
      console.error(
        `Follow-up processing failed for ${campaignLead.id}:`,
        error
      );

      results.push({
        campaignLeadId:
          campaignLead.id,

        status: "failed",

        error:
          error instanceof Error
            ? error.message
            : "Follow-up failed",
      });
    }
  }

  console.log(
    "Follow-up executor completed:",
    results
  );

  return results;
}

module.exports = {
  getDueFollowUps,
  getPrimaryContact,
  getFollowUpContent,
  processFollowUp,
  runFollowUpExecutor,
};