const { supabase } = require("./supabase");

/* ========================================
   NORMALIZE TEXT
======================================== */

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
}

/* ========================================
   CLEAN EMAIL BODY
======================================== */

function cleanEmailBody(body) {
  const original = normalizeText(body);

  if (!original) {
    return "";
  }

  const separators = [
    /^On .+wrote:$/im,
    /^From:\s.+$/im,
    /^Sent:\s.+$/im,
    /^To:\s.+$/im,
    /^Subject:\s.+$/im,
    /^-----Original Message-----$/im,
  ];

  let cutIndex = original.length;

  for (const separator of separators) {
    const match =
      original.match(separator);

    if (
      match &&
      match.index !== undefined &&
      match.index < cutIndex
    ) {
      cutIndex = match.index;
    }
  }

  return original
    .slice(0, cutIndex)
    .replace(/^>.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ========================================
   GET REPLY CONTEXT
======================================== */

async function getReplyContext(replyId) {
  if (!replyId) {
    throw new Error(
      "Reply id is required"
    );
  }

  const { data: reply, error } =
    await supabase
      .from("replies")
      .select(`
        id,
        advertiser_id,
        campaign_id,
        subject,
        body,
        from_email,
        to_email,
        classification,
        classification_confidence,
        classification_reason,
        received_at,
        advertisers (
          id,
          company_name,
          domain,
          website_url,
          status,
          lead_score,
          lead_priority
        ),
        campaigns (
          id,
          name
        )
      `)
      .eq("id", replyId)
      .single();

  if (error || !reply) {
    console.error(
      "Failed to fetch reply context:",
      error
    );

    throw new Error(
      "Reply context not found"
    );
  }

  return reply;
}

/* ========================================
   GET CONVERSATION MESSAGES
======================================== */

async function getConversationMessages(
  reply
) {
  const messages = [];

  /*
   * Original inbound reply.
   */

  messages.push({
    id: reply.id,

    direction: "inbound",

    from_email: reply.from_email,

    to_email: reply.to_email,

    subject: reply.subject,

    body: cleanEmailBody(
      reply.body
    ),

    timestamp:
      reply.received_at,

    source: "reply",
  });

  /*
   * Get all stored inbound and outbound
   * thread messages.
   */

  const {
  data: replyMessages,
  error,
} = await supabase
  .from("reply_messages")
  .select(`
    id,
    direction,
    from_email,
    to_email,
    subject,
    body,
    message_id,
    in_reply_to,
    sent_at
  `)
  .eq("reply_id", reply.id);

  if (error) {
    console.error(
      "Failed to fetch conversation messages:",
      error
    );

    throw error;
  }

  for (
    const message of replyMessages || []
  ) {
    messages.push({
      id: message.id,

      direction:
        message.direction,

      from_email:
        message.from_email,

      to_email:
        message.to_email,

      subject:
        message.subject,

      body: cleanEmailBody(
        message.body
      ),

      timestamp:
  message.sent_at,

      source: "reply_message",
    });
  }

  /*
   * Remove accidental duplicates.
   */

  const uniqueMessages = [];

  const seen = new Set();

  for (const message of messages) {
    const key = [
      message.direction,
      normalizeText(
        message.from_email
      ).toLowerCase(),
      normalizeText(
        message.body
      ),
      message.timestamp,
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    uniqueMessages.push(message);
  }

  /*
   * Sort entire conversation
   * chronologically.
   */

  uniqueMessages.sort(
    (a, b) =>
      new Date(
        a.timestamp || 0
      ).getTime() -
      new Date(
        b.timestamp || 0
      ).getTime()
  );

  return uniqueMessages;
}

/* ========================================
   GET LATEST MESSAGE
======================================== */

function getLatestMessage(messages) {
  if (!messages.length) {
    return null;
  }

  return messages[
    messages.length - 1
  ];
}

/* ========================================
   GET LATEST INBOUND MESSAGE
======================================== */

function getLatestInboundMessage(
  messages
) {
  return (
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.direction ===
          "inbound"
      ) || null
  );
}

/* ========================================
   CONVERSATION TEXT
======================================== */

function buildConversationText(
  messages
) {
  return messages
    .map((message, index) => {
      const speaker =
        message.direction ===
        "outbound"
          ? "BUZON SALES"
          : "ADVERTISER";

      return [
        `MESSAGE ${index + 1}`,
        `SPEAKER: ${speaker}`,
        `DIRECTION: ${message.direction}`,
        `SUBJECT: ${
          message.subject ||
          "No subject"
        }`,
        "BODY:",
        message.body ||
          "No message body",
      ].join("\n");
    })
    .join(
      "\n\n--------------------\n\n"
    );
}

/* ========================================
   INTENT HELPERS
======================================== */

function includesAny(
  text,
  patterns
) {
  const normalized =
    normalizeText(text).toLowerCase();

  return patterns.some((pattern) =>
    normalized.includes(pattern)
  );
}

function detectLatestIntent(message) {
  if (!message) {
    return "unknown";
  }

  const text = normalizeText(
    message.body
  ).toLowerCase();

  if (!text) {
    return "unknown";
  }

  if (
    includesAny(text, [
      "not interested",
      "no thanks",
      "no thank you",
      "remove me",
      "unsubscribe",
      "stop emailing",
      "do not contact",
      "don't contact",
    ])
  ) {
    return "not_interested";
  }

  if (
    includesAny(text, [
      "available tomorrow",
      "free tomorrow",
      "tomorrow works",
      "available today",
      "free today",
      "available monday",
      "available tuesday",
      "available wednesday",
      "available thursday",
      "available friday",
      "available saturday",
      "available sunday",
      "schedule a call",
      "book a call",
      "let's talk",
      "lets talk",
      "let's discuss",
      "lets discuss",
      "can we talk",
      "happy to discuss",
    ])
  ) {
    return "meeting_ready";
  }

  if (
    includesAny(text, [
      "what time",
      "which time",
      "what time works",
      "when are you available",
      "when can you",
    ])
  ) {
    return "asking_time";
  }

  if (
    includesAny(text, [
      "send more details",
      "send me details",
      "more details",
      "more information",
      "more info",
      "how does it work",
      "can you explain",
      "share details",
      "pricing",
      "how much",
      "what is the price",
      "what's the price",
    ])
  ) {
    return "needs_info";
  }

  if (
    includesAny(text, [
      "interested",
      "sounds interesting",
      "sounds good",
      "open to discussing",
      "open to discuss",
    ])
  ) {
    return "interested";
  }

  return "unknown";
}

/* ========================================
   BUILD CONVERSATION-AWARE DRAFT
======================================== */

function buildReplyDraft({
  reply,
  messages,
}) {
  const advertiser =
    reply.advertisers;

  const companyName =
    advertiser?.company_name ||
    "your company";

  const latestMessage =
    getLatestMessage(messages);

  const latestInbound =
    getLatestInboundMessage(messages);

  /*
   * Draft generation must always
   * react to the latest inbound
   * advertiser message.
   */

  const intent =
    detectLatestIntent(
      latestInbound
    );

  const latestInboundBody =
    normalizeText(
      latestInbound?.body
    );

  switch (intent) {
    case "meeting_ready":
      return [
        "Hi,",
        "",
        "Perfect, tomorrow works for me.",
        "",
        "What time would be convenient for you?",
        "",
        "Best regards,",
      ].join("\n");

    case "asking_time":
      return [
        "Hi,",
        "",
        "Thanks for getting back to me.",
        "",
        "I'm available tomorrow and would be happy to connect.",
        "",
        "Please let me know what time works best for you.",
        "",
        "Best regards,",
      ].join("\n");

    case "needs_info":
      return [
        "Hi,",
        "",
        "Thanks for getting back to me.",
        "",
        `I'd be happy to share more details about the advertising opportunity for ${companyName}.`,
        "",
        "We're exploring a potential advertising partnership and would like to discuss available placements, audience reach, and commercial terms.",
        "",
        "If easier, we can also arrange a quick call to discuss the opportunity.",
        "",
        "Best regards,",
      ].join("\n");

    case "interested":
      return [
        "Hi,",
        "",
        "Thanks for getting back to me. Great to hear you're interested.",
        "",
        "I'd be happy to discuss the advertising opportunity and explore the next steps.",
        "",
        "Would you be available for a quick call? Please let me know a convenient time.",
        "",
        "Best regards,",
      ].join("\n");

    case "not_interested":
      return [
        "Hi,",
        "",
        "Thanks for letting me know.",
        "",
        "I appreciate your time and response.",
        "",
        "Best regards,",
      ].join("\n");

    default:
      /*
       * Classification is only used
       * as a fallback when the latest
       * message intent is unclear.
       */

      switch (
        reply.classification ||
        "unknown"
      ) {
        case "interested":
          return [
            "Hi,",
            "",
            "Thanks for getting back to me.",
            "",
            "I'd be happy to continue the conversation and discuss the opportunity further.",
            "",
            "Please let me know a convenient time for a quick discussion.",
            "",
            "Best regards,",
          ].join("\n");

        case "needs_info":
          return [
            "Hi,",
            "",
            "Thanks for getting back to me.",
            "",
            `I'd be happy to share more details about the advertising opportunity for ${companyName}.`,
            "",
            "We're exploring a potential advertising partnership and would like to understand the available opportunities.",
            "",
            "Please let me know if you'd prefer to continue over email or arrange a quick discussion.",
            "",
            "Best regards,",
          ].join("\n");

        case "out_of_office":
          return [
            "Hi,",
            "",
            "Thanks for the update.",
            "",
            "I'll follow up once you're back and available.",
            "",
            "Best regards,",
          ].join("\n");

        case "not_interested":
          return [
            "Hi,",
            "",
            "Thanks for letting me know.",
            "",
            "I appreciate your time.",
            "",
            "Best regards,",
          ].join("\n");

        default:
          return [
            "Hi,",
            "",
            "Thanks for getting back to me.",
            "",
            latestInboundBody
              ? "I appreciate your response and would be happy to continue the conversation."
              : "I'd be happy to discuss the opportunity further.",
            "",
            "Please let me know how you'd like to proceed.",
            "",
            "Best regards,",
          ].join("\n");
      }
  }
}

/* ========================================
   GENERATE DRAFT
======================================== */

async function generateReplyDraft(
  replyId
) {
  const reply =
    await getReplyContext(replyId);

  const messages =
    await getConversationMessages(
      reply
    );

  const latestMessage =
    getLatestMessage(messages);

  const latestInbound =
    getLatestInboundMessage(
      messages
    );

  const conversationText =
    buildConversationText(messages);

  const latestIntent =
    detectLatestIntent(
      latestInbound
    );

  console.log(
    `Generating conversation-aware draft for ${replyId}`
  );

  console.log(
    `Conversation messages: ${messages.length}`
  );

  console.log(
    `Latest direction: ${
      latestMessage?.direction ||
      "unknown"
    }`
  );

  console.log(
    `Latest inbound intent: ${latestIntent}`
  );

  const draft =
    buildReplyDraft({
      reply,
      messages,
    });

  console.log(
    `Conversation-aware draft generated for ${replyId}`
  );

  return {
    success: true,

    replyId: reply.id,

    classification:
      reply.classification ||
      "unknown",

    latestIntent,

    messageCount:
      messages.length,

    latestMessageDirection:
      latestMessage?.direction ||
      null,

    latestInboundMessage:
      latestInbound?.body ||
      null,

    recipientEmail:
      reply.from_email,

    subject:
      reply.subject || null,

    conversationText,

    draft,
  };
}

/* ========================================
   EXPORTS
======================================== */

module.exports = {
  normalizeText,

  cleanEmailBody,

  getReplyContext,

  getConversationMessages,

  getLatestMessage,

  getLatestInboundMessage,

  buildConversationText,

  detectLatestIntent,

  buildReplyDraft,

  generateReplyDraft,
};