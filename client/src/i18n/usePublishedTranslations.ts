import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { LanguageCode } from "@/i18n/translations";

type TranslationMap = Record<
  string,
  Record<string, string>
>;

export function usePublishedTranslations(
  entityType:
    | "tour"
    | "destination"
    | "itinerary"
    | "attraction"
    | "faq"
    | "policy"
    | "company",
  entityIds: Array<string | number>,
  language: LanguageCode,
) {
  const idsKey = [
    Array.from(entityIds.map(String).filter(Boolean)),
  ]
    .sort()
    .join(",");

  const [translations, setTranslations] =
    useState<TranslationMap>({});

  useEffect(() => {
    let active = true;

    if (language === "en" || !idsKey) {
      setTranslations({});
      return () => {
        active = false;
      };
    }

    void supabase
      .from("content_translations")
      .select(
        "entity_id,field_key,translated_value,review_status,requires_approval,reviewed_at",
      )
      .eq("entity_type", entityType)
      .eq("language_code", language)
      .eq("review_status", "published")
      .in("entity_id", idsKey.split(","))
      .then(({ data, error }) => {
        if (!active) return;

        if (error) {
          setTranslations({});
          return;
        }

        const next: TranslationMap = {};

        for (const row of data ?? []) {
          if (
            row.requires_approval &&
            !row.reviewed_at
          ) {
            continue;
          }

          if (!row.translated_value?.trim()) {
            continue;
          }

          next[row.entity_id] ??= {};
          next[row.entity_id][row.field_key] =
            row.translated_value;
        }

        setTranslations(next);
      });

    return () => {
      active = false;
    };
  }, [entityType, idsKey, language]);

  return translations;
}