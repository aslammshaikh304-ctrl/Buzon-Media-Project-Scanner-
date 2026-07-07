const CryptoJS = require("crypto-js");
require("dotenv").config();

function getEncryptionKey() {
  const key = process.env.SMTP_ENCRYPTION_KEY;

  if (!key) {
    throw new Error(
      "SMTP_ENCRYPTION_KEY is missing from environment variables"
    );
  }

  return key;
}

function encryptSmtpPassword(password) {
  if (!password) {
    throw new Error("SMTP password is required");
  }

  const key = getEncryptionKey();

  return CryptoJS.AES.encrypt(
    password,
    key
  ).toString();
}

function decryptSmtpPassword(encryptedPassword) {
  if (!encryptedPassword) {
    throw new Error(
      "Encrypted SMTP password is required"
    );
  }

  const key = getEncryptionKey();

  const bytes = CryptoJS.AES.decrypt(
    encryptedPassword,
    key
  );

  const password = bytes.toString(
    CryptoJS.enc.Utf8
  );

  if (!password) {
    throw new Error(
      "SMTP password decryption failed"
    );
  }

  return password;
}

module.exports = {
  encryptSmtpPassword,
  decryptSmtpPassword,
};