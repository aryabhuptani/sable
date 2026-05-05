#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..", "..");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    json: false,
    repoRoot: DEFAULT_REPO_ROOT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--repo-root") {
      options.repoRoot = path.resolve(argv[++index] || options.repoRoot);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function runShareabilityCheck({
  fsModule = fs,
  repoRoot = DEFAULT_REPO_ROOT,
  spawn = spawnSync,
} = {}) {
  const files = listTrackedFiles({ repoRoot, spawn });
  const findings = [];
  for (const file of files) {
    findings.push(...scanPath(file));
    const absolutePath = path.join(repoRoot, file);
    let content = "";
    try {
      const stat = fsModule.statSync(absolutePath);
      if (!stat.isFile() || stat.size > 2_000_000) {
        continue;
      }
      content = fsModule.readFileSync(absolutePath, "utf8");
    } catch (error) {
      continue;
    }
    findings.push(...scanContent(file, content));
  }
  return {
    checkedFiles: files.length,
    findings,
    ok: findings.every((finding) => finding.severity !== "fail"),
  };
}

function listTrackedFiles({ repoRoot, spawn = spawnSync }) {
  const result = spawn("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if ((result.status || 0) !== 0) {
    throw new Error(`git ls-files failed: ${(result.stderr || "").trim()}`);
  }
  return result.stdout.split("\0").filter(Boolean);
}

function scanPath(file) {
  const findings = [];
  const basename = path.basename(file);
  if (basename === ".env") {
    findings.push(fail(file, "Tracked .env files are not shareable; use .env.example."));
  }
  if (/(^|\/)(\.storage|\.ops|attachment-queue)(\/|$)/.test(file)) {
    findings.push(fail(file, "Tracked runtime state directory is not shareable."));
  }
  if (/(^|\/).+\.session($|\.)/.test(file) || /telethon\.session/.test(file)) {
    findings.push(fail(file, "Tracked session file is not shareable."));
  }
  if (/\.bridge-state\.json$/.test(file)) {
    findings.push(fail(file, "Tracked bridge state is not shareable."));
  }
  return findings;
}

function scanContent(file, content) {
  const findings = [];
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(content)) {
      findings.push(fail(file, pattern.message));
    }
  }

  const phones = content.match(/\+[1-9]\d{7,14}/g) || [];
  for (const phone of phones) {
    if (!isAllowedExamplePhone(file, phone)) {
      findings.push(fail(file, `Possible real phone number ${phone} in tracked content.`));
    }
  }

  if (content.includes("/home/arya") && !isAllowedAryaPathFile(file)) {
    findings.push(fail(file, "Arya-specific absolute path appears outside allowed docs/tests/examples."));
  }

  return findings;
}

const SECRET_PATTERNS = [
  { regex: /sk-[A-Za-z0-9_-]{20,}/, message: "Possible OpenAI-style API key." },
  { regex: /ghp_[A-Za-z0-9_]{20,}/, message: "Possible GitHub token." },
  { regex: /xox[baprs]-[A-Za-z0-9-]{20,}/, message: "Possible Slack token." },
  { regex: /-----BEGIN (?:RSA |OPENSSH |EC |)PRIVATE KEY-----/, message: "Possible private key." },
  { regex: /TYPEFULLY_API_KEY\s*=\s*["']?(?!\.\.\.)[A-Za-z0-9_-]{8,}/, message: "Possible Typefully API key assignment." },
  { regex: /HOME_ASSISTANT_TOKEN\s*=\s*["']?(?!\.\.\.)[A-Za-z0-9_-]{8,}/, message: "Possible Home Assistant token assignment." },
];

function isAllowedExamplePhone(file, phone) {
  if (file.startsWith("tests/")) {
    return true;
  }
  return phone.startsWith("+1555") || phone.startsWith("+1202555")
    ? isDocsOrExample(file) || file.endsWith("README.md") || file.includes("bridge-test-support")
    : false;
}

function isAllowedAryaPathFile(file) {
  return (
    isDocsOrExample(file) ||
    file.startsWith("tests/") ||
    file.endsWith("README.md") ||
    file === "tools/instance/instance-config.js" ||
    file === "tools/instance/instance_config.py" ||
    file === "tools/shareability/check.js"
  );
}

function isDocsOrExample(file) {
  return file.startsWith("docs/") || file.endsWith(".example") || file.endsWith(".env.example");
}

function fail(file, message) {
  return { file, message, severity: "fail" };
}

function formatReport(report) {
  const lines = [
    report.ok ? "Sable shareability check: PASS" : "Sable shareability check: FAIL",
    `checked files: ${report.checkedFiles}`,
  ];
  if (report.findings.length > 0) {
    lines.push("findings:");
    for (const finding of report.findings) {
      lines.push(`- [${finding.severity}] ${finding.file}: ${finding.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function usage() {
  return "Usage: node tools/shareability/check.js [--json] [--repo-root PATH]";
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }
  try {
    const report = runShareabilityCheck(options);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      process.stdout.write(formatReport(report));
    }
    return report.ok ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  formatReport,
  parseArgs,
  runShareabilityCheck,
  scanContent,
  scanPath,
};
