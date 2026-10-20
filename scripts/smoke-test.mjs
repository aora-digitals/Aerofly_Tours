#!/usr/bin/env node

const baseUrl = (
  process.env.BASE_URL || "http://localhost:3000"
).replace(/\/$/, "");

const timeoutMs = Number.parseInt(
  process.env.SMOKE_TIMEOUT_MS || "8000",
  10,
);

const trpcInput = (value) =>
  `?input=${encodeURIComponent(JSON.stringify({ json: value }))}`;

const paths = [
  { path: "/healthz", kind: "health" },
  { path: "/", kind: "html" },
  { path: "/tours", kind: "html" },
  { path: "/destinations", kind: "html" },
  { path: "/login", kind: "html" },
  {
    path: `/api/trpc/content.tours${trpcInput({
      page: 1,
      pageSize: 12,
      language: "en",
    })}`,
    kind: "trpc",
  },
  {
    path: `/api/trpc/content.destinations${trpcInput({
      language: "en",
    })}`,
    kind: "trpc",
  },
];

let failures = 0;

for (const test of paths) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  const started = performance.now();

  try {
    const response = await fetch(
      `${baseUrl}${test.path}`,
      {
        signal: controller.signal,
        redirect: "manual",
      },
    );

    const elapsed = Math.round(
      performance.now() - started,
    );

    const body =
      test.kind === "health" || test.kind === "trpc"
        ? await response.json()
        : await response.text();

    const securityHeadersPresent =
      response.headers.get(
        "x-content-type-options",
      ) === "nosniff" &&
      response.headers.get("x-request-id") !== null;

    const httpsHeadersPresent =
      !baseUrl.startsWith("https://") ||
      response.headers.get(
        "strict-transport-security",
      ) !== null;

    const contentValid =
      test.kind === "health"
        ? body?.status === "ok" &&
          response.headers.get("cache-control") ===
            "no-store"
        : test.kind === "trpc"
          ? Boolean(body?.result?.data) &&
            !body?.error
          : typeof body === "string" &&
            /<html|<!doctype html/i.test(body);

    const valid =
      response.status === 200 &&
      securityHeadersPresent &&
      httpsHeadersPresent &&
      contentValid;

    console.log(
      `${valid ? "PASS" : "FAIL"} ` +
        `${test.path.split("?")[0]} ` +
        `status=${response.status} ` +
        `latencyMs=${elapsed} ` +
        `securityHeaders=${securityHeadersPresent && httpsHeadersPresent}`,
    );

    if (!valid) failures++;
  } catch (error) {
    failures++;

    console.error(
      `FAIL ${test.path.split("?")[0]} ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

if (failures) {
  console.error(
    `Smoke tests failed: ${failures}/${paths.length}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Smoke tests passed: ${paths.length}/${paths.length}`,
  );
}
