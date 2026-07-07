require("dotenv").config({
  path: [".env.local", ".env"],
});

const { supabase } = require("./supabase");

const {
  classifyReplyContent,
  classifyReply,
} = require("./replyClassifier");

async function runTest() {
  console.log(
    "\n========== REPLY CLASSIFIER TEST =========="
  );

  let testReplyId = null;

  try {
    console.log(
      "\n1. Testing classification logic..."
    );

    const logicTests = [
      {
        body:
          "Hi, this sounds interesting. Let's discuss and schedule a call.",
        expected: "interested",
      },
      {
        body:
          "No thanks, we are not interested.",
        expected: "not_interested",
      },
      {
        body:
          "Can you send more information about pricing?",
        expected: "needs_info",
      },
      {
        body:
          "Automatic reply. I am currently out of office.",
        expected: "out_of_office",
      },
      {
        body:
          "Thanks for your email.",
        expected: "unknown",
      },
    ];

    for (const test of logicTests) {
      const result =
        classifyReplyContent({
          subject: "Re: Outreach",
          body: test.body,
        });

      console.log({
        expected: test.expected,
        actual: result.classification,
        passed:
          result.classification ===
          test.expected,
      });
    }

    console.log(
      "\n2. Finding test advertiser..."
    );

    const {
      data: advertiser,
      error: advertiserError,
    } = await supabase
      .from("advertisers")
      .select("id, company_name, status")
      .not("id", "is", null)
      .limit(1)
      .single();

    if (advertiserError) {
      throw advertiserError;
    }

    console.log(
      "Test advertiser:",
      advertiser
    );

    console.log(
      "\n3. Creating fake interested reply..."
    );

    const {
      data: reply,
      error: replyError,
    } = await supabase
      .from("replies")
      .insert({
        advertiser_id: advertiser.id,
        from_email:
          "advertiser-test@example.com",
        to_email:
          "outreach@buzon.test",
        subject:
          "Re: Advertising opportunity",
        body:
          "Hi, this sounds interesting. Let's discuss and schedule a call.",
        received_at:
          new Date().toISOString(),
        is_read: false,
      })
      .select("*")
      .single();

    if (replyError) {
      throw replyError;
    }

    testReplyId = reply.id;

    console.log(
      "Fake reply created:",
      reply.id
    );

    console.log(
      "\n4. Running classifier..."
    );

    const classificationResult =
      await classifyReply(reply);

    console.log(
      "Classification result:"
    );

    console.dir(
      classificationResult,
      {
        depth: null,
      }
    );

    console.log(
      "\n5. Checking saved reply..."
    );

    const {
      data: savedReply,
      error: savedReplyError,
    } = await supabase
      .from("replies")
      .select(`
        id,
        classification,
        classification_confidence,
        classification_reason,
        classified_at
      `)
      .eq("id", reply.id)
      .single();

    if (savedReplyError) {
      throw savedReplyError;
    }

    console.log(
      "Saved reply:",
      savedReply
    );

    console.log(
      "\n6. Checking advertiser status..."
    );

    const {
      data: updatedAdvertiser,
      error: updatedAdvertiserError,
    } = await supabase
      .from("advertisers")
      .select("id, company_name, status")
      .eq("id", advertiser.id)
      .single();

    if (updatedAdvertiserError) {
      throw updatedAdvertiserError;
    }

    console.log(
      "Updated advertiser:",
      updatedAdvertiser
    );

    console.log(
      "\n========== TEST COMPLETE =========="
    );
  } catch (error) {
    console.error(
      "\nReply classifier test failed:"
    );

    console.error(error);
  }
}

runTest();