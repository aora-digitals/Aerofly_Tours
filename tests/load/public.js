
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const failures = new Rate("failed_checks");
const responseTime = new Trend(
  "public_response_time",
  true,
);

const baseUrl = ( __ENV.BASE_URL || "" ).replace(/\/$/, "");

if (!baseUrl) {
  throw new Error(
    "Set BASE_URL to a controlled staging URL before running this test.",
  );
}

if (
  !/__staging__|staging|localhost|127\.0\.0\.1/i.test(baseUrl) &&
  __ENV.ALLOW_NON_STAGING !== "true"
) {
  throw new Error(
    "Refusing to load test a non-staging URL. " +
    "Set ALLOW_NON_STAGING=true only with explicit authorization.",
  );
}

const trpcInput = (value) =>
  `?input=${encodeURIComponent(JSON.stringify({ json: value }))}`;

const paths = [
  { path: "/healthz", kind: "health" },
  { path: "/", kind: "html" },
  { path: "/tours", kind: "html" },
  { path: "/destinations", kind: "html" },
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

export const options = {
  summaryTrendStats: [
    "avg",
    "min",
    "med",
    "max",
    "p(90)",
    "p(95)",
    "p(99)",
  ],

  scenarios: {
    public_browse: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        {
          duration: __ENV.RAMP_DURATION || "1m",
          target: Number(__ENV.TARGET_VUS || 10),
        },
        {
          duration: __ENV.HOLD_DURATION || "2m",
          target: Number(__ENV.TARGET_VUS || 10),
        },
        {
          duration: "30s",
          target: 0,
        },
      ],
      gracefulRampDown: "15s",
    },
  },

  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<1500"],
    failed_checks: ["rate<0.02"],
  },
};


let requestIndex = 0;

export default function () {
  const test = paths[requestIndex % paths.length];
  requestIndex++;

  const response = http.get(
    `${baseUrl}${test.path}`,
    {
      tags: {
        journey: "public_browse",
        endpoint: test.path.split("?")[0],
      },
    },
  );

  let contentValid = false;

  if (test.kind === "health") {
    contentValid =
      response.status === 200 &&
      response.json("status") === "ok";
  } else if (test.kind === "trpc") {
    try {
      const body = response.json();

      contentValid =
        Boolean(body?.result?.data) &&
        !body?.error;
    } catch {
      contentValid = false;
    }
  } else {
    contentValid =
      /<html|<!doctype html/i.test(
        String(response.body),
      );
  }

  const ok = check(response, {
    "returns HTTP 200": (r) => r.status === 200,
    "has expected response": () => contentValid,
  });

  failures.add(!ok);
  responseTime.add(response.timings.duration);

  sleep(1);
}

