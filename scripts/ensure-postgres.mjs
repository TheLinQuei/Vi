import { spawnSync } from "node:child_process";

const CONTAINER_NAME = "vi-postgres";
const IMAGE = "postgres:16";
const PORT = "5432";
const USER = "postgres";
const PASSWORD = "postgres";
const DB = "vi";

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8" });
}

function runDocker(args) {
  return run("docker", args);
}

function fail(message, details) {
  console.error(message);
  if (details) console.error(details);
  process.exit(1);
}

const dockerVersion = runDocker(["--version"]);
if (dockerVersion.status !== 0) {
  fail(
    "Docker is required for dev:up but the CLI is not available. Install Docker Desktop (https://www.docker.com/) or start Postgres manually and set DATABASE_URL.",
    dockerVersion.stderr?.trim(),
  );
}

const dockerInfo = runDocker(["info"]);
if (dockerInfo.status !== 0) {
  fail(
    "Docker is installed but the daemon is not running. Open Docker Desktop and wait until it is ready, then try again.",
    dockerInfo.stderr?.trim() || dockerInfo.stdout?.trim(),
  );
}

const inspect = runDocker(["inspect", "-f", "{{.State.Running}}", CONTAINER_NAME]);
if (inspect.status === 0) {
  const isRunning = inspect.stdout.trim() === "true";
  if (!isRunning) {
    const start = runDocker(["start", CONTAINER_NAME]);
    if (start.status !== 0) {
      fail(`Failed to start existing container "${CONTAINER_NAME}".`, start.stderr?.trim());
    }
    console.log(`Started existing container "${CONTAINER_NAME}".`);
  } else {
    console.log(`Container "${CONTAINER_NAME}" is already running.`);
  }
  process.exit(0);
}

const create = runDocker([
  "run",
  "--name",
  CONTAINER_NAME,
  "-e",
  `POSTGRES_USER=${USER}`,
  "-e",
  `POSTGRES_PASSWORD=${PASSWORD}`,
  "-e",
  `POSTGRES_DB=${DB}`,
  "-p",
  `${PORT}:5432`,
  "-d",
  IMAGE,
]);

if (create.status !== 0) {
  fail(`Failed to create container "${CONTAINER_NAME}".`, create.stderr?.trim());
}

console.log(`Created and started container "${CONTAINER_NAME}" on port ${PORT}.`);
