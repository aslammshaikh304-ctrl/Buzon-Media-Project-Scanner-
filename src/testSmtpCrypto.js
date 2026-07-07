const {
  encryptSmtpPassword,
  decryptSmtpPassword,
} = require("./smtpCrypto");

const password = "MySecretSMTPPassword123";

console.log("Original:", password);

const encrypted =
  encryptSmtpPassword(password);

console.log("Encrypted:", encrypted);

const decrypted =
  decryptSmtpPassword(encrypted);

console.log("Decrypted:", decrypted);

console.log(
  "Match:",
  password === decrypted
);