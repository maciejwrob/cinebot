// Integracja z Claude API - analiza wiadomości pod kątem filmów, seriali i muzyki

const Anthropic = require('@anthropic-ai/sdk');
const logger = require('./utils/logger');
const { truncate } = require('./utils/helpers');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Cache ostatnich wiadomości dla kontekstu rozmów
// Klucz: channelId, wartość: tablica ostatnich wiadomości
const messageCache = new Map();
const CACHE_SIZE = 50;
const CACHE_TTL = 30 * 60 * 1000; // 30 minut

/**
 * Dodaje wiadomość do cache kontekstowego
 * @param {string} channelId - ID kanału
 * @param {Object} message - Obiekt wiadomości
 */
function addToCache(channelId, message) {
  if (!messageCache.has(channelId)) {
    messageCache.set(channelId, []);
  }

  const cache = messageCache.get(channelId);
  cache.push({
    author: message.author.username,
    content: message.content,
    timestamp: Date.now(),
    id: message.id,
    // Jeśli wiadomość jest odpowiedzią, zapisz ID wiadomości-rodzica
    replyTo: message.reference?.messageId || null,
  });

  // Ogranicz rozmiar cache
  if (cache.length > CACHE_SIZE) {
    cache.shift();
  }

  // Usuń stare wpisy
  const now = Date.now();
  const filtered = cache.filter((m) => now - m.timestamp < CACHE_TTL);
  messageCache.set(channelId, filtered);
}

/**
 * Pobiera ostatnie wiadomości z cache jako kontekst
 * @param {string} channelId - ID kanału
 * @param {number} [count=5] - Liczba wiadomości do pobrania
 * @returns {string} Sformatowany kontekst
 */
function getContext(channelId, count = 5) {
  const cache = messageCache.get(channelId) || [];
  const recent = cache.slice(-count);

  if (recent.length === 0) return 'Brak poprzednich wiadomości.';

  return recent
    .map((m) => `${m.author}: ${truncate(m.content, 200)}`)
    .join('\n');
}

/**
 * Analizuje wiadomość przez Claude API i określa czy dotyczy mediów
 * @param {Object} message - Obiekt wiadomości Discord
 * @returns {Object|null} Wynik analizy lub null jeśli nie dotyczy mediów
 */
async function analyzeMessage(message) {
  const channelId = message.channel.id;
  const context = getContext(channelId);

  // Dodaj bieżącą wiadomość do cache
  addToCache(channelId, message);

  const prompt = `Jesteś asystentem analizującym rozmowy o filmach, serialach i muzyce na serwerze Discord.

ZADANIE:
Przeanalizuj poniższą wiadomość i określ:
1. Czy dotyczy filmu, serialu lub muzyki?
2. Jaki jest tytuł (jeśli wymieniony)?
3. Czy wiadomość zawiera SPOILERY?
4. Krótki fragment rozmowy (max 100 znaków) BEZ spoilerów

KONTEKST POPRZEDNICH WIADOMOŚCI:
${context}

WIADOMOŚĆ DO ANALIZY:
${message.content}

ODPOWIEDZ WYŁĄCZNIE W FORMACIE JSON (bez dodatkowego tekstu):
{
  "is_media_related": boolean,
  "media_type": "film" | "serial" | "music" | null,
  "title": string | null,
  "has_spoilers": boolean,
  "safe_snippet": string | null,
  "context_reference": string | null
}

ZASADY:
- Jeśli ktoś pisze "też mi się podobało" bez nazwy, sprawdź kontekst i przypisz do ostatniego tytułu
- Fragmenty ze spoilerami CAŁKOWICIE POMIŃ - safe_snippet powinien być null
- Bądź konserwatywny - wątpliwości = spoiler
- Polski język traktuj jako podstawowy
- Jeśli wiadomość nie dotyczy żadnych mediów, ustaw is_media_related na false
- Tytuły podawaj w oryginalnej formie (nie tłumacz)`;

  try {
    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const responseText = response.content[0].text.trim();

    // Wyciągnij JSON z odpowiedzi (może być otoczony blokiem kodu)
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const result = JSON.parse(jsonStr);

    if (result.is_media_related && result.title) {
      logger.info(`AI detected: "${result.title}" (${result.media_type}) - spoilers: ${result.has_spoilers}`);
      return result;
    }

    // Jeśli jest odwołanie do kontekstu ale bez tytułu, spróbuj powiązać
    if (result.is_media_related && result.context_reference) {
      logger.info(`AI detected context reference: "${result.context_reference}"`);
      return result;
    }

    return null;
  } catch (error) {
    logger.error('AI analysis failed', error.message);
    return null;
  }
}

module.exports = {
  analyzeMessage,
  addToCache,
};
