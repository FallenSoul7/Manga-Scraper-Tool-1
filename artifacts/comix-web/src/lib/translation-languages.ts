export interface TranslationLanguageOption {
  value: string;
  label: string;
  keywords?: readonly string[];
}

export const TRANSLATION_LANGUAGE_OPTIONS = [
  { value: "Afrikaans", label: "Afrikaans" },
  { value: "Albanian", label: "Albanian" },
  { value: "Amharic", label: "Amharic" },
  { value: "Arabic", label: "Arabic" },
  { value: "Armenian", label: "Armenian" },
  { value: "Assamese", label: "Assamese" },
  { value: "Azerbaijani", label: "Azerbaijani" },
  { value: "Basque", label: "Basque" },
  { value: "Bengali", label: "Bengali" },
  { value: "Bosnian", label: "Bosnian" },
  { value: "Bulgarian", label: "Bulgarian" },
  { value: "Burmese", label: "Burmese" },
  { value: "Catalan", label: "Catalan" },
  { value: "Chinese (Simplified)", label: "Chinese (Simplified)" },
  { value: "Chinese (Traditional)", label: "Chinese (Traditional)" },
  { value: "Chichewa", label: "Chichewa" },
  { value: "Croatian", label: "Croatian" },
  { value: "Czech", label: "Czech" },
  { value: "Danish", label: "Danish" },
  { value: "Dutch", label: "Dutch" },
  { value: "English", label: "English" },
  { value: "Esperanto", label: "Esperanto" },
  { value: "Estonian", label: "Estonian" },
  { value: "Filipino", label: "Filipino", keywords: ["Tagalog"] },
  { value: "Finnish", label: "Finnish" },
  { value: "French", label: "French" },
  { value: "Galician", label: "Galician" },
  { value: "Georgian", label: "Georgian" },
  { value: "German", label: "German" },
  { value: "Greek", label: "Greek" },
  { value: "Gujarati", label: "Gujarati" },
  { value: "Haitian Creole", label: "Haitian Creole" },
  { value: "Hausa", label: "Hausa" },
  { value: "Hebrew", label: "Hebrew" },
  { value: "Hindi", label: "Hindi" },
  { value: "Hungarian", label: "Hungarian" },
  { value: "Icelandic", label: "Icelandic" },
  { value: "Igbo", label: "Igbo" },
  { value: "Indonesian", label: "Indonesian" },
  { value: "Irish", label: "Irish" },
  { value: "Italian", label: "Italian" },
  { value: "Japanese", label: "Japanese" },
  { value: "Kannada", label: "Kannada" },
  { value: "Kazakh", label: "Kazakh" },
  { value: "Khmer", label: "Khmer" },
  { value: "Korean", label: "Korean" },
  { value: "Kurdish", label: "Kurdish" },
  { value: "Kyrgyz", label: "Kyrgyz" },
  { value: "Lao", label: "Lao" },
  { value: "Latin", label: "Latin" },
  { value: "Latvian", label: "Latvian" },
  { value: "Lithuanian", label: "Lithuanian" },
  { value: "Luxembourgish", label: "Luxembourgish" },
  { value: "Macedonian", label: "Macedonian" },
  { value: "Malay", label: "Malay" },
  { value: "Malayalam", label: "Malayalam" },
  { value: "Maltese", label: "Maltese" },
  { value: "Marathi", label: "Marathi" },
  { value: "Mongolian", label: "Mongolian" },
  { value: "Nepali", label: "Nepali" },
  { value: "Norwegian", label: "Norwegian" },
  { value: "Odia", label: "Odia" },
  { value: "Pashto", label: "Pashto" },
  { value: "Persian", label: "Persian" },
  { value: "Polish", label: "Polish" },
  { value: "Portuguese", label: "Portuguese" },
  { value: "Punjabi", label: "Punjabi" },
  { value: "Romanian", label: "Romanian" },
  { value: "Russian", label: "Russian" },
  { value: "Serbian", label: "Serbian" },
  { value: "Sesotho", label: "Sesotho" },
  { value: "Sindhi", label: "Sindhi" },
  { value: "Sinhala", label: "Sinhala" },
  { value: "Slovak", label: "Slovak" },
  { value: "Slovenian", label: "Slovenian" },
  { value: "Somali", label: "Somali" },
  { value: "Spanish", label: "Spanish" },
  { value: "Swahili", label: "Swahili" },
  { value: "Swedish", label: "Swedish" },
  { value: "Tamil", label: "Tamil" },
  { value: "Telugu", label: "Telugu" },
  { value: "Thai", label: "Thai" },
  { value: "Tibetan", label: "Tibetan" },
  { value: "Tigrinya", label: "Tigrinya" },
  { value: "Turkish", label: "Turkish" },
  { value: "Turkmen", label: "Turkmen" },
  { value: "Ukrainian", label: "Ukrainian" },
  { value: "Urdu", label: "Urdu" },
  { value: "Uzbek", label: "Uzbek" },
  { value: "Vietnamese", label: "Vietnamese" },
  { value: "Welsh", label: "Welsh" },
  { value: "Xhosa", label: "Xhosa" },
  { value: "Yiddish", label: "Yiddish" },
  { value: "Yoruba", label: "Yoruba" },
  { value: "Zulu", label: "Zulu" },
] as const satisfies readonly TranslationLanguageOption[];

export const SOURCE_LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  ...TRANSLATION_LANGUAGE_OPTIONS,
] as const satisfies readonly TranslationLanguageOption[];

export const TARGET_LANGUAGE_OPTIONS = TRANSLATION_LANGUAGE_OPTIONS;
export const DEFAULT_TARGET_LANGUAGE = "English";

const TARGET_LANGUAGE_STORAGE_KEY = "comihub-ai-target-language";
const SOURCE_LANGUAGE_STORAGE_KEY = "comihub-ai-source-language";

function readPreference(
  key: string,
  options: readonly TranslationLanguageOption[],
  fallback: string,
): string {
  try {
    const saved = typeof window === "undefined" ? null : window.localStorage.getItem(key);
    return saved && options.some(option => option.value === saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function writePreference(key: string, value: string, options: readonly TranslationLanguageOption[]): void {
  if (!options.some(option => option.value === value)) return;
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  } catch {
    // Translation still works when browser storage is unavailable.
  }
}

export function getSavedTranslationTargetLanguage(): string {
  return readPreference(TARGET_LANGUAGE_STORAGE_KEY, TARGET_LANGUAGE_OPTIONS, DEFAULT_TARGET_LANGUAGE);
}

export function saveTranslationTargetLanguage(language: string): void {
  writePreference(TARGET_LANGUAGE_STORAGE_KEY, language, TARGET_LANGUAGE_OPTIONS);
}

export function getSavedTranslationSourceLanguage(): string {
  return readPreference(SOURCE_LANGUAGE_STORAGE_KEY, SOURCE_LANGUAGE_OPTIONS, "auto");
}

export function saveTranslationSourceLanguage(language: string): void {
  writePreference(SOURCE_LANGUAGE_STORAGE_KEY, language, SOURCE_LANGUAGE_OPTIONS);
}
