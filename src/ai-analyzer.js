// Integracja z Claude API - analiza wiadomości pod kątem filmów, seriali i muzyki

const Anthropic = require('@anthropic-ai/sdk');
const logger = require('./utils/logger');
const { truncate } = require('./utils/helpers');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Cache ostatnich wiadomości dla kontekstu rozmów
const messageCache = new Map();
const CACHE_SIZE = 50;
const CACHE_TTL = 30 * 60 * 1000; // 30 minut

// Mapa messageId → { title, type } - do śledzenia łańcuchów odpowiedzi
const titleMap = new Map();
const TITLE_MAP_MAX = 5000;

// Licznik do logowania postępu analizy
let analysisStats = { total: 0, found: 0, errors: 0 };

/**
 * Dodaje wiadomość do cache kontekstowego
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
 * Zapisuje powiązanie messageId → tytuł
 */
function registerTitle(messageId, title, type) {
  titleMap.set(messageId, { title, type });

  // Ogranicz rozmiar mapy
  if (titleMap.size > TITLE_MAP_MAX) {
    const firstKey = titleMap.keys().next().value;
    titleMap.delete(firstKey);
  }
}

/**
 * Szuka tytułu w łańcuchu odpowiedzi (reply chain)
 * Idzie w górę: wiadomość → parent → grandparent → ...
 * @param {Object} message - Wiadomość Discord
 * @returns {{ title: string, type: string }|null}
 */
function findTitleInReplyChain(message) {
  const replyToId = message.reference?.messageId;
  if (!replyToId) return null;

  // Sprawdź bezpośredniego rodzica
  const parentTitle = titleMap.get(replyToId);
  if (parentTitle) return parentTitle;

  // Sprawdź w cache czy rodzic ma swojego rodzica (łańcuch)
  const channelId = message.channel?.id || message.channelId;
  const cache = messageCache.get(channelId) || [];
  const parentMsg = cache.find((m) => m.id === replyToId);

  if (parentMsg && parentMsg.replyTo) {
    const grandparentTitle = titleMap.get(parentMsg.replyTo);
    if (grandparentTitle) return grandparentTitle;
  }

  return null;
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
    // Nawet krótkie wiadomości - jeśli są reply do znanego tytułu, zarejestruj
    const chainTitle = findTitleInReplyChain(message);
    if (chainTitle) {
      registerTitle(message.id, chainTitle.title, chainTitle.type);
    }
    return null;
  }

  // Sprawdź czy wiadomość jest częścią łańcucha odpowiedzi o znanym tytule
  const chainTitle = findTitleInReplyChain(message);
  let replyContext = '';
  if (chainTitle) {
    replyContext = `\n\nTA WIADOMOŚĆ JEST ODPOWIEDZIĄ W WĄTKU O: "${chainTitle.title}" (${chainTitle.type}). Jeśli wiadomość kontynuuje rozmowę o tym tytule (nawet bez wymieniania go), ustaw is_media_related: true i title: "${chainTitle.title}".`;
  }

  const prompt = `Analizujesz wiadomości z polskiego kanału Discord o nazwie "kulturka" - kanał poświęcony filmom, serialom i muzyce.

ZADANIE: Określ GŁÓWNY tytuł filmu/serialu/muzyki, o którym mówi ta wiadomość.

KONTEKST POPRZEDNICH WIADOMOŚCI:
${context}

WIADOMOŚĆ DO ANALIZY:
"${message.content}"${replyContext}

Odpowiedz TYLKO formatem JSON:
{"is_media_related":true/false,"media_type":"film"/"serial"/"music"/null,"title":"tytuł lub null","has_spoilers":true/false,"safe_snippet":"fragment bez spoilerów max 100 znaków lub null","context_reference":null}

WAŻNE ZASADY:
- KLUCZOWE: Zwróć tytuł, który jest GŁÓWNYM TEMATEM wiadomości, a nie tytuł użyty jako porównanie
  - "To było w stylu Gry o tron" → główny temat to serial, o którym mowa (z kontekstu), NIE "Gra o tron"
  - "Przypomina mi Breaking Bad" → główny temat to to, co jest porównywane, NIE "Breaking Bad"
  - "Rodem z Gry o tron" → to porównanie, szukaj głównego tematu w kontekście
  - "Lepsze niż X", "jak w X", "w stylu X", "porównywalne z X" → X to tylko odniesienie, nie główny temat
  - ALE: "Oglądam Grę o tron", "Gra o tron jest super" → tu Gra o tron JEST głównym tematem
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
      registerTitle(message.id, result.title, result.media_type);
      logger.info(`AI detected: "${result.title}" (${result.media_type}) in: "${truncate(message.content, 60)}"`);
      return result;
    }

    // Jeśli AI nie wykrył tytułu, ale wiadomość jest reply do znanego tytułu
    // i AI uznał że jest media_related - użyj tytułu z łańcucha
    if (chainTitle && result.is_media_related) {
      registerTitle(message.id, chainTitle.title, chainTitle.type);
      logger.info(`Reply chain: "${chainTitle.title}" in: "${truncate(message.content, 60)}"`);
      return {
        ...result,
        title: chainTitle.title,
        media_type: chainTitle.type,
      };
    }

    // Nawet jeśli AI nie uznał za media_related, ale jest reply chain - propaguj tytuł
    // (żeby kolejne reply w łańcuchu też miały kontekst)
    if (chainTitle) {
      registerTitle(message.id, chainTitle.title, chainTitle.type);
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
  registerTitle,
};
