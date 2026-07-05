const express = require("express");

const { scanWebsite } = require("./scanner");
const { saveScanResult } = require("./storage");

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "buzon-scanner",
  });
});

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
      storage = await saveScanResult(result);
    }

    return res
      .status(result.success ? 200 : 500)
      .json({
        ...result,
        storage,
      });
  } catch (error) {
    console.error("Scan failed:", error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(
    `BUZON Scanner running on http://localhost:${PORT}`
  );
});