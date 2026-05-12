#!/usr/bin/env node
"use strict";

const DEFAULT_BASE_URL = "https://bankaccountdata.gocardless.com/api/v2";

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    command: argv[0] || "doctor",
    country: "PT",
    search: "revolut",
    baseUrl: process.env.GOCARDLESS_BANK_DATA_BASE_URL || DEFAULT_BASE_URL,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--country") {
      options.country = String(argv[++index] || options.country).toUpperCase();
    } else if (arg === "--search") {
      options.search = String(argv[++index] || options.search);
    } else if (arg === "--base-url") {
      options.baseUrl = String(argv[++index] || options.baseUrl).replace(/\/+$/, "");
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function loadConfig(env = process.env) {
  return {
    baseUrl: (env.GOCARDLESS_BANK_DATA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    secretId: env.SABLE_GOCARDLESS_SECRET_ID || env.GOCARDLESS_SECRET_ID || "",
    secretKey: env.SABLE_GOCARDLESS_SECRET_KEY || env.GOCARDLESS_SECRET_KEY || "",
  };
}

function validateConfig(config) {
  const missing = [];
  if (!config.secretId) {
    missing.push("SABLE_GOCARDLESS_SECRET_ID or GOCARDLESS_SECRET_ID");
  }
  if (!config.secretKey) {
    missing.push("SABLE_GOCARDLESS_SECRET_KEY or GOCARDLESS_SECRET_KEY");
  }
  return missing;
}

async function createAccessToken(config, fetchImpl = fetch) {
  const jsonAttempt = await requestJson(fetchImpl, `${config.baseUrl}/token/new/`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      secret_id: config.secretId,
      secret_key: config.secretKey,
    }),
  });
  if (jsonAttempt.ok) {
    return jsonAttempt.body;
  }
  if (![400, 415].includes(jsonAttempt.status)) {
    throw new Error(formatApiError("token/new", jsonAttempt));
  }

  const form = new URLSearchParams();
  form.set("secret_id", config.secretId);
  form.set("secret_key", config.secretKey);
  const formAttempt = await requestJson(fetchImpl, `${config.baseUrl}/token/new/`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!formAttempt.ok) {
    throw new Error(formatApiError("token/new", formAttempt));
  }
  return formAttempt.body;
}

async function listInstitutions(config, { country = "PT" } = {}, fetchImpl = fetch) {
  const token = await createAccessToken(config, fetchImpl);
  if (!token.access) {
    throw new Error("GoCardless token response did not include an access token.");
  }
  const url = new URL(`${config.baseUrl}/institutions/`);
  url.searchParams.set("country", country);
  const response = await requestJson(fetchImpl, url.toString(), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token.access}`,
    },
  });
  if (!response.ok) {
    throw new Error(formatApiError("institutions", response));
  }
  return Array.isArray(response.body) ? response.body : response.body.results || [];
}

function filterInstitutions(institutions, search = "revolut") {
  const needle = String(search || "").trim().toLowerCase();
  if (!needle) {
    return institutions;
  }
  return institutions.filter((institution) => {
    const haystack = [
      institution.id,
      institution.name,
      institution.bic,
      institution.transaction_total_days,
      ...(institution.countries || []),
    ]
      .filter((value) => value !== undefined && value !== null)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

async function requestJson(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return {
    body,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText || "",
  };
}

function formatApiError(label, response) {
  const body = response.body ? JSON.stringify(response.body) : "";
  return `GoCardless ${label} failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`;
}

function usage() {
  return [
    "Usage:",
    "  npm run finance:gocardless -- doctor",
    "  npm run finance:gocardless -- token",
    "  npm run finance:gocardless -- institutions --country PT --search revolut",
    "",
    "Environment:",
    "  SABLE_GOCARDLESS_SECRET_ID or GOCARDLESS_SECRET_ID",
    "  SABLE_GOCARDLESS_SECRET_KEY or GOCARDLESS_SECRET_KEY",
  ].join("\n");
}

async function main(argv = process.argv.slice(2), env = process.env) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }
  if (options.help || options.command === "help") {
    console.log(usage());
    return 0;
  }

  const config = {
    ...loadConfig(env),
    baseUrl: options.baseUrl,
  };
  const missing = validateConfig(config);
  if (options.command === "doctor") {
    console.log(
      JSON.stringify(
        {
          ok: missing.length === 0,
          baseUrl: config.baseUrl,
          hasSecretId: Boolean(config.secretId),
          hasSecretKey: Boolean(config.secretKey),
          missing,
        },
        null,
        2
      )
    );
    return missing.length === 0 ? 0 : 1;
  }

  if (missing.length > 0) {
    console.error(`Missing GoCardless credentials: ${missing.join(", ")}`);
    console.error("Create user secrets in the GoCardless Bank Account Data portal first.");
    return 1;
  }

  if (options.command === "token") {
    const token = await createAccessToken(config);
    console.log(
      JSON.stringify(
        {
          ok: true,
          accessExpires: token.access_expires,
          refreshExpires: token.refresh_expires,
          hasAccess: Boolean(token.access),
          hasRefresh: Boolean(token.refresh),
        },
        null,
        2
      )
    );
    return 0;
  }

  if (options.command === "institutions") {
    const institutions = await listInstitutions(config, { country: options.country });
    const matches = filterInstitutions(institutions, options.search);
    console.log(
      JSON.stringify(
        {
          ok: true,
          country: options.country,
          search: options.search,
          totalInstitutions: institutions.length,
          matches: matches.map((institution) => ({
            bic: institution.bic || "",
            countries: institution.countries || [],
            id: institution.id,
            name: institution.name,
            transactionTotalDays: institution.transaction_total_days,
          })),
        },
        null,
        2
      )
    );
    return 0;
  }

  console.error(`Unknown command: ${options.command}`);
  console.error(usage());
  return 2;
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = {
  createAccessToken,
  filterInstitutions,
  listInstitutions,
  loadConfig,
  main,
  parseArgs,
  requestJson,
  validateConfig,
};
