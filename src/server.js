const express = require("express");
const cors = require("cors");
const { assertPublicHttpUrl, requireApiKey } = require("./security");

const { supabase } = require("./supabase");

const nodemailer = require("nodemailer");
const {
  generateReplyDraft,
} = require("./replyDraftGenerator");

const {
  decryptSmtpPassword,
  encryptSmtpPassword,
} = require("./smtpCrypto");

const {
  scanWebsite,
} = require("./scanner");

const {
  saveScanResult,
} = require("./storage");

const {
  runAutomationCycle,
} = require("./scheduler");

const app = express();

const PORT =
  Number(process.env.PORT) || 4000;

const AUTOMATION_INTERVAL_MS =
  Number(
    process.env.AUTOMATION_INTERVAL_MS
  ) ||
  60 * 1000;

/* ========================================
   MIDDLEWARE
======================================== */

app.use(
  cors({
    origin: (process.env.ALLOWED_ORIGINS || "https://dashboard.buzon.dev").split(","),

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);

app.use(express.json({ limit: "100kb" }));

/* ========================================
   HEALTH
======================================== */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",

    service: "buzon-scanner",

    automationIntervalMs:
      AUTOMATION_INTERVAL_MS,

    timestamp:
      new Date().toISOString(),
  });
});

app.use(requireApiKey);

/* ========================================
   MANUAL WEBSITE SCAN
======================================== */

app.post("/scan", async (req, res) => {
  const {
    url,
    waitTimeMs = 5000,
    maxScrolls = 5,
  } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,

      error: "url is required",
    });
  }

  try {
    const safeUrl = await assertPublicHttpUrl(url);

    const result = await scanWebsite({
      url: safeUrl,
      waitTimeMs,
      maxScrolls,
    });

    let storage = null;

    if (result.success) {
      storage = await saveScanResult(
        result
      );
    }

    return res
      .status(
        result.success ? 200 : 500
      )
      .json({
        ...result,

        storage,
      });
  } catch (error) {
    console.error(
      "Scan failed:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        error instanceof Error
          ? error.message
          : "Scan failed",
    });
  }
});

/* ========================================
   CREATE SMTP + IMAP ACCOUNT
======================================== */

app.post(
  "/smtp-accounts",

  async (req, res) => {
    try {
      const {
        name,
        email,
        senderName,

        smtpHost,
        smtpPort,
        smtpUsername,
        smtpPassword,

        imapHost,
        imapPort,
        imapUsername,
        imapPassword,

        dailyLimit,
      } = req.body;

      if (
        !name ||
        !email ||
        !smtpHost ||
        !smtpPort ||
        !smtpUsername ||
        !smtpPassword
      ) {
        return res.status(400).json({
          success: false,

          error:
            "Missing required SMTP fields",
        });
      }

      const smtpPortNumber =
        Number(smtpPort);

      const dailyLimitNumber =
        Number(dailyLimit || 25);

      if (
        !Number.isInteger(
          smtpPortNumber
        ) ||
        smtpPortNumber <= 0 ||
        smtpPortNumber > 65535
      ) {
        return res.status(400).json({
          success: false,

          error: "Invalid SMTP port",
        });
      }

      if (
        !Number.isInteger(
          dailyLimitNumber
        ) ||
        dailyLimitNumber <= 0
      ) {
        return res.status(400).json({
          success: false,

          error: "Invalid daily limit",
        });
      }

      const hasAnyImapField =
        Boolean(
          imapHost ||
          imapPort ||
          imapUsername ||
          imapPassword
        );

      const hasCompleteImapConfig =
        Boolean(
          imapHost &&
          imapPort &&
          imapUsername &&
          imapPassword
        );

      if (
        hasAnyImapField &&
        !hasCompleteImapConfig
      ) {
        return res.status(400).json({
          success: false,

          error:
            "Complete all IMAP fields or leave all IMAP fields empty",
        });
      }

      let imapPortNumber = null;

      if (hasCompleteImapConfig) {
        imapPortNumber =
          Number(imapPort);

        if (
          !Number.isInteger(
            imapPortNumber
          ) ||
          imapPortNumber <= 0 ||
          imapPortNumber > 65535
        ) {
          return res.status(400).json({
            success: false,

            error: "Invalid IMAP port",
          });
        }
      }

      const encryptedSmtpPassword =
        encryptSmtpPassword(
          smtpPassword
        );

      const encryptedImapPassword =
        hasCompleteImapConfig
          ? encryptSmtpPassword(
              imapPassword
            )
          : null;

      const { data, error } =
        await supabase
          .from("smtp_accounts")
          .insert({
            name: name.trim(),

            email: email
              .trim()
              .toLowerCase(),

            sender_name:
              senderName?.trim() ||
              null,

            smtp_host:
              smtpHost.trim(),

            smtp_port:
              smtpPortNumber,

            smtp_username:
              smtpUsername.trim(),

            smtp_password_encrypted:
              encryptedSmtpPassword,

            imap_host:
              hasCompleteImapConfig
                ? imapHost.trim()
                : null,

            imap_port:
              hasCompleteImapConfig
                ? imapPortNumber
                : null,

            imap_username:
              hasCompleteImapConfig
                ? imapUsername.trim()
                : null,

            imap_password_encrypted:
              encryptedImapPassword,

            daily_limit:
              dailyLimitNumber,

            sent_today: 0,

            health_status: "unknown",

            is_active: true,
          })
          .select()
          .single();

      if (error) {
        console.error(
          "SMTP account insert failed:",
          error
        );

        return res.status(400).json({
          success: false,

          error: error.message,
        });
      }

      console.log(
        `SMTP account created: ${data.email}`
      );

      console.log(
        `IMAP configured: ${Boolean(
          data.imap_host
        )}`
      );

      return res.json({
        success: true,

        account: {
          id: data.id,

          name: data.name,

          email: data.email,

          healthStatus:
            data.health_status,

          imapConfigured:
            Boolean(
              data.imap_host &&
              data.imap_username
            ),
        },
      });
    } catch (error) {
      console.error(
        "SMTP account creation failed:",
        error
      );

      return res.status(500).json({
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "SMTP account creation failed",
      });
    }
  }
);
/* ========================================
   SEND REPLY
======================================== */
/* ========================================
   GENERATE REPLY DRAFT
======================================== */

app.post(
  "/replies/:id/draft",
  async (req, res) => {
    try {
      const { id } = req.params;

      console.log(
        `Generating reply draft: ${id}`
      );

      const result =
        await generateReplyDraft(id);

      return res.json(result);
    } catch (error) {
      console.error(
        "Reply draft generation failed:",
        error
      );

      return res.status(500).json({
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Reply draft generation failed",
      });
    }
  }
);

app.post(
  "/replies/:replyId/send",

  async (req, res) => {
    let transporter = null;

    try {
      const { replyId } = req.params;

      const { message } = req.body;

      const cleanMessage =
        message?.trim();

      if (!cleanMessage) {
        return res.status(400).json({
          success: false,

          error:
            "Reply message is required",
        });
      }

      /* ========================================
         GET ORIGINAL REPLY
      ======================================== */

      const {
        data: reply,
        error: replyError,
      } = await supabase
        .from("replies")
        .select("*")
        .eq("id", replyId)
        .single();

      if (replyError || !reply) {
        console.error(
          "Reply fetch failed:",
          replyError
        );

        return res.status(404).json({
          success: false,

          error: "Reply not found",
        });
      }

      if (!reply.from_email) {
        return res.status(400).json({
          success: false,

          error:
            "Reply sender email missing",
        });
      }

      /* ========================================
         GET SMTP ACCOUNT
      ======================================== */

      const {
        data: smtpAccount,
        error: smtpError,
      } = await supabase
        .from("smtp_accounts")
        .select("*")
        .eq(
          "id",
          reply.smtp_account_id
        )
        .single();

      if (
        smtpError ||
        !smtpAccount
      ) {
        console.error(
          "SMTP account fetch failed:",
          smtpError
        );

        return res.status(404).json({
          success: false,

          error:
            "SMTP account not found",
        });
      }

      const password =
        decryptSmtpPassword(
          smtpAccount
            .smtp_password_encrypted
        );

      /* ========================================
         CREATE TRANSPORTER
      ======================================== */

      transporter =
        nodemailer.createTransport({
          host:
            smtpAccount.smtp_host,

          port: Number(
            smtpAccount.smtp_port
          ),

          secure:
            Number(
              smtpAccount.smtp_port
            ) === 465,

          auth: {
            user:
              smtpAccount.smtp_username,

            pass: password,
          },

          connectionTimeout: 15000,

          greetingTimeout: 15000,

          socketTimeout: 30000,
        });

      /* ========================================
         SUBJECT
      ======================================== */

      let subject =
        reply.subject ||
        "Advertising opportunity";

      if (
        !subject
          .toLowerCase()
          .startsWith("re:")
      ) {
        subject = `Re: ${subject}`;
      }

      /* ========================================
         SEND EMAIL
      ======================================== */

      console.log(
        `Sending reply to ${reply.from_email}`
      );

      const result =
        await transporter.sendMail({
          from: {
            name:
              smtpAccount.sender_name ||
              smtpAccount.name,

            address:
              smtpAccount.email,
          },

          to:
            reply.from_email,

          subject,

          text:
            cleanMessage,

          replyTo:
            smtpAccount.email,

          inReplyTo:
            reply.message_id ||
            undefined,

          references:
            reply.message_id
              ? [reply.message_id]
              : undefined,
        });

      console.log(
        `SMTP reply sent: ${result.messageId}`
      );

      /* ========================================
         SAVE OUTBOUND MESSAGE
      ======================================== */

      const {
        data: outboundMessage,
        error: outboundError,
      } = await supabase
        .from("reply_messages")
        .insert({
          reply_id:
            reply.id,

          direction:
            "outbound",

          from_email:
            smtpAccount.email,

          to_email:
            reply.from_email,

          subject,

          body:
            cleanMessage,

          message_id:
            result.messageId,

          in_reply_to:
            reply.message_id ||
            null,

          sent_at:
            new Date().toISOString(),
        })
        .select()
        .single();

      if (outboundError) {
        console.error(
          "Outbound message save failed:",
          outboundError
        );

        return res.status(500).json({
          success: false,

          emailSent: true,

          error:
            "Email sent but outbound message could not be saved",
        });
      }

      console.log(
        `Outbound message saved: ${outboundMessage.id}`
      );

      return res.json({
        success: true,

        messageId:
          result.messageId,

        message:
          outboundMessage,
      });
    } catch (error) {
      console.error(
        "Reply send failed:",
        error
      );

      return res.status(500).json({
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Reply send failed",
      });
    } finally {
      if (transporter) {
        transporter.close();
      }
    }
  }
);
/* ========================================
   MANUAL AUTOMATION CYCLE
======================================== */

app.post(
  "/automation/run",

  async (req, res) => {
    try {
      console.log(
        "Manual automation cycle requested"
      );

      const result =
        await runAutomationCycle();

      return res.json({
        success: true,

        result,
      });
    } catch (error) {
      console.error(
        "Manual automation cycle failed:",
        error
      );

      return res.status(500).json({
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Automation cycle failed",
      });
    }
  }
);

/* ========================================
   AUTOMATION ENGINE
======================================== */

let automationInterval = null;

async function startAutomation() {
  if (process.env.ENABLE_AUTOMATION !== "true") {
    console.log("Automation is disabled (set ENABLE_AUTOMATION=true to enable it)");
    return;
  }
  console.log(
    `Automation interval: ${AUTOMATION_INTERVAL_MS}ms`
  );

  try {
    await runAutomationCycle();
  } catch (error) {
    console.error(
      "Initial automation cycle failed:",
      error
    );
  }

  automationInterval = setInterval(
    async () => {
      try {
        await runAutomationCycle();
      } catch (error) {
        console.error(
          "Scheduled automation cycle failed:",
          error
        );
      }
    },

    AUTOMATION_INTERVAL_MS
  );
}

/* ========================================
   GRACEFUL SHUTDOWN
======================================== */

async function shutdown(signal) {
  console.log(
    `\n${signal} received. Shutting down...`
  );

  if (automationInterval) {
    clearInterval(
      automationInterval
    );

    automationInterval = null;
  }

  process.exit(0);
}

process.on(
  "SIGINT",

  () => shutdown("SIGINT")
);

process.on(
  "SIGTERM",

  () => shutdown("SIGTERM")
);

/* ========================================
   START SERVER
======================================== */

app.listen(PORT, () => {
  console.log(
    "\n========================================"
  );

  console.log(
    `BUZON Scanner running on port ${PORT}`
  );

  console.log(
    "========================================"
  );

  startAutomation().catch(
    (error) => {
      console.error(
        "Automation startup failed:",
        error
      );
    }
  );
});
