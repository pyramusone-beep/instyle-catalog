'use strict';

function cleanCredential(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');
}

function credentialsMatch({ submittedUsername, submittedPassword, ownerUsername, passwordHash, verifyPassword }) {
  const username = String(submittedUsername == null ? '' : submittedUsername).trim();
  const password = String(submittedPassword == null ? '' : submittedPassword);
  return username === ownerUsername &&
    Boolean(passwordHash) &&
    verifyPassword(password, passwordHash);
}

module.exports = { cleanCredential, credentialsMatch };
