
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const failures = new Rate("aerofly_workflow_failures");

const baseUrl = (__ENV.BASE_URL || "").replace(/\/$/, "");
const endpointList = (__ENV.READ_ONLY_ENDPOINTS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!baseUrl || endpointList.length === 0) {
  throw new Error(
    "Set BASE_URL and READ_ONLY_ENDPOINTS to verified, safe GET endpoints.",
  );
}

for (const endpoint of endpointList) {
  if (
    !endpoint.startsWith("/") ||
    endpoint.startsWith("//") ||
    endpoint.includes("..")
  ) {
    throw new Error(`Invalid relative endpoint: ${endpoint}`);
  }
}

export const options = {
  vus: Number(__ENV.TARGET_VUS || 5),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<1500"],
    aerofly_workflow_failures: ["rate<0.02"],
  },
};

export default function () {
  const endpoint =
    endpointList[Math.floor(Math.random() * endpointList.length)];

  const response = http.get(`${baseUrl}${endpoint}`, {
    headers: {
      "User-Agent": "AeroFly-Phase16-workflow-test/1.0",
    },
    timeout: "10s",
    tags: { endpoint },
  });

  const passed = check(response, {
    "endpoint responds successfully": (r) =>
      r.status >= 200 && r.status < 400,
  });

  failures.add(!passed);
  sleep(1);
}
