const { supabase } = require("./supabase");

const {
  discoverContacts,
} = require("./contactDiscovery");
const {
  saveDiscoveredContacts,
} = require("./contactStorage");

async function run() {
  const {
    data: advertisers,
    error,
  } = await supabase
    .from("advertisers")
    .select("*")
    .eq("status", "new")
    .limit(10);

  if (error) {
    throw error;
  }

  if (
    !advertisers ||
    advertisers.length === 0
  ) {
    console.log(
      "No new advertisers found"
    );

    return;
  }

  console.log(
    `Testing ${advertisers.length} advertisers`
  );

  const results = [];

  for (const advertiser of advertisers) {
    console.log(
      "\n================================"
    );

    console.log(
      `Testing advertiser: ${advertiser.company_name}`
    );

    try {
      const result =
        await discoverContacts(
          advertiser
        );

      results.push(result);
    } catch (error) {
      console.error(
        `Failed: ${advertiser.company_name}`,
        error.message
      );
    }
  }

  console.log(
    "\n\n========= FINAL RESULTS ========="
  );

  console.dir(results, {
    depth: null,
  });

  console.log(
  "\n========== SAVING CONTACTS =========="
);

const storageResults =
  await saveDiscoveredContacts(results);

console.dir(storageResults, {
  depth: null,
});

console.log(
  "\n========== STORAGE SUMMARY =========="
);

console.log(
  "Created:",
  storageResults.filter(
    (item) => item.action === "created"
  ).length
);

console.log(
  "Updated:",
  storageResults.filter(
    (item) => item.action === "updated"
  ).length
);

console.log(
  "Failed:",
  storageResults.filter(
    (item) => item.success === false
  ).length
);

  console.log(
    "\n================================="
  );

  console.log(
    `Advertisers tested: ${advertisers.length}`
  );

  console.log(
    `Emails found: ${
      results.filter(
        (item) => item.email
      ).length
    }`
  );

  console.log(
    `Contact forms found: ${
      results.filter(
        (item) =>
          item.contactFormUrl
      ).length
    }`
  );

  console.log(
    `LinkedIn found: ${
      results.filter(
        (item) => item.linkedin
      ).length
    }`
  );
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(
      "CONTACT DISCOVERY ERROR:",
      error
    );

    process.exit(1);
  });