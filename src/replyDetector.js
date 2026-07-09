const { ImapFlow } = require("imapflow");

const {
  simpleParser,
} = require("mailparser");

const { supabase } = require("./supabase");

const {
  decryptSmtpPassword,
} = require("./smtpCrypto");

/* ========================================
   GET IMAP ACCOUNTS
======================================== */

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

/* ========================================
   CREATE IMAP CLIENT
======================================== */

function createImapClient(account) {
  const password = decryptSmtpPassword(
    account.imap_password_encrypted
  );

  const port = Number(
    account.imap_port || 993
  );

  return new ImapFlow({
    host: account.imap_host,

    port,

    secure: port === 993,

    auth: {
      user: account.imap_username,
      pass: password,
    },

    logger: false,
  });
}

/* ========================================
   NORMALIZE MESSAGE ID
======================================== */

function normalizeMessageId(value) {
  if (!value) {
    return null;
  }

  return String(value).trim();
}

/* ========================================
   MESSAGE EXISTS
======================================== */

async function messageExists(messageId) {
  const normalizedMessageId =
    normalizeMessageId(messageId);

  if (!normalizedMessageId) {
    return false;
  }

  const {
    data: reply,
    error: replyError,
  } = await supabase
    .from("replies")
    .select("id")
    .eq(
      "message_id",
      normalizedMessageId
    )
    .maybeSingle();

  if (replyError) {
    throw replyError;
  }

  if (reply) {
    return true;
  }

  const {
    data: threadMessage,
    error: threadError,
  } = await supabase
    .from("reply_messages")
    .select("id")
    .eq(
      "message_id",
      normalizedMessageId
    )
    .maybeSingle();

  if (threadError) {
    throw threadError;
  }

  return Boolean(threadMessage);
}

/* ========================================
   FIND CAMPAIGN CONTEXT
======================================== */

async function findCampaignContext(
  fromEmail
) {
  if (!fromEmail) {
    return null;
  }

  const normalizedEmail = fromEmail
    .trim()
    .toLowerCase();

  const { data: contacts, error } =
    await supabase
      .from("contacts")
      .select(`
        id,
        advertiser_id,
        email
      `)
      .ilike(
        "email",
        normalizedEmail
      )
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
    status,
    next_follow_up_at,
    follow_up_count
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

/* ========================================
   FIND EXISTING REPLY THREAD
======================================== */

async function findReplyThread({
  context,
  parsed,
}) {
  const inReplyTo =
    Array.isArray(parsed.inReplyTo)
      ? parsed.inReplyTo[0]
      : parsed.inReplyTo || null;

  const references = Array.isArray(
    parsed.references
  )
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : [];

  const threadMessageIds = [
    inReplyTo,
    ...references,
  ]
    .map(normalizeMessageId)
    .filter(Boolean);

  /*
   * First try exact email threading.
   */

  for (
    const threadMessageId of threadMessageIds
  ) {
    const {
      data: directReply,
      error: directReplyError,
    } = await supabase
      .from("replies")
      .select("*")
      .eq(
        "message_id",
        threadMessageId
      )
      .maybeSingle();

    if (directReplyError) {
      throw directReplyError;
    }

    if (directReply) {
      return directReply;
    }

    const {
      data: threadMessage,
      error: threadMessageError,
    } = await supabase
      .from("reply_messages")
      .select("reply_id")
      .eq(
        "message_id",
        threadMessageId
      )
      .maybeSingle();

    if (threadMessageError) {
      throw threadMessageError;
    }

    if (threadMessage?.reply_id) {
      const {
        data: parentReply,
        error: parentReplyError,
      } = await supabase
        .from("replies")
        .select("*")
        .eq(
          "id",
          threadMessage.reply_id
        )
        .single();

      if (parentReplyError) {
        throw parentReplyError;
      }

      return parentReply;
    }
  }

  /*
   * Fallback to latest advertiser reply.
   */

  const {
    data: existingReplies,
    error: existingReplyError,
  } = await supabase
    .from("replies")
    .select("*")
    .eq(
      "advertiser_id",
      context.campaignLead.advertiser_id
    )
    .eq(
      "campaign_id",
      context.campaignLead.campaign_id
    )
    .order("received_at", {
      ascending: false,
    })
    .limit(1);

  if (existingReplyError) {
    throw existingReplyError;
  }

  return existingReplies?.[0] || null;
}

/* ========================================
   SAVE INITIAL REPLY
======================================== */

async function saveInitialReply({
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
    normalizeMessageId(
      parsed.messageId
    );

  const inReplyTo =
    Array.isArray(parsed.inReplyTo)
      ? parsed.inReplyTo[0]
      : parsed.inReplyTo || null;

  const receivedAt = parsed.date
    ? parsed.date.toISOString()
    : new Date().toISOString();

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

      in_reply_to:
        normalizeMessageId(inReplyTo),

      from_email: fromEmail,

      to_email: toEmail,

      subject:
        parsed.subject || null,

      body:
        parsed.text ||
        parsed.html ||
        null,

      received_at: receivedAt,

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

      next_follow_up_at: null,

      failure_reason: null,
    })
    .eq(
      "id",
      context.campaignLead.id
    );

  if (campaignLeadError) {
    throw campaignLeadError;
  }

  console.log(
    `New reply thread created: ${data.id}`
  );

  return data;
}

/* ========================================
   SAVE INBOUND THREAD MESSAGE
======================================== */

async function saveInboundThreadMessage({
  reply,
  parsed,
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
    normalizeMessageId(
      parsed.messageId
    );

  const inReplyTo =
    Array.isArray(parsed.inReplyTo)
      ? parsed.inReplyTo[0]
      : parsed.inReplyTo || null;

  const receivedAt = parsed.date
    ? parsed.date.toISOString()
    : new Date().toISOString();

  const { data, error } = await supabase
    .from("reply_messages")
    .insert({
      reply_id: reply.id,

      direction: "inbound",

      from_email: fromEmail,

      to_email: toEmail,

      subject:
        parsed.subject || null,

      body:
        parsed.text ||
        parsed.html ||
        null,

      message_id: messageId,

      in_reply_to:
        normalizeMessageId(inReplyTo),

      sent_at: receivedAt,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  await supabase
    .from("replies")
    .update({
      is_read: false,
    })
    .eq("id", reply.id);

  console.log(
    `Inbound thread message saved: ${data.id}`
  );

  return data;
}

/* ========================================
   PROCESS MESSAGE
======================================== */

async function processMessage({
  account,
  parsed,
}) {
  const messageId =
    normalizeMessageId(
      parsed.messageId
    );

  if (
    messageId &&
    (await messageExists(messageId))
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
    await findCampaignContext(
      fromEmail
    );

  if (!context) {
    return {
      status: "ignored",

      reason:
        "No matching campaign lead",

      fromEmail,
    };
  }

  const existingReply =
    await findReplyThread({
      context,
      parsed,
    });

  if (existingReply) {
    const threadMessage =
      await saveInboundThreadMessage({
        reply: existingReply,
        parsed,
      });

    console.log(
      `Thread reply detected from ${fromEmail}`
    );

    return {
      status: "thread_message_saved",

      replyId: existingReply.id,

      messageId: threadMessage.id,

      campaignLeadId:
        context.campaignLead.id,

      fromEmail,
    };
  }

  const reply =
    await saveInitialReply({
      account,
      parsed,
      context,
    });

  console.log(
    `Initial reply detected from ${fromEmail}`
  );

  return {
    status: "saved",

    replyId: reply.id,

    campaignLeadId:
      context.campaignLead.id,

    fromEmail,
  };
}

/* ========================================
   CHECK ACCOUNT REPLIES
======================================== */

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

      const messages = client.fetch(
        {
          since,
        },
        {
          uid: true,
          source: true,
        }
      );

      for await (
        const message of messages
      ) {
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

          results.push({
            status: "failed",

            error:
              error instanceof Error
                ? error.message
                : "Reply processing failed",
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client
      .logout()
      .catch(() => {});
  }

  return results;
}

/* ========================================
   RUN REPLY DETECTOR
======================================== */

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

        error:
          error instanceof Error
            ? error.message
            : "Inbox check failed",
      });
    }
  }

  return results;
}

/* ========================================
   EXPORTS
======================================== */

module.exports = {
  getImapAccounts,

  createImapClient,

  messageExists,

  findCampaignContext,

  findReplyThread,

  saveInitialReply,

  saveInboundThreadMessage,

  processMessage,

  checkAccountReplies,

  runReplyDetector,
};