const {
  checkAllSmtpAccounts,
} = require("./smtpHealthChecker");

async function run() {
  try {
    console.log(
      "Testing SMTP health checker..."
    );

    const results =
      await checkAllSmtpAccounts();

    console.log(
      "Health check completed:"
    );

    console.log(results);
  } catch (error) {
    console.error(
      "SMTP health test failed:",
      error
    );

    process.exitCode = 1;
  }
}

run();