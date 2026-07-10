const {
  supabase,
} = require("./supabase");

/* ========================================
   CLASSIFICATION PATTERNS
======================================== */

const INTERESTED_PATTERNS = [
  "interested",
  "sounds interesting",
  "sounds good",
  "tell me more",
  "let's talk",
  "lets talk",
  "let's discuss",
  "lets discuss",
  "schedule a call",
  "book a call",
  "set up a call",
  "can we talk",
  "happy to discuss",
  "open to discussing",
];

const NOT_INTERESTED_PATTERNS = [
  "not interested",
  "no thanks",
  "no thank you",
  "please remove",
  "remove me",
  "unsubscribe",
  "stop emailing",
  "do not contact",
  "don't contact",
  "not a fit",
];

const NEEDS_INFO_PATTERNS = [
  "more information",
  "more info",
  "send details",
  "send me details",
  "send more details",
  "send me more details",
  "how does it work",
  "what is the price",
  "what's the price",
  "pricing",
  "how much",
  "can you explain",
  "share details",
  "share more",
];

const OUT_OF_OFFICE_PATTERNS = [
  "out of office",
  "out of the office",
  "automatic reply",
  "auto reply",
  "autoreply",
  "away from the office",
  "currently away",
  "on vacation",
  "annual leave",
  "limited access to email",
];

/* ========================================
   TEXT HELPERS
======================================== */

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function containsPattern(
  text,
  patterns
) {
  return patterns.some((pattern) =>
    text.includes(pattern)
  );
}

/* ========================================
   CLASSIFY REPLY CONTENT
======================================== */

function classifyReplyContent({
  subject,
  body,
}) {
  const text = normalizeText(
    `${subject || ""} ${body || ""}`
  );

  if (!text) {
    return {
      classification: "unknown",
      confidence: 0,
      reason: "Reply content is empty",
    };
  }

  if (
    containsPattern(
      text,
      OUT_OF_OFFICE_PATTERNS
    )
  ) {
    return {
      classification:
        "out_of_office",

      confidence: 0.95,

      reason:
        "Out-of-office language detected",
    };
  }

  if (
    containsPattern(
      text,
      NOT_INTERESTED_PATTERNS
    )
  ) {
    return {
      classification:
        "not_interested",

      confidence: 0.95,

      reason:
        "Negative intent language detected",
    };
  }

  if (
    containsPattern(
      text,
      NEEDS_INFO_PATTERNS
    )
  ) {
    return {
      classification:
        "needs_info",

      confidence: 0.85,

      reason:
        "Information request language detected",
    };
  }

  if (
    containsPattern(
      text,
      INTERESTED_PATTERNS
    )
  ) {
    return {
      classification:
        "interested",

      confidence: 0.9,

      reason:
        "Positive intent language detected",
    };
  }

  return {
    classification: "unknown",

    confidence: 0.25,

    reason:
      "No strong intent pattern detected",
  };
}

/* ========================================
   UPDATE REPLY CLASSIFICATION
======================================== */

async function updateReplyClassification(
  replyId,
  result
) {
  const { error } = await supabase
    .from("replies")
    .update({
      classification:
        result.classification,

      classification_confidence:
        result.confidence,

      classification_reason:
        result.reason,

      classified_at:
        new Date().toISOString(),
    })
    .eq("id", replyId);

  if (error) {
    throw error;
  }
}

/* ========================================
   UPDATE ADVERTISER
======================================== */

async function updateAdvertiserFromReply(
  reply,
  classification
) {
  if (!reply.advertiser_id) {
    return;
  }

  let status = null;

  switch (classification) {
    case "interested":
      status = "interested";
      break;

    case "not_interested":
      status = "not_interested";
      break;

    case "needs_info":
      status = "contacted";
      break;

    case "out_of_office":
      status = "contacted";
      break;

    default:
      return;
  }

  const { error } = await supabase
    .from("advertisers")
    .update({
      status,
    })
    .eq(
      "id",
      reply.advertiser_id
    );

  if (error) {
    throw error;
  }

  console.log(
    `Advertiser ${reply.advertiser_id} status updated to ${status}`
  );
}

/* ========================================
   SALES OPPORTUNITY
======================================== */

async function upsertSalesOpportunity(
  reply,
  classification
) {
  if (
    classification !== "interested" ||
    !reply.advertiser_id
  ) {
    return null;
  }

  const now =
    new Date().toISOString();

  const campaignId =
    reply.campaign_id &&
    reply.campaign_id !== "null"
      ? reply.campaign_id
      : null;

  let existingQuery = supabase
    .from("sales_opportunities")
    .select("id")
    .eq(
      "advertiser_id",
      reply.advertiser_id
    );

  if (campaignId) {
    existingQuery =
      existingQuery.eq(
        "campaign_id",
        campaignId
      );
  } else {
    existingQuery =
      existingQuery.is(
        "campaign_id",
        null
      );
  }

  const {
    data: existing,
    error: findError,
  } = await existingQuery
    .limit(1)
    .maybeSingle();

  if (findError) {
    throw findError;
  }

  const opportunityScore =
    Math.round(
      Number(
        reply.classification_confidence ??
          0.9
      ) * 100
    );

  if (existing) {
    const { data, error } =
      await supabase
        .from("sales_opportunities")
        .update({
          reply_id: reply.id,

          status: "open",

          stage: "interested",

          opportunity_score:
            opportunityScore,

          priority: "hot",

          last_reply_at:
            reply.received_at || now,

          updated_at: now,
        })
        .eq("id", existing.id)
        .select()
        .single();

    if (error) {
      throw error;
    }

    console.log(
      `Sales opportunity updated: ${data.id}`
    );

    return data;
  }

  const { data, error } = await supabase
    .from("sales_opportunities")
    .insert({
      advertiser_id:
        reply.advertiser_id,

      campaign_id: campaignId,

      reply_id: reply.id,

      status: "open",

      stage: "interested",

      opportunity_score:
        opportunityScore,

      priority: "hot",

      source:
        "reply_intelligence",

      last_reply_at:
        reply.received_at || now,

      updated_at: now,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  console.log(
    `Sales opportunity created: ${data.id}`
  );

  return data;
}

/* ========================================
   CLASSIFY SINGLE REPLY
======================================== */

async function classifyReply(reply) {
  if (!reply?.id) {
    throw new Error(
      "Reply id is required"
    );
  }

  const result =
    classifyReplyContent({
      subject: reply.subject,

      body: reply.body,
    });

  await updateAdvertiserFromReply(
    reply,
    result.classification
  );

  await updateReplyClassification(
    reply.id,
    result
  );

  await upsertSalesOpportunity(
    {
      ...reply,

      classification_confidence:
        result.confidence,
    },
    result.classification
  );

  console.log(
    `Reply ${reply.id} classified as ${result.classification}`
  );

  return {
    replyId: reply.id,

    ...result,
  };
}

/* ========================================
   GET UNCLASSIFIED REPLIES
======================================== */

async function getUnclassifiedReplies() {
  const { data, error } = await supabase
    .from("replies")
    .select("*")
    .is("classification", null)
    .order("created_at", {
      ascending: true,
    })
    .limit(50);

  if (error) {
    throw error;
  }

  return data || [];
}

/* ========================================
   RUN REPLY CLASSIFIER
======================================== */

async function runReplyClassifier() {
  console.log(
    "\n========== REPLY CLASSIFIER =========="
  );

  const replies =
    await getUnclassifiedReplies();

  console.log(
    `Found ${replies.length} unclassified replies`
  );

  const results = [];

  for (const reply of replies) {
    try {
      const result =
        await classifyReply(reply);

      results.push(result);
    } catch (error) {
      console.error(
        `Reply classification failed for ${reply.id}:`,
        error
      );

      results.push({
        replyId: reply.id,

        classification: "failed",

        error:
          error instanceof Error
            ? error.message
            : "Classification failed",
      });
    }
  }

  console.log(
    "Reply classification completed:",
    results
  );

  return results;
}

/* ========================================
   EXPORTS
======================================== */

module.exports = {
  classifyReplyContent,

  updateReplyClassification,

  updateAdvertiserFromReply,

  upsertSalesOpportunity,

  classifyReply,

  getUnclassifiedReplies,

  runReplyClassifier,
};