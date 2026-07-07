require("dotenv").config();

const {
  getAvailableSmtpAccounts,
  selectSmtpAccount,
} = require("./smtpManager");

async function run() {
  console.log("Testing SMTP manager...");

  const accounts =
    await getAvailableSmtpAccounts();

  console.log(
    `Available SMTP accounts: ${accounts.length}`
  );

  console.dir(
    accounts.map((account) => ({
      id: account.id,
      name: account.name,
      email: account.email,
      dailyLimit: account.daily_limit,
      sentToday: account.sent_today,
      healthStatus: account.health_status,
      lastUsedAt: account.last_used_at,
    })),
    {
      depth: null,
    }
  );

  const selectedAccount =
    await selectSmtpAccount();

  console.log("\nSelected SMTP account:");

  if (!selectedAccount) {
    console.log(
      "No SMTP account currently available"
    );

    return;
  }

  console.dir(
    {
      id: selectedAccount.id,
      name: selectedAccount.name,
      email: selectedAccount.email,
      dailyLimit: selectedAccount.daily_limit,
      sentToday: selectedAccount.sent_today,
      healthStatus:
        selectedAccount.health_status,
    },
    {
      depth: null,
    }
  );
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(
      "SMTP manager test failed:",
      error
    );

    process.exit(1);
  });