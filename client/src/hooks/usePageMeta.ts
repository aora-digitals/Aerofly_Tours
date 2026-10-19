
import { useEffect } from "react";

type StructuredData = Record<string, unknown>;

type PageMeta = {
  title: string;
  description?: string;
  canonical?: string;
  image?: string;
  indexable?: boolean;
  language?: string;
  structuredData?: StructuredData | null;
};

const SITE_NAME = "AeroFly Tours";
const DEFAULT_DESCRIPTION =
  "Explore domestic and international journeys with AeroFly Tours.";

const SITE_ORIGIN = (
  import.meta.env.VITE_SITE_URL || "https://aerofly.com"
).replace(/\/+$/, "");

function upsertMeta(
  key: string,
  value: string,
  attribute: "name" | "property" = "name",
) {
  let element = document.head.querySelector<HTMLMetaElement>(
    `meta[${attribute}="${CSS.escape(key)}"]`,
  );

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }

  element.content = value;
}

function canonicalUrl(value?: string): string {
  const fallback = `${window.location.pathname}`;
  const input = value || fallback;

  try {
    const parsed = new URL(input, SITE_ORIGIN);

    // Only canonicalize pages on the configured public site.
    const path = parsed.pathname.replace(/\/{2,}/g, "/");
    const normalizedPath =
      path === "/" ? "/" : path.replace(/\/$/, "");

    return `${SITE_ORIGIN}${normalizedPath}`;
  } catch {
    return `${SITE_ORIGIN}/`;
  }
}

function safePublicUrl(value?: string): string | undefined {
  if (!value) return undefined;

  try {
    const parsed = new URL(value, SITE_ORIGIN);

    if (
      parsed.protocol !== "https:" &&
      parsed.protocol !== "http:"
    ) {
      return undefined;
    }

    return parsed.href;
  } catch {
    return undefined;
  }
}

function upsertCanonical(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );

  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.appendChild(element);
  }

  element.href = href;
}

export function usePageMeta({
  title,
  description = DEFAULT_DESCRIPTION,
  canonical,
  image,
  indexable = true,
  language,
  structuredData,
}: PageMeta) {
  useEffect(() => {
    const safeTitle = title.trim().slice(0, 120) || SITE_NAME;
    const safeDescription = description
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 320);

    const canonicalHref = canonicalUrl(canonical);
    const imageHref = safePublicUrl(image);

    const robots = indexable
      ? "index,follow,max-image-preview:large"
      : "noindex,nofollow,noarchive";

    document.title = safeTitle;
    document.documentElement.lang = language || "en-IN";

    upsertMeta("description", safeDescription);
    upsertMeta("robots", robots);
    upsertMeta("googlebot", robots);

    upsertMeta("og:type", "website", "property");
    upsertMeta("og:site_name", SITE_NAME, "property");
    upsertMeta("og:title", safeTitle, "property");
    upsertMeta("og:description", safeDescription, "property");
    upsertMeta("og:url", canonicalHref, "property");

    upsertMeta(
      "og:locale",
      language === "mr-IN" || language === "mr"
        ? "mr_IN"
        : "en_IN",
      "property",
    );

    upsertMeta(
      "twitter:card",
      imageHref ? "summary_large_image" : "summary",
    );
    upsertMeta("twitter:title", safeTitle);
    upsertMeta("twitter:description", safeDescription);

    upsertCanonical(canonicalHref);

    if (imageHref) {
      upsertMeta("og:image", imageHref, "property");
      upsertMeta("twitter:image", imageHref);
    } else {
      document.head
        .querySelector('meta[property="og:image"]')
        ?.remove();

      document.head
        .querySelector('meta[name="twitter:image"]')
        ?.remove();
    }

    const jsonLdId = "aerofly-page-structured-data";
    document.getElementById(jsonLdId)?.remove();

    if (structuredData && indexable) {
      const script = document.createElement("script");
      script.id = jsonLdId;
      script.type = "application/ld+json";
      script.textContent = JSON.stringify(structuredData).replace(
        /</g,
        "\\u003c",
      );

      document.head.appendChild(script);
    }

    return () => {
      document.getElementById(jsonLdId)?.remove();
    };
  }, [
    title,
    description,
    canonical,
    image,
    indexable,
    language,
    structuredData,
  ]);
}
