import { useEffect } from "react";

type PageMeta = {
  title: string;
  description?: string;
  canonical?: string;
  image?: string;
};

function upsertMeta(nameOrProperty: string, value: string, property = false) {
  const selector = property
    ? `meta[property="${nameOrProperty}"]`
    : `meta[name="${nameOrProperty}"]`;
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    if (property) element.setAttribute("property", nameOrProperty);
    else element.setAttribute("name", nameOrProperty);
    document.head.appendChild(element);
  }
  element.content = value;
}

export function usePageMeta({ title, description, canonical, image }: PageMeta) {
  useEffect(() => {
    document.title = title;
    if (description) upsertMeta("description", description);
    if (canonical) {
      let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "canonical";
        document.head.appendChild(link);
      }
      link.href = canonical;
    }
    upsertMeta("og:title", title, true);
    if (description) upsertMeta("og:description", description, true);
    if (canonical) upsertMeta("og:url", canonical, true);
    if (image) upsertMeta("og:image", image, true);
  }, [title, description, canonical, image]);
}