const TRANSLATION_LANGUAGES = [
  "Afrikaans", "Albanian", "Amharic", "Arabic", "Armenian", "Assamese", "Azerbaijani", "Basque", "Bengali",
  "Bosnian", "Bulgarian", "Burmese", "Catalan", "Chinese (Simplified)", "Chinese (Traditional)", "Chichewa",
  "Croatian", "Czech", "Danish", "Dutch", "English", "Esperanto", "Estonian", "Filipino", "Finnish", "French",
  "Galician", "Georgian", "German", "Greek", "Gujarati", "Haitian Creole", "Hausa", "Hebrew", "Hindi", "Hungarian",
  "Icelandic", "Igbo", "Indonesian", "Irish", "Italian", "Japanese", "Kannada", "Kazakh", "Khmer", "Korean", "Kurdish",
  "Kyrgyz", "Lao", "Latin", "Latvian", "Lithuanian", "Luxembourgish", "Macedonian", "Malay", "Malayalam", "Maltese",
  "Marathi", "Mongolian", "Nepali", "Norwegian", "Odia", "Pashto", "Persian", "Polish", "Portuguese", "Punjabi",
  "Romanian", "Russian", "Serbian", "Sesotho", "Sindhi", "Sinhala", "Slovak", "Slovenian", "Somali", "Spanish",
  "Swahili", "Swedish", "Tamil", "Telugu", "Thai", "Tibetan", "Tigrinya", "Turkish", "Turkmen", "Ukrainian", "Urdu",
  "Uzbek", "Vietnamese", "Welsh", "Xhosa", "Yiddish", "Yoruba", "Zulu",
] as const;

export const SUPPORTED_TARGET_LANGUAGES = new Set<string>(TRANSLATION_LANGUAGES);
export const SUPPORTED_SOURCE_LANGUAGES = new Set<string>(["auto", ...TRANSLATION_LANGUAGES]);
