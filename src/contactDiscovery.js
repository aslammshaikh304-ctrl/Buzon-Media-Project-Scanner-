const { chromium } = require("playwright");

const CONTACT_PATH_KEYWORDS = [
  "contact",
  "advertise",
  "advertising",
  "partnership",
  "partnerships",
  "business",
  "media-kit",
  "media",
  "press",
  "about-us",
  "about",
];

const BLOCKED_EMAIL_DOMAINS = new Set([
  "example.com",
  "sentry.io",
  "wixpress.com",
  "cloudflare.com",
]);

const BLOCKED_EMAIL_EXTENSIONS = [
  ".avif",
  ".webp",
  ".jpeg",
  ".jpg",
  ".png",
  ".gif",
  ".svg",
];

function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).href;
  } catch {
    try {
      return new URL(`https://${value}`).href;
    } catch {
      return null;
    }
  }
}

function normalizeEmail(value) {
  if (!value) {
    return null;
  }

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, "")
    .split("?")[0];
}

function isValidEmail(email) {
  if (!email) {
    return false;
  }

  if (
    BLOCKED_EMAIL_EXTENSIONS.some(
      (extension) =>
        email.toLowerCase().endsWith(extension)
    )
  ) {
    return false;
  }

  const match = email.match(
    /^[^\s@]+@([^\s@]+\.[^\s@]+)$/
  );

  if (!match) {
    return false;
  }

  const domain = match[1].toLowerCase();

  if (BLOCKED_EMAIL_DOMAINS.has(domain)) {
    return false;
  }

  return true;
}

function scoreEmail(email) {
  const localPart = email
    .split("@")[0]
    .toLowerCase();

  const scores = {
    sales: 100,
    advertise: 100,
    advertising: 100,
    partnerships: 95,
    partnership: 95,
    business: 90,
    marketing: 90,
    media: 85,
    contact: 80,
    hello: 75,
    info: 70,
    press: 65,
    pr: 60,
    affiliate: 60,
    support: 50,
    tips: 40,
  };

  return scores[localPart] || 40;
}

function getSocialType(value) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^www\./, "");

    if (
      hostname === "linkedin.com" ||
      hostname.endsWith(".linkedin.com")
    ) {
      return "linkedin";
    }

    if (
      hostname === "t.me" ||
      hostname === "telegram.me" ||
      hostname.endsWith(".telegram.me")
    ) {
      return "telegram";
    }

    if (
      hostname === "twitter.com" ||
      hostname === "x.com" ||
      hostname.endsWith(".twitter.com")
    ) {
      return "twitter";
    }

    return null;
  } catch {
    return null;
  }
}

function isContactPage(value, websiteUrl) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    const website = new URL(websiteUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    if (url.hostname !== website.hostname) {
      return false;
    }

    const path = url.pathname.toLowerCase();

    return CONTACT_PATH_KEYWORDS.some(
      (keyword) => {
        const pattern = new RegExp(
          `(^|[-_/])${keyword}($|[-_/])`,
          "i"
        );

        return pattern.test(path);
      }
    );
  } catch {
    return false;
  }
}

async function extractPageContacts(
  page,
  sourceUrl,
  websiteUrl
) {
  const data = await page.evaluate(() => {
    const bodyText =
      document.body?.innerText || "";

    const html =
      document.documentElement?.innerHTML || "";

    const links = Array.from(
      document.querySelectorAll("a[href]")
    ).map((link) => ({
      href: link.href,
      text: link.innerText?.trim() || "",
    }));

    return {
      bodyText,
      html,
      links,
    };
  });

  const emailCandidates = new Set();

  const combinedText =
    `${data.bodyText}\n${data.html}`;

  const emailMatches =
    combinedText.match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
    ) || [];

  for (const email of emailMatches) {
    const normalizedEmail =
      normalizeEmail(email);

    if (isValidEmail(normalizedEmail)) {
      emailCandidates.add(normalizedEmail);
    }
  }

  for (const link of data.links) {
    if (
      link.href
        .toLowerCase()
        .startsWith("mailto:")
    ) {
      const normalizedEmail =
        normalizeEmail(link.href);

      if (isValidEmail(normalizedEmail)) {
        emailCandidates.add(normalizedEmail);
      }
    }
  }

  const socials = {
    linkedin: null,
    telegram: null,
    twitter: null,
  };

  let contactFormUrl = null;

  for (const link of data.links) {
    const socialType =
      getSocialType(link.href);

    if (
      socialType &&
      !socials[socialType]
    ) {
      socials[socialType] = link.href;
    }

    if (
      !contactFormUrl &&
      isContactPage(
        link.href,
        websiteUrl
      )
    ) {
      contactFormUrl = link.href;
    }
  }

  const emails = Array.from(
    emailCandidates
  )
    .map((email) => ({
      email,
      score: scoreEmail(email),
      sourceUrl,
    }))
    .sort((a, b) => b.score - a.score);

  return {
    emails,
    linkedin: socials.linkedin,
    telegram: socials.telegram,
    twitter: socials.twitter,
    contactFormUrl,
  };
}

function mergeContactData(current, next) {
  const emailMap = new Map();

  for (const item of [
    ...current.emails,
    ...next.emails,
  ]) {
    const existing =
      emailMap.get(item.email);

    if (
      !existing ||
      item.score > existing.score
    ) {
      emailMap.set(item.email, item);
    }
  }

  return {
    emails: Array.from(
      emailMap.values()
    ).sort((a, b) => b.score - a.score),

    linkedin:
      current.linkedin || next.linkedin,

    telegram:
      current.telegram || next.telegram,

    twitter:
      current.twitter || next.twitter,

    contactFormUrl:
      current.contactFormUrl ||
      next.contactFormUrl,
  };
}

async function discoverContacts(advertiser) {
  const websiteUrl = normalizeUrl(
    advertiser.website_url ||
      advertiser.domain
  );

  if (!websiteUrl) {
    throw new Error(
      "Advertiser website URL missing"
    );
  }

  console.log(
    `Discovering contacts: ${advertiser.company_name}`
  );

  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,

    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149 Safari/537.36",
  });

  const page = await context.newPage();

  let contactData = {
    emails: [],
    linkedin: null,
    telegram: null,
    twitter: null,
    contactFormUrl: null,
  };

  const visitedUrls = new Set();

  try {
    await page.goto(websiteUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForTimeout(3000);

    visitedUrls.add(page.url());

    const homeContacts =
      await extractPageContacts(
        page,
        page.url(),
        websiteUrl
      );

    contactData = mergeContactData(
      contactData,
      homeContacts
    );

    const contactLinks =
      await page.evaluate(
        ({ keywords, origin }) => {
          return Array.from(
            document.querySelectorAll(
              "a[href]"
            )
          )
            .map((link) => link.href)
            .filter((href) => {
              try {
                const url = new URL(href);

                if (
                  url.protocol !== "http:" &&
                  url.protocol !== "https:"
                ) {
                  return false;
                }

                if (
                  url.origin !== origin
                ) {
                  return false;
                }

                const path =
                  url.pathname.toLowerCase();

                return keywords.some(
                  (keyword) => {
                    const pattern =
                      new RegExp(
                        `(^|[-_/])${keyword}($|[-_/])`,
                        "i"
                      );

                    return pattern.test(path);
                  }
                );
              } catch {
                return false;
              }
            })
            .slice(0, 5);
        },
        {
          keywords:
            CONTACT_PATH_KEYWORDS,

          origin:
            new URL(websiteUrl).origin,
        }
      );

    for (const contactUrl of contactLinks) {
      if (visitedUrls.has(contactUrl)) {
        continue;
      }

      visitedUrls.add(contactUrl);

      try {
        await page.goto(contactUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });

        await page.waitForTimeout(1500);

        const pageContacts =
          await extractPageContacts(
            page,
            page.url(),
            websiteUrl
          );

        contactData = mergeContactData(
          contactData,
          pageContacts
        );
      } catch {
        console.log(
          `Contact page failed: ${contactUrl}`
        );
      }
    }

    const primaryEmail =
      contactData.emails[0] || null;

    const result = {
      advertiserId: advertiser.id,

      companyName:
        advertiser.company_name,

      email:
        primaryEmail?.email || null,

      emailScore:
        primaryEmail?.score || 0,

      linkedin:
        contactData.linkedin,

      telegram:
        contactData.telegram,

      twitter:
        contactData.twitter,

      contactFormUrl:
        contactData.contactFormUrl,

      sourceUrl:
        primaryEmail?.sourceUrl ||
        websiteUrl,

      allEmails:
        contactData.emails,

      visitedPages:
        Array.from(visitedUrls),
    };

    console.log(
      "Contact discovery result:",
      result
    );

    return result;
  } finally {
    await browser.close();
  }
}

module.exports = {
  discoverContacts,
};