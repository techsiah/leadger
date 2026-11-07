/* =========================================================
   TrustX Ledger — AI / LLM configuration (FREE providers only)
   -----------------------------------------------------------------
   TWO PATHS — neither costs money, neither needs a credit card:

   1. GOOGLE GEMINI (recommended, free tier)
      - Sign up at https://aistudio.google.com/ with any Google account
      - Go to "Get API key" → "Create API key"
      - NO credit card / billing is ever requested for the free tier
      - Free limits (as of 2026): 1,500 requests/day, 15 RPM, 1M tokens/day
        — plenty for a small shop.
      - Restrict the key in Google Cloud Console → API Keys if you want
        (HTTP referrer restriction to your hosting domain).

      The key can be supplied TWO ways, in this order:

        a) PASTED INTO THE APP — the Scan receipt banner has an
           "Add free Gemini key" field. It is kept in this device's
           localStorage under `trustx.geminiKey`, so it is never written
           into the repository and never travels with a deploy. This is
           the recommended path: no file editing, no redeploy, and the
           secret stays on the shop's own device.
        b) PASTED INTO THIS FILE — `geminiApiKey` below, for an operator
           who wants the key baked into the build. Leave it as the
           placeholder unless you mean it: a key committed to a public
           repository is a key anybody can spend.

   2. FULLY OFFLINE OCR (no API key at all)
      - If neither source has a real key, the app will automatically
        load Tesseract.js from a CDN on first use, run OCR 100% in the
        browser (no data leaves your device), then parse the resulting
        text with Indian-receipt regex heuristics.
      - Accurate enough for clearly PRINTED receipts. It cannot read
        handwriting at all — Tesseract is trained on printed glyphs, so a
        handwritten note comes back as noise or as "could not read any
        text". Handwriting needs the Gemini path above. The scan screen
        says so plainly instead of failing silently.

   WHICH MODEL
   Google retires model names without much warning; `gemini-1.5-flash`
   was retired on 2025-09-24 and answering 404 for every call, which
   looked exactly like "the scanner is broken". So the model is chosen
   at runtime from `geminiModel` + `geminiModelFallbacks`, and any
   404/429/503 moves down the list rather than dying on the first name.

   Receipt images are processed for extraction, and the photo itself is kept
   with the sale in Firestore (dayHeads/{dateKey}/receiptImages/{txnId}) — not
   in Cloud Storage, which this project does not use. The stored copy is
   re-encoded smaller than the AI copy, because it has to fit inside a 1 MiB
   Firestore document as base64.
   ========================================================= */

export const AI_CONFIG = {
  /* ---------------- Primary: Google Gemini (free tier) ----------------
     `gemini-3.5-flash-lite` was measured reading a handwritten Indian
     shop note — all four lines, the date and the total — in ~10s, and it
     stays inside the scan screen's patience. The non-lite name is kept as
     a fallback because it is periodically serving503 "high demand";
     a scan that waits on one busy model is a scan the shopkeeper closes. */
  geminiApiKey: "YOUR_GEMINI_API_KEY_HERE",
  geminiModel: "gemini-3.5-flash-lite",
  geminiModelFallbacks: ["gemini-3.5-flash"],
  /* Google AI Studio endpoint (public, no OAuth; API key in query string). */
  geminiEndpoint: "https://generativelanguage.googleapis.com/v1beta",

  /* ---------------- Shared image preprocessing ---------------- */
  maxImageSizeMb: 3.5,
  downscaleLongEdge: 1400,
  jpegQuality: 0.82,

  /* ---------------- The copy stored with the sale ----------------
     Smaller than the AI copy on purpose. The stored photo lives in a
     Firestore document (base64 costs 4/3 on top of the JPEG) and a bill only
     has to stay readable on a phone screen. */
  storeLongEdge: 1000,
  storeJpegQuality: 0.72,
};

const PLACEHOLDER_TOKENS = ["YOUR_", "XXXXXXXX", "xxxx"];

/* The device-local key. A namespace, not a bare name: this app shares the
   origin with nothing else of its own, but a key that could be clobbered by
   any other script on the page is a key that disappears on somebody else's
   schedule. */
const DEVICE_KEY_NAME = "trustx.geminiKey";

/**
 * localStorage, or null. Guarded the same way js/quota.js guards it: this
 * module is imported by tests and by pages that may run in a context where
 * touching `localStorage` throws outright (Safari private mode does).
 */
function deviceStore() {
  if (typeof localStorage === "undefined") return null;
  try {
    localStorage.setItem("__trustx_probe", "1");
    localStorage.removeItem("__trustx_probe");
    return localStorage;
  } catch (_) {
    return null;
  }
}

/** The key on this device, or "" when there is none. Never throws. */
export function hasDeviceGeminiKey() {
  const s = deviceStore();
  if (!s) return false;
  try {
    const v = s.getItem(DEVICE_KEY_NAME);
    return typeof v === "string" && v.trim().length > 10;
  } catch (_) {
    return false;
  }
}

/** Store a key on this device. Throws when storage is unavailable. */
export function saveGeminiKey(raw) {
  const key = String(raw || "").trim();
  if (key.length < 10) {
    throw new Error("That does not look like a Gemini API key — it is too short.");
  }
  if (PLACEHOLDER_TOKENS.some((t) => key.includes(t))) {
    throw new Error("That is the placeholder, not a real key.");
  }
  const s = deviceStore();
  if (!s) throw new Error("This browser is not storing anything (private mode?). Edit js/ai-config.js instead.");
  s.setItem(DEVICE_KEY_NAME, key);
  return key;
}

/** Forget the key on this device; the file's key, if any, takes over. */
export function clearGeminiKey() {
  const s = deviceStore();
  if (s) {
    try {
      s.removeItem(DEVICE_KEY_NAME);
    } catch (_) {
      /* nothing to forget */
    }
  }
}

/**
 * The key actually in force: the device's own first, the file's second.
 * Both trimmed; "" when neither is a real key.
 */
export function resolveGeminiKey() {
  const s = deviceStore();
  if (s) {
    try {
      const v = s.getItem(DEVICE_KEY_NAME);
      if (typeof v === "string" && v.trim().length > 10) return v.trim();
    } catch (_) {
      /* fall through to the file */
    }
  }
  const fileKey = AI_CONFIG.geminiApiKey;
  return typeof fileKey === "string" ? fileKey.trim() : "";
}

export function isGeminiConfigured() {
  const k = resolveGeminiKey();
  return k.length > 10 && !PLACEHOLDER_TOKENS.some((t) => k.includes(t));
}

export function aiSetupNotice() {
  if (isGeminiConfigured()) return null;
  return (
    "Running in fully-offline OCR mode: it reads PRINTED bills only. " +
    "Handwritten notes need a FREE Google Gemini key — paste one below " +
    "(aistudio.google.com, no credit card) or edit js/ai-config.js."
  );
}

export function noKeyModeLabel() {
  return isGeminiConfigured() ? "Gemini AI" : "Offline OCR";
}
