const nodemailer = require("nodemailer");

const { supabase } = require("./supabase");

const {
  decryptSmtpPassword,
} = require("./smtpCrypto");

async function getAvailableSmtpAccount() {
  const { data: accounts, error } =
    await supabase
      .from("smtp_accounts")
      .select("*")
      .eq("is_active", true)
      .eq("health_status", "healthy")
      .order("last_used_at", {
        ascending: true,
        nullsFirst: true,
      });

  if (error) {
    throw error;
  }

  const availableAccount = (
    accounts ?? []
  ).find(
    (account) =>
      account.sent_today <
      account.daily_limit
  );

  return availableAccount ?? null;
}

function createTransporter(account) {
  const password = decryptSmtpPassword(
    account.smtp_password_encrypted
  );

  return nodemailer.createTransport({
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
    socketTimeout: 30000,
  });
}

async function markAccountUsed(account) {
  const nextSentToday =
    Number(account.sent_today ?? 0) + 1;

  const { error } = await supabase
    .from("smtp_accounts")
    .update({
      sent_today: nextSentToday,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", account.id);

  if (error) {
    throw error;
  }
}

async function sendEmail({
  to,
  subject,
  text,
  html,
  replyTo,
}) {
  if (!to) {
    throw new Error(
      "Recipient email is required"
    );
  }

  if (!subject) {
    throw new Error(
      "Email subject is required"
    );
  }

  const account =
    await getAvailableSmtpAccount();

  if (!account) {
    return {
      success: false,
      queued: true,
      error:
        "No healthy SMTP account currently available",
    };
  }

  const transporter =
    createTransporter(account);

  try {
    console.log(
      `Sending email to ${to} using ${account.email}`
    );

    const result =
      await transporter.sendMail({
        from: {
          name:
            account.sender_name ||
            account.name,
          address: account.email,
        },

        to,
        replyTo:
          replyTo || account.email,

        subject,

        text,

        html,
      });

    await markAccountUsed(account);

    console.log(
      `Email sent: ${result.messageId}`
    );

    return {
      success: true,
      queued: false,
      messageId: result.messageId,
      smtpAccountId: account.id,
      senderEmail: account.email,
    };
  } catch (error) {
    console.error(
      `Email send failed to ${to}:`,
      error.message
    );

    return {
      success: false,
      queued: false,
      smtpAccountId: account.id,
      error: error.message,
    };
  } finally {
    transporter.close();
  }
}

module.exports = {
  getAvailableSmtpAccount,
  sendEmail,
};