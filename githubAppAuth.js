import jwt from 'jsonwebtoken';
import fs from 'fs';

const GITHUB_APP_ID = process.env.GITHUB_APP_ID || "2770727";
const GITHUB_INSTALLATION_ID =
  process.env.GITHUB_INSTALLATION_ID || "107251828";

// Supports env OR pem file
const GITHUB_PRIVATE_KEY = process.env.GITHUB_PRIVATE_KEY
  ? process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n')
  : fs.readFileSync('./github-app.pem', 'utf8');

let cachedToken = null;
let tokenExpiresAt = 0;

function createJWT() {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 9 * 60,
      iss: GITHUB_APP_ID,
    },
    GITHUB_PRIVATE_KEY,
    { algorithm: 'RS256' }
  );
}

export async function getGitHubHeaders() {
  const now = Date.now();

  // reuse token if still valid
  if (cachedToken && now < tokenExpiresAt) {
    return {
      Authorization: `Bearer ${cachedToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'GitHub-App',
    };
  }

  const jwtToken = createJWT();

  const res = await fetch(
    `https://api.github.com/app/installations/${GITHUB_INSTALLATION_ID}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        Accept: 'application/vnd.github+json',
      },
    }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub App token failed: ${t}`);
  }

  const data = await res.json();

  cachedToken = data.token;
  tokenExpiresAt = new Date(data.expires_at).getTime() - 60_000;

  return {
    Authorization: `Bearer ${cachedToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'GitHub-App',
  };
}
