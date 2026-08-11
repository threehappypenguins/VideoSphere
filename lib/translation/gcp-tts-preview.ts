// =============================================================================
// Short sample phrases for GCP TTS voice previews in the admin UI
// =============================================================================

/**
 * Default English preview line when no language-specific sample exists.
 */
export const GCP_TTS_PREVIEW_FALLBACK_TEXT = 'Hello. This is a short voice preview.';

/**
 * Returns a short preview phrase for a listen language (keeps TTS quota tiny).
 * @param listenLanguage - Channel listen language code (e.g. `es`, `zh`, `yue`).
 * @returns Sample text to synthesize.
 */
export function gcpTtsPreviewTextForLanguage(listenLanguage: string): string {
  const code = listenLanguage.trim().toLowerCase();
  const samples: Record<string, string> = {
    en: 'Hello. This is a short voice preview.',
    es: 'Hola. Esta es una breve vista previa de la voz.',
    pt: 'Olá. Esta é uma breve prévia da voz.',
    fr: 'Bonjour. Ceci est un court aperçu de la voix.',
    de: 'Hallo. Das ist eine kurze Stimmvorschau.',
    it: 'Ciao. Questa è una breve anteprima della voce.',
    nl: 'Hallo. Dit is een korte stemvoorbeeld.',
    pl: 'Cześć. To krótki podgląd głosu.',
    ru: 'Здравствуйте. Это короткое демо голоса.',
    uk: 'Вітаю. Це короткий демо-голос.',
    zh: '你好。这是一段简短的语音试听。',
    yue: '你好。呢段係簡短嘅語音試聽。',
    ja: 'こんにちは。これは短い音声プレビューです。',
    ko: '안녕하세요. 짧은 음성 미리듣기입니다.',
    ar: 'مرحبًا. هذه معاينة قصيرة للصوت.',
    hi: 'नमस्ते। यह एक छोटी आवाज़ का पूर्वावलोकन है।',
    bn: 'নমস্কার। এটি একটি সংক্ষিপ্ত ভয়েস প্রিভিউ।',
    tr: 'Merhaba. Bu kısa bir ses önizlemesidir.',
    vi: 'Xin chào. Đây là bản xem trước giọng nói ngắn.',
    th: 'สวัสดี นี่คือตัวอย่างเสียงสั้น ๆ',
    id: 'Halo. Ini adalah pratinjau suara singkat.',
    ms: 'Hai. Ini pratonton suara yang ringkas.',
    sv: 'Hej. Det här är en kort röstförhandsvisning.',
    da: 'Hej. Dette er en kort stemmeforhåndsvisning.',
    no: 'Hei. Dette er en kort stemmeforhåndsvisning.',
    fi: 'Hei. Tämä on lyhyt ääniesikatselu.',
    tl: 'Kumusta. Ito ay isang maikling preview ng boses.',
    el: 'Γεια σας. Αυτό είναι ένα σύντομο δείγμα φωνής.',
    he: 'שלום. זהו תצוגה מקדימה קצרה של הקול.',
    cs: 'Ahoj. Toto je krátký náhled hlasu.',
    ro: 'Bună. Aceasta este o scurtă previzualizare a vocii.',
    hu: 'Szia. Ez egy rövid hangminta.',
    ta: 'வணக்கம். இது ஒரு குறுகிய குரல் முன்னோட்டம்.',
    te: 'నమస్కారం. ఇది చిన్న వాయిస్ ప్రివ్యూ.',
    sw: 'Habari. Hii ni onyesho fupi la sauti.',
    af: 'Hallo. Dit is ’n kort stemvoorskou.',
  };
  return samples[code] || GCP_TTS_PREVIEW_FALLBACK_TEXT;
}
