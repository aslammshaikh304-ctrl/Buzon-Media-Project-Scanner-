const nodemailer = require("nodemailer");

const { supabase } = require("./supabase");

const {
  decryptSmtpPassword,
} = require("./smtpCrypto");

async function checkSmtpAccount(account) {
  console.log(
    `Checking SMTP health: ${account.email}`
  );

  try {
    const password = decryptSmtpPassword(
      account.smtp_password_encrypted
    );

    const transporter =
      nodemailer.createTransport({
        host: account.smtp_host,
        port: account.smtp_port,

        secure:
          Number(account.smtp_port) === 465,

        auth: {
          user: account.smtp_username,
          pass: password,
        },

        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 15000,
      });

    await transporter.verify();

    const checkedAt = new Date().toISOString();

    const { error } = await supabase
      .from("smtp_accounts")
      .update({
        health_status: "healthy",
        last_health_check_at: checkedAt,
      })
      .eq("id", account.id);

    if (error) {
      throw error;
    }

    console.log(
      `SMTP healthy: ${account.email}`
    );

    transporter.close();

    return {
      accountId: account.id,
      email: account.email,
      healthy: true,
    };
  } catch (error) {
    console.error(
      `SMTP unhealthy: ${account.email}`,
      error.message
    );

    const checkedAt = new Date().toISOString();

    const { error: updateError } =
      await supabase
        .from("smtp_accounts")
        .update({
          health_status: "unhealthy",
          last_health_check_at: checkedAt,
        })
        .eq("id", account.id);

    if (updateError) {
      console.error(
        "Failed to update SMTP health:",
        updateError
      );
    }

    return {
      accountId: account.id,
      email: account.email,
      healthy: false,
      error: error.message,
    };
  }
}

async function checkAllSmtpAccounts() {
  console.log(
    "\n========== SMTP HEALTH CHECK =========="
  );

  const { data: accounts, error } =
    await supabase
      .from("smtp_accounts")
      .select("*")
      .eq("is_active", true);

  if (error) {
    throw error;
  }

  console.log(
    `Found ${accounts?.length ?? 0} active SMTP accounts`
  );

  if (!accounts?.length) {
    console.log(
      "No active SMTP accounts to check"
    );

    return [];
  }

  const results = [];

  for (const account of accounts) {
    const result =
      await checkSmtpAccount(account);

    results.push(result);
  }

  console.log(
    "========== SMTP HEALTH SUMMARY =========="
  );

  console.log(results);

  return results;
}

module.exports = {
  checkSmtpAccount,
  checkAllSmtpAccounts,
};