const {
  sendEmail,
} = require("./emailSender");

async function run() {
  try {
    console.log(
      "Testing email sender..."
    );

    const result = await sendEmail({
      to: "test@example.com",

      subject:
        "BUZON Intel email engine test",

      text:
        "This is a test email from BUZON Intel.",

      html: `
        <p>
          This is a test email from
          <strong>BUZON Intel</strong>.
        </p>
      `,
    });

    console.log(
      "Email sender result:"
    );

    console.log(result);
  } catch (error) {
    console.error(
      "Email sender test failed:",
      error
    );

    process.exitCode = 1;
  }
}

run();