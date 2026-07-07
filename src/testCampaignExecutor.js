require("dotenv").config();

const {
  runCampaignExecutor,
} = require("./campaignExecutor");

async function run() {
  console.log(
    "Testing campaign execution engine..."
  );

  const results = await runCampaignExecutor();

  console.log(
    "\nCampaign executor test completed."
  );

  console.dir(results, {
    depth: null,
  });
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(
      "Campaign executor test failed:",
      error
    );

    process.exit(1);
  });