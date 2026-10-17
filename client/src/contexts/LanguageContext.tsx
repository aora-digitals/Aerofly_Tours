import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  translate,
  type LanguageCode,
  type TranslationKey,
} from "@/i18n/translations";

type LanguageContextValue = {
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => Promise<void>;
  t: (key: TranslationKey) => string;
  languageOptions: Array<{
    value: LanguageCode;
    label: string;
  }>;
};

const LanguageContext =
  createContext<LanguageContextValue | null>(null);

const OPTIONS = [
  { value: "en" as const, label: "English" },
  { value: "mr" as const, label: "मराठी" },
];

export function LanguageProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = useAuth();

  const [language, setLanguageState] =
    useState<LanguageCode>(() => {
      if (typeof window === "undefined") return "en";

      const saved = window.localStorage.getItem(
        "aerofly_language",
      );

      return saved === "mr" ? "mr" : "en";
    });

  useEffect(() => {
    const profileLanguage =
      user?.profile?.preferred_language;

    if (
      profileLanguage === "en" ||
      profileLanguage === "mr"
    ) {
      setLanguageState(profileLanguage);
      window.localStorage.setItem(
        "aerofly_language",
        profileLanguage,
      );
    }
  }, [
    user?.id,
    user?.profile?.preferred_language,
  ]);

  const setLanguage = useCallback(
    async (next: LanguageCode) => {
      if (next !== "en" && next !== "mr") return;

      setLanguageState(next);

      window.localStorage.setItem(
        "aerofly_language",
        next,
      );

      document.documentElement.lang =
        next === "mr" ? "mr-IN" : "en-IN";

      if (user?.id) {
        const { error } = await supabase
          .from("profiles")
          .update({ preferred_language: next })
          .eq("id", user.id);

        if (error) {
          throw new Error(
            "Language changed for this session, but the profile preference could not be saved.",
          );
        }
      }
    },
    [user?.id],
  );

  useEffect(() => {
    document.documentElement.lang =
      language === "mr" ? "mr-IN" : "en-IN";
  }, [language]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: (key: TranslationKey) =>
        translate(language, key),
      languageOptions: OPTIONS,
    }),
    [language, setLanguage],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const value = useContext(LanguageContext);

  if (!value) {
    throw new Error(
      "useLanguage must be used inside LanguageProvider",
    );
  }

  return value;
}