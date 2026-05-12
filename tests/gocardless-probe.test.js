const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAccessToken,
  filterInstitutions,
  listInstitutions,
  loadConfig,
  parseArgs,
  validateConfig,
} = require("../tools/finance/gocardless_probe");

function createResponse({ body, ok = true, status = 200, statusText = "OK" }) {
  return {
    ok,
    status,
    statusText,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

test("gocardless probe parser defaults to Portugal Revolut institution search", () => {
  assert.deepEqual(parseArgs(["doctor"]), {
    baseUrl: "https://bankaccountdata.gocardless.com/api/v2",
    command: "doctor",
    country: "PT",
    search: "revolut",
  });
  assert.deepEqual(parseArgs(["institutions"]), {
    baseUrl: "https://bankaccountdata.gocardless.com/api/v2",
    command: "institutions",
    country: "PT",
    search: "revolut",
  });
  assert.deepEqual(parseArgs(["institutions", "--country", "es", "--search", "n26"]), {
    baseUrl: "https://bankaccountdata.gocardless.com/api/v2",
    command: "institutions",
    country: "ES",
    search: "n26",
  });
});

test("gocardless probe config accepts Sable-prefixed credentials", () => {
  const config = loadConfig({
    SABLE_GOCARDLESS_SECRET_ID: "id",
    SABLE_GOCARDLESS_SECRET_KEY: "key",
  });

  assert.equal(config.secretId, "id");
  assert.equal(config.secretKey, "key");
  assert.deepEqual(validateConfig(config), []);
  assert.deepEqual(validateConfig({ ...config, secretKey: "" }), [
    "SABLE_GOCARDLESS_SECRET_KEY or GOCARDLESS_SECRET_KEY",
  ]);
});

test("gocardless probe creates an access token with json request first", async () => {
  const calls = [];
  const token = await createAccessToken(
    {
      baseUrl: "https://example.test/api/v2",
      secretId: "id",
      secretKey: "key",
    },
    async (url, init) => {
      calls.push({ init, url });
      return createResponse({ body: { access: "access", refresh: "refresh" } });
    }
  );

  assert.equal(token.access, "access");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.test/api/v2/token/new/");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
});

test("gocardless probe lists and filters institutions", async () => {
  const calls = [];
  const institutions = await listInstitutions(
    {
      baseUrl: "https://example.test/api/v2",
      secretId: "id",
      secretKey: "key",
    },
    { country: "PT" },
    async (url, init = {}) => {
      calls.push({ init, url });
      if (url.endsWith("/token/new/")) {
        return createResponse({ body: { access: "access" } });
      }
      return createResponse({
        body: [
          { id: "REVOLUT_REVOGB21", name: "Revolut", countries: ["PT"], transaction_total_days: "730" },
          { id: "OTHER", name: "Other Bank", countries: ["PT"] },
        ],
      });
    }
  );

  assert.equal(institutions.length, 2);
  assert.match(calls[1].url, /institutions\/\?country=PT$/);
  assert.equal(calls[1].init.headers.authorization, "Bearer access");
  assert.deepEqual(filterInstitutions(institutions, "revolut").map((item) => item.id), [
    "REVOLUT_REVOGB21",
  ]);
});
