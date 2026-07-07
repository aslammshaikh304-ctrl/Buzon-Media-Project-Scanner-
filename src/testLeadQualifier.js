require("dotenv").config();

const { supabase } = require(
  "./supabase"
);

const {
  qualifyLead,
} = require("./leadQualifier");

async function run() {
  console.log(
    "Testing lead qualification + database save..."
  );

  const {
    data: advertisers,
    error,
  } = await supabase
    .from("advertisers")
    .select(`
      *,
      contacts (*)
    `)
    .limit(10);

  if (error) {
    throw error;
  }

  const results = [];

  let savedCount = 0;
  let failedCount = 0;

  for (const advertiser of advertisers) {
    const contact =
      advertiser.contacts?.[0] || null;

    console.log(
      "\n=========================="
    );

    console.log(
      `Qualifying: ${advertiser.company_name}`
    );

    const result = qualifyLead(
      advertiser,
      contact
    );

    results.push(result);

    console.log(
      `Saving qualification: ${advertiser.company_name}`
    );

    const {
      data: updatedAdvertiser,
      error: updateError,
    } = await supabase
      .from("advertisers")
      .update({
        lead_score: result.leadScore,
        lead_priority: result.leadPriority,
        qualification_status:
          result.qualificationStatus,
        qualification_reason:
          result.qualificationReason,
        qualified_at:
          result.qualifiedAt,
      })
      .eq(
        "id",
        advertiser.id
      )
      .select()
      .single();

    if (updateError) {
      failedCount += 1;

      console.error(
        `❌ Save failed: ${advertiser.company_name}`,
        updateError.message
      );

      continue;
    }

    savedCount += 1;

    console.log(
      `✅ Saved: ${advertiser.company_name}`
    );

    console.log({
      leadScore:
        updatedAdvertiser.lead_score,

      leadPriority:
        updatedAdvertiser.lead_priority,

      qualificationStatus:
        updatedAdvertiser
          .qualification_status,
    });
  }

  console.log(
    "\n========== FINAL RESULTS =========="
  );

  console.dir(results, {
    depth: null,
  });

  console.log(
    "\n========== DATABASE SUMMARY =========="
  );

  console.log(
    `Saved: ${savedCount}`
  );

  console.log(
    `Failed: ${failedCount}`
  );
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(
      "Qualification test failed:",
      error
    );

    process.exit(1);
  });