const {
  supabase,
} = require("./supabase");

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
  "send me details",
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
  "send more details",
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
      classification: "out_of_office",
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
      classification: "not_interested",
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
      classification: "needs_info",
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
      classification: "interested",
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
      status = "needs_info";
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
    .eq("id", reply.advertiser_id);

  if (error) {
    throw error;
  }
}
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

  await updateReplyClassification(
    reply.id,
    result
  );

  await updateAdvertiserFromReply(
    reply,
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

module.exports = {
  classifyReplyContent,
  classifyReply,
  getUnclassifiedReplies,
  runReplyClassifier,
};