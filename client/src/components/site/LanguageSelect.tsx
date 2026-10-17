import { Languages } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

export default function LanguageSelect() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <label className="inline-flex items-center gap-2">
      <Languages size={16} aria-hidden="true" />
      <span className="sr-only">{t("language")}</span>

      <select
        aria-label={t("language")}
        className="rounded-lg border border-[#e8e4dd] bg-white px-2 py-2 text-sm"
        value={language}
        onChange={(event) => {
          void setLanguage(
            event.target.value as "en" | "mr",
          );
        }}
      >
        <option value="en">English</option>
        <option value="mr">मराठी</option>
      </select>
    </label>
  );
}