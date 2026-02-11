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

  // Tabela aliasów tytułów (mapowanie wariantów na kanoniczny tytuł)
  db.exec(`
    CREATE TABLE IF NOT EXISTS title_aliases (
      alias TEXT NOT NULL,
      canonical_title TEXT NOT NULL,
      PRIMARY KEY (alias)
    )
  `);

  // Indeksy dla szybszych zapytań
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_title ON media_mentions(title);
    CREATE INDEX IF NOT EXISTS idx_type ON media_mentions(type);
    CREATE INDEX IF NOT EXISTS idx_mentioned_at ON media_mentions(mentioned_at);
    CREATE INDEX IF NOT EXISTS idx_thread ON media_mentions(conversation_thread_id);
  `);

  // Jednorazowa migracja - napraw istniejące duplikaty
  migrateNormalizeTitles();

  logger.success('Database initialized successfully');
}

/**
 * Rozwiązuje tytuł do formy kanonicznej:
 * 1. Sprawdza tabelę aliasów (np. "Game of Thrones" → "Gra o tron")
 * 2. Sprawdza czy istnieje wariant w bazie z takim samym LOWER() - używa istniejącej formy
 * @param {string} title - Tytuł do normalizacji
 * @returns {string} Kanoniczny tytuł
 */
function resolveTitle(title) {
  // 1. Sprawdź aliasy
  const alias = db.prepare(
    'SELECT canonical_title FROM title_aliases WHERE LOWER(alias) = LOWER(?)'
  ).get(title);
  if (alias) return alias.canonical_title;

  // 2. Sprawdź czy w bazie jest już taki tytuł (case-insensitive) - użyj istniejącej formy
  const existing = db.prepare(
    'SELECT title FROM media_mentions WHERE LOWER(title) = LOWER(?) LIMIT 1'
  ).get(title);
  if (existing) return existing.title;

  return title;
}

/**
 * Dodaje alias tytułu (np. angielska nazwa → polska)
 * @param {string} alias - Wariant tytułu
 * @param {string} canonicalTitle - Kanoniczny tytuł
 */
function addAlias(alias, canonicalTitle) {
  db.prepare(`
    INSERT OR REPLACE INTO title_aliases (alias, canonical_title) VALUES (?, ?)
  `).run(alias, canonicalTitle);
  logger.info(`Alias added: "${alias}" → "${canonicalTitle}"`);
}

/**
 * Scala istniejące wzmianki z jednego tytułu do drugiego
 * @param {string} fromTitle - Tytuł źródłowy (do usunięcia)
 * @param {string} toTitle - Tytuł docelowy (kanoniczny)
 * @returns {number} Liczba zaktualizowanych rekordów
 */
function mergeTitles(fromTitle, toTitle) {
  const result = db.prepare(
    'UPDATE media_mentions SET title = ? WHERE LOWER(title) = LOWER(?)'
  ).run(toTitle, fromTitle);

  // Dodaj alias żeby przyszłe wzmianki też się łączyły
  addAlias(fromTitle, toTitle);

  logger.info(`Merged "${fromTitle}" → "${toTitle}" (${result.changes} records)`);
  return result.changes;
}

/**
 * Pobiera listę wszystkich aliasów
 * @returns {Array} Lista aliasów
 */
function getAllAliases() {
  return db.prepare('SELECT alias, canonical_title FROM title_aliases ORDER BY canonical_title').all();
}

/**
 * Jednorazowa migracja - naprawia duplikaty wielkości liter w istniejących danych
 * Dla każdej grupy tytułów różniących się tylko wielkością liter,
 * wybiera najpopularniejszy wariant i scala pozostałe
 */
function migrateNormalizeTitles() {
  // === KROK 1: Napraw wielkość liter ===
  // Znajdź grupy tytułów które różnią się tylko wielkością liter
  const groups = db.prepare(`
    SELECT LOWER(title) as lower_title, COUNT(DISTINCT title) as variant_count
    FROM media_mentions
    GROUP BY LOWER(title)
    HAVING COUNT(DISTINCT title) > 1
  `).all();

  if (groups.length > 0) {
    logger.info(`Migration: found ${groups.length} title groups with case variants`);

    for (const group of groups) {
      // Znajdź najpopularniejszy wariant (ten z największą liczbą wzmianek)
      const canonical = db.prepare(`
        SELECT title, COUNT(*) as cnt
        FROM media_mentions
        WHERE LOWER(title) = ?
        GROUP BY title
        ORDER BY cnt DESC
        LIMIT 1
      `).get(group.lower_title);

      // Scal wszystkie warianty do kanonicznego
      const result = db.prepare(
        'UPDATE media_mentions SET title = ? WHERE LOWER(title) = ? AND title != ?'
      ).run(canonical.title, group.lower_title, canonical.title);

      logger.info(`Migration: "${group.lower_title}" → "${canonical.title}" (merged ${result.changes} records)`);
    }
  }

  // === KROK 2: Scal znane polskie/angielskie warianty, skróty i literówki ===
  const knownMerges = [
    // Gra o tron
    ['Game of Thrones', 'Gra o tron'],

    // Rycerz siedmiu królestw
    ['Rycerz', 'Rycerz siedmiu królestw'],
    ['Knight of the Seven Kingdoms', 'Rycerz siedmiu królestw'],
    ['A Knight of the Seven Kingdoms', 'Rycerz siedmiu królestw'],
    ['The Knight of the Seven Kingdoms', 'Rycerz siedmiu królestw'],
    ['Knight of Seven Kingdoms', 'Rycerz siedmiu królestw'],
    ['Rycerz z siedmiu królestw', 'Rycerz siedmiu królestw'],
    ['Rycerz z 7 królestw', 'Rycerz siedmiu królestw'],

    // Ród smoka
    ['House of the Dragon', 'Ród smoka'],

    // Wiedźmin
    ['The Witcher', 'Wiedźmin'],

    // Attack on Titan
    ['Atak Tytanów', 'Attack on Titan'],
    ['Atak na Titana', 'Attack on Titan'],
    ['Atak na Shingashinę', 'Attack on Titan'],
    ['Female Titan', 'Attack on Titan'],
    ['Eren', 'Attack on Titan'],
    ['Tytan', 'Attack on Titan'],
    ['Bitwa o Trast', 'Attack on Titan'],

    // The White Lotus
    ['Biały Lotos', 'The White Lotus'],
    ['Bialy Lotos', 'The White Lotus'],
    ['White Lotus', 'The White Lotus'],

    // The Sopranos
    ['Rodzina Soprano', 'The Sopranos'],
    ['Sopranos', 'The Sopranos'],

    // The Righteous Gemstones (literówki)
    ['Prawi Gemstoni', 'The Righteous Gemstones'],
    ['Prawi Gemstonowie', 'The Righteous Gemstones'],
    ['Prawi Gemmstoni', 'The Righteous Gemstones'],
    ['Prawi Gembstonowie', 'The Righteous Gemstones'],
    ['Prawe Gemstony', 'The Righteous Gemstones'],
    ['Prawych Gemstonów', 'The Righteous Gemstones'],
    ['Prawigemstonowie', 'The Righteous Gemstones'],

    // Shōgun
    ['Shogun', 'Shōgun'],
    ['Szogun', 'Shōgun'],

    // The Sandman
    ['Sandman', 'The Sandman'],

    // The Office PL
    ['The Office', 'The Office PL'],
    ['Polski Office', 'The Office PL'],

    // Slow Horses
    ['Kulawe Konie', 'Slow Horses'],
    ['Kulawi Konie', 'Slow Horses'],

    // Chernobyl
    ['Czarnobyl', 'Chernobyl'],
    ['Czernobyl', 'Chernobyl'],

    // Jack Ryan
    ["Tom Clancy's Jack Ryan", 'Jack Ryan'],
    ['Jacek Ryan', 'Jack Ryan'],

    // Rick and Morty
    ['Rick i Morty', 'Rick and Morty'],

    // Alice in Borderland
    ['Alice in Borderlands', 'Alice in Borderland'],

    // Daredevil
    ['Daredevil Born Again', 'Daredevil'],
    ['Daredevil: Born Again', 'Daredevil'],
    ['DD', 'Daredevil'],

    // How I Met Your Mother
    ['HIMYM', 'How I Met Your Mother'],

    // Czarny Ptak to Black Bird (NIE Chernobyl)
    ['Czarny Ptak', 'Black Bird'],

    // The Boys
    ['Boys', 'The Boys'],

    // The Blacklist
    ['Blacklist', 'The Blacklist'],

    // The Bridge / Most nad Sundem
    ['Bron', 'The Bridge'],
    ['Broen', 'The Bridge'],
    ['Most nad Sundem', 'The Bridge'],

    // Sons of Anarchy
    ['Synowie Anarchii', 'Sons of Anarchy'],

    // Black Mirror
    ['Czarne lustro', 'Black Mirror'],

    // The Mandalorian
    ['Mandalorian', 'The Mandalorian'],

    // Obi-Wan Kenobi
    ['Obi Wan Kenobi', 'Obi-Wan Kenobi'],

    // Machos Alfa
    ['Machos alfa', 'Machos Alfa'],

    // The Affair
    ['Afair', 'The Affair'],
    ['Affair', 'The Affair'],

    // Mobland (literówka)
    ['Moblamd', 'Mobland'],

    // Vinland Saga
    ['Saga winlandzka', 'Vinland Saga'],

    // Band of Brothers
    ['Kompania braci', 'Band of Brothers'],
    ['Bastogne', 'Band of Brothers'],

    // Dept. Q
    ['Dept Q', 'Dept. Q'],

    // Bron/Broen (dodatkowe)
    ['Bron/Broen', 'The Bridge'],

    // Dojrzewanie
    ['Dojrzewanie / Adolescence', 'Dojrzewanie'],
    ['To dojrzewanie', 'Dojrzewanie'],

    // Dragon Ball (franczyza jako jedno)
    ['Dragon Ball Z', 'Dragon Ball'],
    ['Dragon Ball GT', 'Dragon Ball'],
    ['Dragon Ball Super', 'Dragon Ball'],
    ['Dragon Ball/Dragon Ball Z', 'Dragon Ball'],

    // Akira (film, ale poprawka nazwy)
    ['Akire', 'Akira'],

    // Argyle → Argylle
    ['Argyle', 'Argylle'],

    // === FILMY: duplikaty / warianty ===

    // Alien
    ['Obcy', 'Alien'],
    ['Obcy Romulus', 'Alien: Romulus'],

    // Naga broń
    ['Naked Gun', 'Naga broń'],
    ['Nagie pistolety', 'Naga broń'],

    // 12 Angry Men
    ['12 gniewnych ludzi', '12 Angry Men'],
    ['Dwunastu gniewnych ludzi', '12 Angry Men'],

    // Rogue One
    ['Rogue One', 'Rogue One: A Star Wars Story'],
    ['Łotr 1', 'Rogue One: A Star Wars Story'],
    ['Rogue 1', 'Rogue One: A Star Wars Story'],

    // Requiem for a Dream
    ['Requiem', 'Requiem for a Dream'],

    // Call Me by Your Name
    ['Tamte dni, tamte noce', 'Call Me by Your Name'],

    // Three Billboards
    ['Trzy billboardy za Ebbing, Missouri', 'Three Billboards Outside Ebbing, Missouri'],
    ['Trzy billboardy', 'Three Billboards Outside Ebbing, Missouri'],

    // Dune
    ['Diuna', 'Dune'],
    ['Diuny', 'Dune'],

    // Mickey 17
    ['Mickey17', 'Mickey 17'],

    // Rocketman
    ['Rocket Man', 'Rocketman'],

    // True Romance
    ['Prawdziwy romans', 'True Romance'],

    // The Thin Red Line
    ['Cienka czerwona linia', 'The Thin Red Line'],

    // Dunkirk
    ['Dunkierka', 'Dunkirk'],

    // Dungeons & Dragons
    ['Dungeons and Dragons', 'Dungeons & Dragons'],

    // Mr. Vampire
    ['Mr Vampire', 'Mr. Vampire'],

    // Highlander
    ['Nieśmiertelny', 'Highlander'],
    ['Nieśmiertelny (Highlander)', 'Highlander'],

    // Prey
    ['Predator: Prey', 'Prey'],

    // Notting Hill (literówka)
    ['Nothing Hill', 'Notting Hill'],

    // Nagi instynkt
    ['Nagiego instynktu', 'Nagi instynkt'],

    // Zwierzogród 2
    ['Zwierzograd 2', 'Zwierzogród 2'],

    // Silo (serial, ale poprawka nazwy)
    ['Silos', 'Silo'],

    // Mobbland → Mobland
    ['Mobbland', 'Mobland'],

    // San Junipero → Black Mirror (to odcinek)
    ['San Junipero', 'Black Mirror'],

    // Dexter: New Blood
    ['New Blood', 'Dexter: New Blood'],

    // Rings of Power
    ['Pierścienie Władzy', 'Rings of Power'],
    ['The Lord of the Rings: The Rings of Power', 'Rings of Power'],
  ];

  for (const [fromTitle, toTitle] of knownMerges) {
    // Sprawdź czy w bazie istnieją wzmianki z tym wariantem
    const count = db.prepare(
      'SELECT COUNT(*) as cnt FROM media_mentions WHERE LOWER(title) = LOWER(?) AND LOWER(title) != LOWER(?)'
    ).get(fromTitle, toTitle);

    if (count && count.cnt > 0) {
      db.prepare(
        'UPDATE media_mentions SET title = ? WHERE LOWER(title) = LOWER(?)'
      ).run(toTitle, fromTitle);

      logger.info(`Migration: merged "${fromTitle}" → "${toTitle}" (${count.cnt} records)`);
    }

    // Zawsze dodaj alias (nawet jeśli nie było wzmianek - na przyszłość)
    if (fromTitle.toLowerCase() !== toTitle.toLowerCase()) {
      db.prepare(
        'INSERT OR IGNORE INTO title_aliases (alias, canonical_title) VALUES (?, ?)'
      ).run(fromTitle, toTitle);
    }
  }

  // === KROK 3: Napraw błędną klasyfikację (serial → film) ===
  const typeFixesToFilm = [
    'Sweeney Todd', 'Batman & Robin', 'First Blood', 'Chłopaki nie płaczą',
    'Amerykański Pie', 'Argylle', 'Argyle', 'Miś', 'Troja', 'Lamb', 'Vinci',
    'Obcy', 'Alien', 'Dług', 'Hejt', 'Before Fall', 'Akira', 'Akire',
    'Vinci 2', 'A Monster', 'Crossed', 'The Lord of the Rings',
  ];

  for (const title of typeFixesToFilm) {
    const result = db.prepare(
      "UPDATE media_mentions SET type = 'film' WHERE LOWER(title) = LOWER(?) AND type = 'serial'"
    ).run(title);

    if (result.changes > 0) {
      logger.info(`Migration: type fix "${title}" serial → film (${result.changes} records)`);
    }
  }

  // === KROK 4: Napraw błędną klasyfikację (film → serial) ===
  const typeFixesToSerial = [
    'Andor', 'Squid Game', 'Mobland', 'Reacher', 'Fallout', 'Shrinking',
    'The Sopranos', 'The White Lotus', 'The Office PL', 'Slow Horses',
    'Band of Brothers', 'Pam & Tommy', 'Welcome to Derry', 'Wednesday',
    'Tulsa King', 'Ray Donovan', 'Peaky Blinders', 'Family Guy',
    'Stranger Things', 'Silo', 'Rezerwat', 'Heweliusz', 'Gra o tron',
    'Rings of Power', 'Black Bird', 'Platonic', 'The Crown', 'The Chosen',
    'The English', 'What We Do in the Shadows', 'Spider-Man: The Animated Series',
    'The Falcon and the Winter Soldier', 'Attack on Titan', 'Demon Slayer',
    'Dexter: New Blood', 'Black Mirror',
  ];

  for (const title of typeFixesToSerial) {
    const result = db.prepare(
      "UPDATE media_mentions SET type = 'serial' WHERE LOWER(title) = LOWER(?) AND type = 'film'"
    ).run(title);

    if (result.changes > 0) {
      logger.info(`Migration: type fix "${title}" film → serial (${result.changes} records)`);
    }
  }

  // === KROK 5: Usuń śmieciowe wpisy (noise) ===
  const noiseToDelete = [
    // --- Z seriali ---
    'serial', 'anime', 'Top serial', 'trzeci sezon', '1 sezon', '3 sezon',
    '5 sezon', '7 sezon', 'Drugi sezon', 'Pierwszy sezon', 'serial medyczny',
    'serial o wszystkich książkach', 'śledczy serial z dobrą grozą',
    'Największy sukces tej platformy', 'Serial, który Brad Pitt produkował',
    'Serial o dwóch ziomkach z wojska…',
    'Ostatni odcinek poprzedniego sezonu o Hindusce sprzedającej buty',
    'null', 'nie podano', 'esport', 'coming out', 'bankow',
    'albinios', 'Cena', '8', '500', 'IM', 'S4', 'VM', 'ww',
    'Ned Flaunders', 'Mon Mothma', 'Matsuka', 'Erwin', 'Eddie', 'Levi',
    'Kurt', 'Kurta', 'Faye', 'Jean', 'Jack', 'Isaac', 'John Gacy',
    'Eda Gein', 'Gein', 'Ms Casey',
    'MCU', 'Kirkman universe', 'Star Wars', 'Gwiezdne wojny',
    'Baldurs Gate', "Baldur's Gate", 'Malazan', 'Malazan Book of the Fallen',
    'WWE', 'AEW',
    'Crunchyroll', 'C+', 'Na Maxie', 'Skyshow', 'Alt Shift X',
    'Raindeer', 'Terrific', 'Slabizna', 'Kożuchowska', 'Jan Oglądamy',
    'Koreański ewenement', 'Makra', 'Cavalier', 'Syty Max', 'Sonsi',
    'Sinnersers', 'Sensible Saiyan', 'Pierre', 'Pat', 'Kuśnierz',
    'Jegerystów', 'Ginies', 'Ginés',

    // --- Z filmów: platformy/studia ---
    'YouTube', 'A24', 'Skyshowtime', 'Prime Video', 'Showtime', 'letterboxd',
    'Peacock',

    // --- Z filmów: linki / identyfikatory ---
    'FEu7xIEaXWo', 'Th9c7hSY8Mo', 'EOwTdTZA8D8',

    // --- Z filmów: osoby (reżyserzy/aktorzy) ---
    'Kurosawa', 'Guy Ritchie', 'Spike Lee', 'Robert Redford', 'Jordan Peele',
    'Tom Cruise', 'Terence Stamp', 'Sofia Boutella', 'Emily Blunt',
    'Ethan Hawke', 'Idris Elba', 'Jon Hamm', 'John Woo', 'Béla Tarr',
    'Belmondo', 'Jean-Paul Belmondo', 'Taika', 'Nolan', 'Gareth Evans',
    'Shaw Levy', 'Snyderverse', 'Almodovar', 'Egerton', 'Odessa Young', 'Kidman',

    // --- Z filmów: muzyka/artyści ---
    'Jane Remover', 'Eminem', 'Rasmentalism', 'Quebó', 'Vader', 'Verba',

    // --- Z filmów: gry ---
    'Death Stranding', 'Bóg Wojny: Ragnarök', 'Monkey Island', 'Minecraft',
    'Metal Gear', 'Metal Gear Solid', 'Prince of Persia: Dwa Oblicza Czasu',
    'Kratos',

    // --- Z filmów: franczyzy/uniwersa ---
    'Marvel', 'Marvel Studios', 'Marvel Cinematic Universe',
    'Marvel Cinematic Universe (MCU)', 'James Bond', 'Harry Potter',
    'Władca Pierścieni', 'The Lord of the Rings',
    'Liga Sprawiedliwości', 'Justice League',

    // --- Z filmów: opisy/placeholder ---
    'jedynka', 'pierwsza część', 'część3', 'top film',
    'Best Movies of the 21st Century', 'Filmy Gaspara Noe',
    'Filmy Rubena Östlunda', 'Filmografia Akiry Kurosawy',
    'Filmy studia Ghibli', 'Filmy o The Beatles',
    'film z nicole kidman', 'To jest film z nicole kidman',
    'hiszpanski film', 'duński', 'nowy film Smarzowskiego',
    'nowy Szpielberg', 'nowa trylogia', 'remake',
    'przygoda polskiej kadry w korei', 'polskie filmy',
    'klasyki b-klasowego kina lat 80-tych',
    'najsmieszniejszy film jaki powstal', 'ostatni film z cagem...',
    'Film, który wygrał festiwal w Gdyni', 'Film z napisami',
    'Film dokumentalny o sekretnym ślubie',
    'Film, o którym wspomina się w wiadomości',
    '[Film wskazany przez link]', 'Tytuł filmu',
    'Obraz', 'Obraz/impresjonizm/SZTUKA',
    "Stan's 2025", 'Hollywood 2025',
    'Oscary', 'Oscar za reżyserię',
    'Przemiany społeczno-kulturowe lat 60 i 70',
    'Poznań z okresu przedwojennego', 'Góry Świętokrzyskie',

    // --- Z filmów: podejrzane / noise ---
    'Superman Gunna', 'Scenes from beans', 'Rocznice',
    'Mietek', 'Mietka', 'Gosling', 'Viggo', 'Hopper',
    'Kompania', 'Kapitan', 'Kowboj', 'Włodzimierz',
    'Wybitny człowiek', 'Wykład', 'Wielki Polak',
    'Najwyższy i najniższy', 'Nieznany', 'Ostry', 'Ogromny',
    'znienacka', 'na kiedyś', 'lek', 'jbc', 'kaz', 'teczki',
    'by 3', 'dwa wcześniejsze', 'druga część', 'Dwójka',
  ];

  // Usuń też wpisy zawierające URL-e
  db.prepare("DELETE FROM media_mentions WHERE title LIKE 'http%'").run();

  let totalDeleted = 0;
  for (const title of noiseToDelete) {
    const result = db.prepare(
      'DELETE FROM media_mentions WHERE LOWER(title) = LOWER(?)'
    ).run(title);

    if (result.changes > 0) {
      totalDeleted += result.changes;
      logger.info(`Migration: deleted noise "${title}" (${result.changes} records)`);
    }
  }
  if (totalDeleted > 0) {
    logger.info(`Migration: total noise deleted: ${totalDeleted} records`);
  }
}

/**
 * Dodaje nową wzmiankę o mediach do bazy
 * @param {Object} mention - Dane wzmianki
 */
function addMention(mention) {
  // Rozwiąż tytuł do formy kanonicznej (aliasy + case normalization)
  const resolvedTitle = resolveTitle(mention.title);

  // Sprawdź czy wzmianka z tego message_id już istnieje (deduplikacja)
  const exists = db.prepare(
    'SELECT 1 FROM media_mentions WHERE message_id = ? AND LOWER(title) = LOWER(?)'
  ).get(mention.messageId, resolvedTitle);

  if (exists) return;

  const stmt = db.prepare(`
    INSERT INTO media_mentions (title, type, user_id, user_name, message_id, message_link, context_snippet, conversation_thread_id, mentioned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    resolvedTitle,
    mention.type,
    mention.userId,
    mention.userName,
    mention.messageId,
    mention.messageLink,
    mention.contextSnippet,
    mention.threadId || null,
    mention.mentionedAt || new Date().toISOString()
  );

  logger.info(`Mention saved: "${resolvedTitle}" (${mention.type}) by ${mention.userName}`);
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
  const searchTerm = title.trim();

  // Najpierw spróbuj dokładne dopasowanie (case insensitive)
  let stats = db.prepare(`
    SELECT
      title,
      type,
      COUNT(*) as total_mentions,
      COUNT(DISTINCT user_id) as unique_users,
      MIN(mentioned_at) as first_mention,
      MAX(mentioned_at) as last_mention
    FROM media_mentions
    WHERE LOWER(title) = LOWER(?)
  `).get(searchTerm);

  // Jeśli nie znaleziono - spróbuj LIKE (częściowe dopasowanie)
  if (!stats || !stats.title) {
    stats = db.prepare(`
      SELECT
        title,
        type,
        COUNT(*) as total_mentions,
        COUNT(DISTINCT user_id) as unique_users,
        MIN(mentioned_at) as first_mention,
        MAX(mentioned_at) as last_mention
      FROM media_mentions
      WHERE LOWER(title) LIKE LOWER(?)
    `).get(`%${searchTerm}%`);
  }

  if (!stats || !stats.title) {
    logger.info(`getMediaInfo: nothing found for "${searchTerm}"`);
    return null;
  }

  // Użyj znalezionego tytułu do dalszych zapytań (case-insensitive żeby złapać wszystkie warianty)
  const exactTitle = stats.title;

  const users = db.prepare(`
    SELECT user_name, COUNT(*) as count
    FROM media_mentions
    WHERE LOWER(title) = LOWER(?)
    GROUP BY user_id, user_name
    ORDER BY count DESC
    LIMIT 10
  `).all(exactTitle);

  const snippets = db.prepare(`
    SELECT DISTINCT context_snippet
    FROM media_mentions
    WHERE LOWER(title) = LOWER(?) AND context_snippet IS NOT NULL AND context_snippet != ''
    LIMIT 5
  `).all(exactTitle);

  const links = db.prepare(`
    SELECT message_link, mentioned_at, user_name
    FROM media_mentions
    WHERE LOWER(title) = LOWER(?) AND message_link != ''
    ORDER BY mentioned_at DESC
    LIMIT 10
  `).all(exactTitle);

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
    SELECT title, type, COUNT(*) as mention_count
    FROM media_mentions
    WHERE LOWER(title) LIKE LOWER(?)
    GROUP BY LOWER(title)
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
  addAlias,
  mergeTitles,
  getAllAliases,
  resolveTitle,
};
