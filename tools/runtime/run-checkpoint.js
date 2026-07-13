#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { readRunCheckpoint } = require("./run-kernel");

function parseArgs(argv) {
  const options = { controlPath: process.env.SABLE_RUN_CONTROL_PATH || "", runDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--control-path") options.controlPath = argv[++index] || "";
    else if (arg === "--run-dir") options.runDir = argv[++index] || "";
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return "Usage: run-checkpoint.js [--run-dir DIR | --control-path FILE]\nReads SABLE_RUN_CONTROL_PATH by default.";
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    return 64;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const runDir = options.runDir || (options.controlPath ? path.dirname(path.resolve(options.controlPath)) : "");
  if (!runDir) {
    console.error("Missing --run-dir, --control-path, or SABLE_RUN_CONTROL_PATH.");
    return 64;
  }
  const checkpoint = await readRunCheckpoint(runDir);
  console.log(JSON.stringify(checkpoint, null, 2));
  if (checkpoint.cancelled) return 2;
  if (checkpoint.blocked) return 3;
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
