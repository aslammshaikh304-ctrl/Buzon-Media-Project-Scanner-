const nodemailer = require("nodemailer");

const { supabase } = require("./supabase");

const {
  decryptSmtpPassword,
} = require("./smtpCrypto");

/* ========================================
   AVAILABLE SMTP ACCOUNT
======================================== */

async function getAvailableSmtpAccount(
  preferredAccountId = null
) {
  let query = supabase
    .from("smtp_accounts")
    .select("*")
    .eq("is_active", true)
    .eq("health_status", "healthy");

  if (preferredAccountId) {
    query = query.eq(
      "id",
      preferredAccountId
    );
  }

  const { data: accounts, error } =
    await query.order("last_used_at", {
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
      Number(account.sent_today ?? 0) <
      Number(account.daily_limit ?? 0)
  );

  return availableAccount ?? null;
}

/* ========================================
   TRANSPORTER
======================================== */

function createTransporter(account) {
  const password = decryptSmtpPassword(
    account.smtp_password_encrypted
  );

  return nodemailer.createTransport({
    host: account.smtp_host,

    port: Number(account.smtp_port),

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

/* ========================================
   ACCOUNT USAGE
======================================== */

async function markAccountUsed(account) {
  const nextSentToday =
    Number(account.sent_today ?? 0) + 1;

  const { error } = await supabase
    .from("smtp_accounts")
    .update({
      sent_today: nextSentToday,

      last_used_at:
        new Date().toISOString(),
    })
    .eq("id", account.id);

  if (error) {
    throw error;
  }
}

/* ========================================
   SEND EMAIL
======================================== */

async function sendEmail({
  to,
  subject,
  text,
  html,
  replyTo,

  inReplyTo = null,
  references = null,

  preferredSmtpAccountId = null,
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
    await getAvailableSmtpAccount(
      preferredSmtpAccountId
    );

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

    const mailOptions = {
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
    };

    if (inReplyTo) {
      mailOptions.inReplyTo = inReplyTo;
    }

    if (references) {
      mailOptions.references =
        Array.isArray(references)
          ? references
          : [references];
    }

    const result =
      await transporter.sendMail(
        mailOptions
      );

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
  createTransporter,
  sendEmail,
};