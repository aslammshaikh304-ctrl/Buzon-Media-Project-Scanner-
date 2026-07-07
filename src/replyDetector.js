const { ImapFlow } = require("imapflow");
const {
  simpleParser,
} = require("mailparser");

const { supabase } = require("./supabase");

const {
  decryptSmtpPassword,
} = require("./smtpCrypto");

async function getImapAccounts() {
  const { data, error } = await supabase
    .from("smtp_accounts")
    .select("*")
    .eq("is_active", true)
    .not("imap_host", "is", null)
    .not("imap_username", "is", null)
    .not(
      "imap_password_encrypted",
      "is",
      null
    );

  if (error) {
    throw error;
  }

  return data || [];
}

function createImapClient(account) {
  const password = decryptSmtpPassword(
    account.imap_password_encrypted
  );

  return new ImapFlow({
    host: account.imap_host,

    port: Number(
      account.imap_port || 993
    ),

    secure:
      Number(account.imap_port || 993) ===
      993,

    auth: {
      user: account.imap_username,
      pass: password,
    },

    logger: false,
  });
}

async function replyExists(messageId) {
  if (!messageId) {
    return false;
  }

  const { data, error } = await supabase
    .from("replies")
    .select("id")
    .eq("message_id", messageId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

async function findCampaignContext(
  fromEmail
) {
  if (!fromEmail) {
    return null;
  }

  const normalizedEmail =
    fromEmail.trim().toLowerCase();

  const { data: contacts, error } =
    await supabase
      .from("contacts")
      .select(`
        id,
        advertiser_id,
        email
      `)
      .ilike("email", normalizedEmail)
      .limit(1);

  if (error) {
    throw error;
  }

  const contact = contacts?.[0];

  if (!contact) {
    return null;
  }

  const {
    data: campaignLeads,
    error: campaignLeadError,
  } = await supabase
    .from("campaign_leads")
    .select(`
      id,
      campaign_id,
      advertiser_id,
      status
    `)
    .eq(
      "advertiser_id",
      contact.advertiser_id
    )
    .in("status", [
      "queued",
      "sent",
      "replied",
    ])
    .order("created_at", {
      ascending: false,
    })
    .limit(1);

  if (campaignLeadError) {
    throw campaignLeadError;
  }

  const campaignLead =
    campaignLeads?.[0];

  if (!campaignLead) {
    return null;
  }

  return {
    contact,
    campaignLead,
  };
}

async function saveReply({
  account,
  parsed,
  context,
}) {
  const fromEmail =
    parsed.from?.value?.[0]?.address
      ?.trim()
      .toLowerCase() || null;

  const toEmail =
    parsed.to?.value?.[0]?.address
      ?.trim()
      .toLowerCase() || null;

  const messageId =
    parsed.messageId || null;

  const inReplyTo =
    Array.isArray(parsed.inReplyTo)
      ? parsed.inReplyTo[0]
      : parsed.inReplyTo || null;

  const { data, error } = await supabase
    .from("replies")
    .insert({
      advertiser_id:
        context.campaignLead
          .advertiser_id,

      contact_id:
        context.contact.id,

      campaign_id:
        context.campaignLead
          .campaign_id,

      smtp_account_id:
        account.id,

      message_id: messageId,

      in_reply_to: inReplyTo,

      from_email: fromEmail,

      to_email: toEmail,

      subject:
        parsed.subject || null,

      body:
        parsed.text ||
        parsed.html ||
        null,

      received_at:
        parsed.date
          ? parsed.date.toISOString()
          : new Date().toISOString(),

      is_read: false,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  const {
    error: campaignLeadError,
  } = await supabase
    .from("campaign_leads")
    .update({
      status: "replied",
    })
    .eq(
      "id",
      context.campaignLead.id
    );

  if (campaignLeadError) {
    throw campaignLeadError;
  }

  return data;
}

async function processMessage({
  account,
  parsed,
}) {
  const messageId =
    parsed.messageId || null;

  if (
    messageId &&
    (await replyExists(messageId))
  ) {
    return {
      status: "duplicate",
      messageId,
    };
  }

  const fromEmail =
    parsed.from?.value?.[0]?.address;

  if (!fromEmail) {
    return {
      status: "ignored",
      reason: "Sender email missing",
    };
  }

  const context =
    await findCampaignContext(fromEmail);

  if (!context) {
    return {
      status: "ignored",
      reason:
        "No matching campaign lead",
      fromEmail,
    };
  }

  const reply = await saveReply({
    account,
    parsed,
    context,
  });

  console.log(
    `Reply detected from ${fromEmail}`
  );

  return {
    status: "saved",
    replyId: reply.id,
    fromEmail,
  };
}

async function checkAccountReplies(
  account
) {
  const client =
    createImapClient(account);

  const results = [];

  try {
    console.log(
      `Checking inbox: ${account.email}`
    );

    await client.connect();

    const lock =
      await client.getMailboxLock(
        "INBOX"
      );

    try {
      const since = new Date();

      since.setDate(
        since.getDate() - 7
      );

      const messages =
        client.fetch(
          {
            since,
          },
          {
            uid: true,
            source: true,
          }
        );

      for await (const message of messages) {
        try {
          const parsed =
            await simpleParser(
              message.source
            );

          const result =
            await processMessage({
              account,
              parsed,
            });

          results.push(result);
        } catch (error) {
          console.error(
            "Reply processing failed:",
            error
          );
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return results;
}

async function runReplyDetector() {
  console.log(
    "\n========== REPLY DETECTOR =========="
  );

  const accounts =
    await getImapAccounts();

  console.log(
    `Found ${accounts.length} IMAP accounts`
  );

  if (!accounts.length) {
    console.log(
      "No IMAP accounts available"
    );

    return [];
  }

  const results = [];

  for (const account of accounts) {
    try {
      const accountResults =
        await checkAccountReplies(
          account
        );

      results.push({
        smtpAccountId: account.id,
        email: account.email,
        results: accountResults,
      });
    } catch (error) {
      console.error(
        `Inbox check failed for ${account.email}:`,
        error.message
      );

      results.push({
        smtpAccountId: account.id,
        email: account.email,
        error: error.message,
      });
    }
  }

  return results;
}

module.exports = {
  getImapAccounts,
  createImapClient,
  replyExists,
  findCampaignContext,
  processMessage,
  checkAccountReplies,
  runReplyDetector,
};