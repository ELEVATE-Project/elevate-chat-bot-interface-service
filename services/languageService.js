// ============================================
// FILE: services/languageService.js
// Handles language selection, translation fetch/store,
// and key lookup for all WhatsApp messages.
// ============================================
const axios = require("axios");
const Logger = require("../utils/logger");
const usersQueries = require("../database/databaseQueries/userQueries");
const LANGUAGE_MESSAGE = require("../generics/common/languageMessage")
// Maps WhatsApp button IDs → locale codes
const LANGUAGE_MAP = {
  language_1: { code: "en", label: "English" },
  language_2: { code: "kn", label: "ಕನ್ನಡ" },
  language_3: { code: "hi", label: "हिंदी" },
  language_4: { code: "te", label: "తెలుగు" },
};

const TRANSLATION_BASE_URL =`${process.env.LANGUAGE_SERVICE_URL}/mohini/locales`;

class LanguageService {
  // ─────────────────────────────────────────
  // 1. Fetch translation.json for a locale and store in user record
  // ─────────────────────────────────────────
  async fetchAndStore(phoneNumber, langButtonId) {
    const lang = LANGUAGE_MAP[langButtonId];
    if (!lang) {
      throw new Error(`Unknown language button id: ${langButtonId}`);
    }

    Logger.info("Fetching translations", { phoneNumber, lang: lang.code });

    const url = `${TRANSLATION_BASE_URL}/${lang.code}/translation.json`;
    const { data: translations } = await axios.get(url, { timeout: 10000 });

    console.log("Fetched translations for", lang.code, "keys:", Object.keys(translations).length);

    // Persist language code + full translation map on the user record
    await usersQueries.update(
      { phoneNumber },
      {
        $set: {
          "scope.language": lang.code,
          "scope.languageLabel": lang.label,
          "scope.translations": translations,
        },
      },
      { new: true }
    );

    Logger.info("Translations stored", {
      phoneNumber,
      lang: lang.code,
      keyCount: Object.keys(translations).length,
    });

    return { langCode: lang.code, langLabel: lang.label, translations };
  }

  // ─────────────────────────────────────────
  // 2. Get a translated string for a user, with an optional fallback
  // ─────────────────────────────────────────
  async t(phoneNumber, key, fallback = key) {
    try {
      const user = await usersQueries.findOne({ phoneNumber });
      return user?.scope?.translations?.[key] ?? fallback;
    } catch {
      return fallback;
    }
  }

  // ─────────────────────────────────────────
  // 3. Batch-translate multiple keys at once (avoids N DB calls)
  //    Returns a plain object { key: translatedValue, ... }
  // ─────────────────────────────────────────
  // async tBatch(phoneNumber, keys) {
  //   try {
  //     const user = await usersQueries.findOne({ phoneNumber });
  //     const translations = user?.scope?.translations || {};
  //     return Object.fromEntries(
  //       keys.map((k) => [k, translations[k] ?? k])
  //     );
  //   } catch {
  //     return Object.fromEntries(keys.map((k) => [k, k]));
  //   }
  // }

  // languageService.js
async tBatch(phoneNumber, keys) {
  const user = await usersQueries.findOne({ phoneNumber });
  const lang = user?.scope?.language || "en";
  
  // Layer 1: DB translations (Mohini-sourced, may have the key)
  const dbTranslations = user?.scope?.translations || {};
  
  // Layer 2: Your static file (WhatsApp bot keys)
  const staticTranslations = LANGUAGE_MESSAGE[lang] || {};
  
  // Layer 3: English fallback
  const fallback = LANGUAGE_MESSAGE["en"] || {};

  const result = {};
  for (const key of keys) {
    result[key] =
      dbTranslations[key] ??      // check DB first
      staticTranslations[key] ??  // then your static file
      fallback[key] ??            // then English fallback
      key;                        // worst case: return the key itself
  }
  return result;
}

  // ─────────────────────────────────────────
  // 4. Get stored language code for a user
  // ─────────────────────────────────────────
  async getLanguage(phoneNumber) {
    try {
      const user = await usersQueries.findOne({ phoneNumber });
      return user?.scope?.language || null;
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────
  // 5. Check if this button ID is a language selection
  // ─────────────────────────────────────────
  isLanguageButton(buttonId) {
    return !!LANGUAGE_MAP[buttonId];
  }

  // ─────────────────────────────────────────
  // 6. Build the language-selection interactive message
  //    (used before any translations are loaded)
  // ─────────────────────────────────────────
  buildLanguageSelectionMessage(to,message="") {
    return {
      to,
      type: "button",
      body: {
        text: `${message !=="" ? message :"👋 Welcome to *Mitra *!"} \n\nPlease select your language:\nकृपया अपनी भाषा चुनें:\nದಯವಿಟ್ಟು ನಿಮ್ಮ ಭಾಷೆಯನ್ನು ಆಯ್ಕೆ ಮಾಡಿ`,
      },
      action: {
        buttons: [
          { type: "quick_reply", title: "English",   id: "language_1" },
          { type: "quick_reply", title: "हिंदी",      id: "language_3" },
          { type: "quick_reply", title: "ಕನ್ನಡ",      id: "language_2" },
          { type:"quick_reply" , title: "తెలుగు" ,  id: "language_4" },
        ],
      },
    };
  }

  // ─────────────────────────────────────────
  // 7. Build the post-language main-menu message using stored translation keys
  //    Keys used: commonPageSelectionText, commonPageButtonText1, commonPageButtonText2
  // ─────────────────────────────────────────
  async buildMainMenuMessage(phoneNumber,message) {
    const keys = [
      "commonPageSelectionText",
      "commonPageButtonText1",
      "commonPageButtonText2",
      "changeLanguageButton"
    ];
    const tx = await this.tBatch(phoneNumber, keys);

    return {
      to: phoneNumber,
      type: "button",
      body: {
        text: message ? message:`🌟 ${tx.commonPageSelectionText}` || "🌟 What would you like to do today?",
      },
      action: {
        buttons: [
          {
            type: "quick_reply",
            title: `🗣️ ${tx.commonPageButtonText2}` || "Capture Discussion",
            id: "capture_discussion",
          },
          {
            type: "quick_reply",
            title: `📖 ${tx.commonPageButtonText1}` || "Record Story",
            id: "record_story",
          },
           {
            type: "quick_reply",
            title: `${tx.changeLanguageButton}` || "Change Language",
            id: "change_language",
          },
        ],
      },
    };
  }
}

module.exports = new LanguageService();