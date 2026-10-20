#!/usr/bin/env node

import { readdir } from "node:fs/promises";
import path from "node:path";

const directory = path.resolve("supabase/migrations");

const files = (
  await readdir(directory)
)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const invalid = files.filter(
  (name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name),
);

const stamps = files.map((name) => name.slice(0, 14));

const duplicates = stamps.filter(
  (stamp, index) => stamps.indexOf(stamp) !== index,
);

for (const name of files) console.log(name);

if (invalid.length || duplicates.length) {
  if (invalid.length) {
    console.error(
      `Invalid migration filenames: ${invalid.join(", ")}`,
    );
  }

  if (duplicates.length) {
    console.error(
      `Duplicate migration timestamps: ${
        [...new Set(duplicates)].join(", ")
      }`,
    );
  }

  process.exitCode = 1;
} else {
  console.log(
    `Migration filename audit passed (${files.length} timestamped SQL migrations).`,
  );
}
