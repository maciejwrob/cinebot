// Funkcje pomocnicze używane w całym projekcie

/**
 * Tworzy slug z tytułu do identyfikacji wątków
 * @param {string} title - Tytuł do konwersji
 * @returns {string} Slug
 */
function createSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9ąćęłńóśźż\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
}

/**
 * Generuje ID wątku konwersacji
 * @param {string} channelId - ID kanału Discord
 * @param {string} title - Tytuł media
 * @returns {string} ID wątku
 */
function generateThreadId(channelId, title) {
  const timestamp = Date.now();
  const slug = createSlug(title);
  return `${channelId}-${timestamp}-${slug}`;
}

/**
 * Mapuje nazwy okresów na klauzule SQL
 * @param {string} period - Nazwa okresu (tydzien, miesiac, rok, wszystkie)
 * @returns {{ clause: string, label: string }}
 */
function periodToSql(period) {
  const periods = {
    tydzien: { clause: "mentioned_at >= datetime('now', '-7 days')", label: 'Ostatni Tydzień' },
    miesiac: { clause: "mentioned_at >= datetime('now', '-1 month')", label: 'Ostatni Miesiąc' },
    rok: { clause: "mentioned_at >= datetime('now', '-1 year')", label: 'Ostatni Rok' },
    wszystkie: { clause: '1=1', label: 'Wszystkie' },
  };
  return periods[period] || periods.tydzien;
}

/**
 * Skraca tekst do podanej długości, dodając "..." jeśli przycięty
 * @param {string} text - Tekst do skrócenia
 * @param {number} maxLength - Maksymalna długość
 * @returns {string}
 */
function truncate(text, maxLength = 100) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Formatuje liczbę wzmianek z poprawną formą gramatyczną (po polsku)
 * @param {number} count - Liczba wzmianek
 * @returns {string}
 */
function formatMentionCount(count) {
  if (count === 1) return '1 wzmianka';
  if (count >= 2 && count <= 4) return `${count} wzmianki`;
  return `${count} wzmianek`;
}

/**
 * Tworzy link do wiadomości Discord
 * @param {string} guildId - ID serwera
 * @param {string} channelId - ID kanału
 * @param {string} messageId - ID wiadomości
 * @returns {string} URL do wiadomości
 */
function createMessageLink(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/**
 * Formatuje datę ISO na czytelny format "7 lut 2026"
 * @param {string} isoString - Data w formacie ISO
 * @returns {string}
 */
function formatDate(isoString) {
  if (!isoString) return '?';
  const months = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  const d = new Date(isoString);
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

module.exports = {
  createSlug,
  generateThreadId,
  periodToSql,
  truncate,
  formatMentionCount,
  createMessageLink,
  formatDate,
};
