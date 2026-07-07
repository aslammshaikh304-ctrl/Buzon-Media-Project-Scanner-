const express = require("express");
const cors = require("cors");

const { supabase } = require("./supabase");

const {
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
    origin: "http://localhost:3000",
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

app.use(express.json());

/* ========================================
   HEALTH
======================================== */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "buzon-scanner",
    automationIntervalMs:
      AUTOMATION_INTERVAL_MS,
    timestamp: new Date().toISOString(),
  });
});

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
    const result = await scanWebsite({
      url,
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
   CREATE SMTP ACCOUNT
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

      const port = Number(smtpPort);

      const limit = Number(
        dailyLimit || 25
      );

      if (
        !Number.isInteger(port) ||
        port <= 0 ||
        port > 65535
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid SMTP port",
        });
      }

      if (
        !Number.isInteger(limit) ||
        limit <= 0
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid daily limit",
        });
      }

      const encryptedPassword =
        encryptSmtpPassword(
          smtpPassword
        );

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

            smtp_port: port,

            smtp_username:
              smtpUsername.trim(),

            smtp_password_encrypted:
              encryptedPassword,

            daily_limit: limit,

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

      return res.json({
        success: true,

        account: {
          id: data.id,
          name: data.name,
          email: data.email,
          healthStatus:
            data.health_status,
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