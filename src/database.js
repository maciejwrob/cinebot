// Obsługa bazy danych SQLite - tworzenie tabel, zapytania, operacje CRUD

const Database = require('better-sqlite3');
const path = require('path');
const logger = require('./utils/logger');

const DB_PATH = path.join(__dirname, '..', 'database', 'media.db');

let db;

/**
 * Inicjalizuje bazę danych i tworzy tabele jeśli nie istnieją
 */
function initialize() {
  db = new Database(DB_PATH);

  // Włącz tryb WAL dla lepszej wydajności przy współbieżnych odczytach
  db.pragma('journal_mode = WAL');

  // Tworzenie tabeli wątków konwersacji
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_threads (
      thread_id TEXT PRIMARY KEY,
      main_topic TEXT,
      topic_type TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tworzenie tabeli wzmianek o mediach
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      message_id TEXT NOT NULL,
      message_link TEXT NOT NULL,
      context_snippet TEXT,
      mentioned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      conversation_thread_id TEXT,
      FOREIGN KEY (conversation_thread_id) REFERENCES conversation_threads(thread_id)
    )
  `);

  // Indeksy dla szybszych zapytań
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_title ON media_mentions(title);
    CREATE INDEX IF NOT EXISTS idx_type ON media_mentions(type);
    CREATE INDEX IF NOT EXISTS idx_mentioned_at ON media_mentions(mentioned_at);
    CREATE INDEX IF NOT EXISTS idx_thread ON media_mentions(conversation_thread_id);
  `);

  logger.success('Database initialized successfully');
}

/**
 * Dodaje nową wzmiankę o mediach do bazy
 * @param {Object} mention - Dane wzmianki
 */
function addMention(mention) {
  // Sprawdź czy wzmianka z tego message_id już istnieje (deduplikacja)
  const exists = db.prepare(
    'SELECT 1 FROM media_mentions WHERE message_id = ? AND title = ?'
  ).get(mention.messageId, mention.title);

  if (exists) return;

  const stmt = db.prepare(`
    INSERT INTO media_mentions (title, type, user_id, user_name, message_id, message_link, context_snippet, conversation_thread_id, mentioned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    mention.title,
    mention.type,
    mention.userId,
    mention.userName,
    mention.messageId,
    mention.messageLink,
    mention.contextSnippet,
    mention.threadId || null,
    mention.mentionedAt || new Date().toISOString()
  );

  logger.info(`Mention saved: "${mention.title}" (${mention.type}) by ${mention.userName}`);
}

/**
 * Tworzy lub aktualizuje wątek konwersacji
 * @param {Object} thread - Dane wątku
 */
function upsertThread(thread) {
  const stmt = db.prepare(`
    INSERT INTO conversation_threads (thread_id, main_topic, topic_type, started_at, last_activity)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(thread_id) DO UPDATE SET last_activity = CURRENT_TIMESTAMP
  `);

  stmt.run(thread.threadId, thread.mainTopic, thread.topicType);
}

/**
 * Szuka aktywnego wątku o danym tytule w ciągu ostatnich 5 minut
 * @param {string} title - Tytuł media
 * @param {string} channelId - ID kanału
 * @returns {Object|null} Wątek lub null
 */
function findActiveThread(title, channelId) {
  const stmt = db.prepare(`
    SELECT * FROM conversation_threads
    WHERE main_topic = ?
      AND last_activity >= datetime('now', '-5 minutes')
    ORDER BY last_activity DESC
    LIMIT 1
  `);

  return stmt.get(title) || null;
}

/**
 * Pobiera ranking mediów danego typu z podanego okresu
 * @param {string} type - Typ media (film, serial, music)
 * @param {string} periodClause - Klauzula SQL dla okresu
 * @param {number} [limit=10] - Maksymalna liczba wyników
 * @returns {Array} Ranking
 */
function getTopMedia(type, periodClause, limit = 999) {
  const stmt = db.prepare(`
    SELECT
      title,
      COUNT(*) as mention_count,
      COUNT(DISTINCT user_id) as unique_users,
      GROUP_CONCAT(DISTINCT user_name) as users
    FROM media_mentions
    WHERE type = ? AND ${periodClause}
    GROUP BY title
    ORDER BY mention_count DESC
    LIMIT ?
  `);

  return stmt.all(type, limit);
}

/**
 * Pobiera szczegółowe informacje o konkretnym tytule
 * @param {string} title - Tytuł do wyszukania
 * @returns {Object|null} Szczegóły lub null
 */
function getMediaInfo(title) {
  // Wyszukiwanie z LIKE - bardziej wybaczające (obsługuje różnice w wielkości liter, spacje itp.)
  const searchTerm = `%${title.trim()}%`;

  // Podstawowe statystyki
  const statsStmt = db.prepare(`
    SELECT
      title,
      type,
      COUNT(*) as total_mentions,
      COUNT(DISTINCT user_id) as unique_users,
      MIN(mentioned_at) as first_mention,
      MAX(mentioned_at) as last_mention
    FROM media_mentions
    WHERE LOWER(title) LIKE LOWER(?)
    GROUP BY LOWER(title)
  `);

  const stats = statsStmt.get(searchTerm);
  if (!stats) return null;

  // Użytkownicy z liczbą wzmianek
  const usersStmt = db.prepare(`
    SELECT user_name, COUNT(*) as count
    FROM media_mentions
    WHERE LOWER(title) LIKE LOWER(?)
    GROUP BY user_id, user_name
    ORDER BY count DESC
    LIMIT 10
  `);
  const users = usersStmt.all(searchTerm);

  // Snippety (opinie bez spoilerów)
  const snippetsStmt = db.prepare(`
    SELECT DISTINCT context_snippet
    FROM media_mentions
    WHERE LOWER(title) LIKE LOWER(?) AND context_snippet IS NOT NULL AND context_snippet != ''
    LIMIT 5
  `);
  const snippets = snippetsStmt.all(searchTerm);

  // Linki do rozmów z datami (ostatnie 10)
  const linksStmt = db.prepare(`
    SELECT message_link, mentioned_at, user_name
    FROM media_mentions
    WHERE LOWER(title) LIKE LOWER(?) AND message_link != ''
    ORDER BY mentioned_at DESC
    LIMIT 10
  `);
  const links = linksStmt.all(searchTerm);

  return {
    ...stats,
    users,
    snippets: snippets.map((s) => s.context_snippet),
    links,
  };
}

/**
 * Wyszukuje tytuły pasujące do frazy (do autocomplete)
 * @param {string} query - Fraza do wyszukania
 * @returns {Array} Lista pasujących tytułów
 */
function searchTitles(query) {
  const stmt = db.prepare(`
    SELECT DISTINCT title, type, COUNT(*) as mention_count
    FROM media_mentions
    WHERE LOWER(title) LIKE LOWER(?)
    GROUP BY title
    ORDER BY mention_count DESC
    LIMIT 25
  `);

  return stmt.all(`%${query}%`);
}

/**
 * Pobiera podsumowanie z ostatnich 7 dni (top 3 z każdej kategorii)
 * @returns {Object} Podsumowanie z filmami, serialami i muzyką
 */
function getSummary() {
  const periodClause = "mentioned_at >= datetime('now', '-7 days')";

  return {
    films: getTopMedia('film', periodClause, 3),
    series: getTopMedia('serial', periodClause, 3),
    music: getTopMedia('music', periodClause, 3),
  };
}

/**
 * Czyści całą bazę danych (do ponownego skanowania)
 */
function clearAll() {
  db.exec('DELETE FROM media_mentions');
  db.exec('DELETE FROM conversation_threads');
  logger.info('Database cleared');
}

/**
 * Zamyka połączenie z bazą danych
 */
function close() {
  if (db) {
    db.close();
    logger.info('Database connection closed');
  }
}

module.exports = {
  initialize,
  addMention,
  upsertThread,
  findActiveThread,
  getTopMedia,
  getMediaInfo,
  searchTitles,
  getSummary,
  clearAll,
  close,
};
