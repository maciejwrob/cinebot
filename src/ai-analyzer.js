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

// Licznik do logowania postępu analizy
let analysisStats = { total: 0, found: 0, errors: 0 };

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
    replyTo: message.reference?.messageId || null,
  });

  if (cache.length > CACHE_SIZE) {
    cache.shift();
  }

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

  // Pomijaj bardzo krótkie wiadomości (emoji, "xD", "ok" itp.)
  if (message.content.length < 5) {
    return null;
  }

  const prompt = `Analizujesz wiadomości z polskiego kanału Discord o nazwie "kulturka" - kanał poświęcony filmom, serialom i muzyce.

ZADANIE: Sprawdź czy wiadomość wspomina o jakimkolwiek filmie, serialu, anime, muzyce (artysta, album, piosenka) lub grze.

KONTEKST POPRZEDNICH WIADOMOŚCI:
${context}

WIADOMOŚĆ DO ANALIZY:
"${message.content}"

Odpowiedz TYLKO formatem JSON:
{"is_media_related":true/false,"media_type":"film"/"serial"/"music"/null,"title":"tytuł lub null","has_spoilers":true/false,"safe_snippet":"fragment bez spoilerów max 100 znaków lub null","context_reference":null}

WAŻNE ZASADY:
- Kanał jest o kulturze - bądź OTWARTY na wykrywanie tytułów. Nawet krótkie odniesienia się liczą
- Polskie i angielskie tytuły - oba akceptuj
- Jeśli ktoś pisze zdanie o serialu/filmie ale nie wymienia tytułu, sprawdź kontekst poprzednich wiadomości
- "Rycerz", "Pingwin", "Bialy Lotos" itp. - to mogą być tytuły seriali, rozpoznawaj je
- Anime traktuj jako "serial"
- Gry traktuj jako "film" (brak osobnej kategorii)
- Jeśli wiadomość to tylko emoji, reakcja, pozdrowienie - is_media_related: false
- Spoilery: jeśli ktoś opisuje fabułę/zakończenie/twist - has_spoilers: true, safe_snippet: null
- Nie spoiler: ogólna opinia ("fajny", "nudny", "polecam") - has_spoilers: false`;

  try {
    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const responseText = response.content[0].text.trim();

    // Wyciągnij JSON z odpowiedzi
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const result = JSON.parse(jsonStr);
    analysisStats.total++;

    if (result.is_media_related && result.title) {
      analysisStats.found++;
      logger.info(`AI detected: "${result.title}" (${result.media_type}) in: "${truncate(message.content, 60)}"`);
      return result;
    }

    // Jeśli jest odwołanie do kontekstu ale bez tytułu
    if (result.is_media_related && result.context_reference) {
      logger.info(`AI context ref: "${result.context_reference}" in: "${truncate(message.content, 60)}"`);
      return result;
    }

    // Loguj co 50 wiadomości żeby wiedzieć że działa
    if (analysisStats.total % 50 === 0) {
      logger.info(`Analysis progress: ${analysisStats.total} processed, ${analysisStats.found} found, ${analysisStats.errors} errors`);
    }

    return null;
  } catch (error) {
    analysisStats.errors++;
    logger.error(`AI analysis failed for: "${truncate(message.content, 60)}"`, error.message);
    return null;
  }
}

module.exports = {
  analyzeMessage,
  addToCache,
};
