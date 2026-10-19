
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const failures = new Rate("aeroFlyy_request_failures");
const pageLatency = new Trend("aeroFlyy_public_page_latency", true);

const baseUrl = (
  __ENV.BASE_URL || "http://localhost:3000"
).replace(/\/$/, "");

const routes = [
  "/",
  "/tours",
  "/destinations",
  "/services",
  "/about",
  "/contact",
  "/robots.txt",
  "/sitemap.xml",
];

export const options = {
  scenarios: {
    public_browsing: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        {
          duration: __ENV.WARMUP || "30s",
          target: Number(__ENV.TARGET_VUS || 10),
        },
        {
          duration: __ENV.HOLD || "60s",
          target: Number(__ENV.TARGET_VUS || 10),
        },
        { duration: "20s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<1500"],
    aeroFlyy_request_failures: ["rate<0.02"],
    aeroFlyy_public_page_latency: ["p(95)<1500"],
  },
};

export default function () {
  const route = routes[Math.floor(Math.random() * routes.length)];
  const response = http.get(`${baseUrl}${route}`, {
    headers: {
      "User-Agent": "aeroFlyy-Phase16-k6/1.0",
    },
    tags: { route },
    timeout: "10s",
  });

  pageLatency.add(response.timings.duration, { route });

  const passed = check(response, {
    "HTTP status is successful": (r) =>
      r.status >= 200 && r.status < 400,
    "response is not a server error": (r) => r.status < 500,
  });

  failures.add(!passed);
  sleep(0.5 + Math.random());
}
