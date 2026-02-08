# Discord MediaTracker Bot

Bot Discord do automatycznego sledzenia rozmow o filmach, serialach i muzyce. Monitoruje wybrany kanal, analizuje wiadomosci przez Claude API, wykrywa tytuly i tworzy rankingi popularnosci bez spoilerow.

## Wymagania

- Node.js 18+
- Token bota Discord (z [Discord Developer Portal](https://discord.com/developers/applications))
- Klucz API Anthropic (z [Anthropic Console](https://console.anthropic.com/))
- Serwer Discord z kanalem do monitorowania

## Instalacja lokalna

1. **Sklonuj repozytorium:**
   ```bash
   git clone <url-repo>
   cd discord-media-bot
   ```

2. **Zainstaluj zaleznosci:**
   ```bash
   npm install
   ```

3. **Skonfiguruj zmienne srodowiskowe:**
   ```bash
   cp .env.example .env
   ```
   Edytuj plik `.env` i uzupelnij wartosci:
   - `DISCORD_BOT_TOKEN` - token bota z Discord Developer Portal
   - `ANTHROPIC_API_KEY` - klucz API z Anthropic Console
   - `MONITORED_CHANNEL_ID` - ID kanalu Discord do monitorowania
   - `NODE_ENV` - `production` lub `development`

4. **Uruchom bota:**
   ```bash
   # Produkcja
   npm start

   # Rozwoj (z automatycznym restartem)
   npm run dev
   ```

## Konfiguracja bota Discord

1. Wejdz na [Discord Developer Portal](https://discord.com/developers/applications)
2. Utworz nowa aplikacje
3. W sekcji **Bot**:
   - Wlacz **Message Content Intent**
   - Wlacz **Server Members Intent**
   - Skopiuj token bota
4. W sekcji **OAuth2 > URL Generator**:
   - Zaznacz scope: `bot`, `applications.commands`
   - Zaznacz permissions: `Send Messages`, `Read Message History`, `Use Slash Commands`
   - Uzyj wygenerowanego URL aby dodac bota na serwer

## Komendy

| Komenda | Opis |
|---------|------|
| `/top-filmy [okres]` | Ranking najpopularniejszych filmow |
| `/top-seriale [okres]` | Ranking najpopularniejszych seriali |
| `/top-muzyka [okres]` | Ranking najpopularniejszej muzyki |
| `/podsumowanie` | Top 3 z kazdej kategorii z ostatnich 7 dni |
| `/info [tytul]` | Szczegolowe informacje o konkretnym tytule |

**Dostepne okresy:** tydzien (domyslny), miesiac, rok, wszystkie

## Jak to dziala

1. Bot monitoruje wiadomosci na wybranym kanale
2. Kazda wiadomosc jest analizowana przez Claude AI (model Haiku)
3. AI wykrywa wzmianki o filmach, serialach i muzyce
4. Tytuly i kontekst (bez spoilerow) sa zapisywane w bazie SQLite
5. Wiadomosci sa grupowane w watki konwersacyjne
6. Uzytkownicy moga przegladac rankingi za pomoca slash commands

## Wdrozenie na Railway

1. Utworz konto na [Railway](https://railway.app/)
2. Polacz repozytorium GitHub z Railway
3. Railway automatycznie wykryje projekt Node.js
4. Dodaj zmienne srodowiskowe w Railway Dashboard:
   - `DISCORD_BOT_TOKEN`
   - `ANTHROPIC_API_KEY`
   - `MONITORED_CHANNEL_ID`
   - `NODE_ENV=production`
5. Deploy nastapi automatycznie po push do branch `main`

## Struktura projektu

```
discord-media-bot/
├── .env.example           # Szablon zmiennych srodowiskowych
├── .gitignore
├── package.json
├── README.md
├── src/
│   ├── index.js          # Punkt wejscia
│   ├── bot.js            # Logika bota Discord
│   ├── database.js       # Obsluga SQLite
│   ├── ai-analyzer.js    # Integracja z Claude API
│   ├── commands/
│   │   ├── top-filmy.js
│   │   ├── top-seriale.js
│   │   ├── top-muzyka.js
│   │   ├── podsumowanie.js
│   │   └── info.js
│   └── utils/
│       ├── logger.js
│       └── helpers.js
└── database/
    └── media.db          # Baza danych (tworzona automatycznie)
```

## Troubleshooting

**Bot nie odpowiada na komendy:**
- Upewnij sie, ze bot ma uprawnienia `Use Slash Commands` na serwerze
- Poczekaj do godziny po uruchomieniu - rejestracja globalnych komend moze trwac

**Blad "Missing required environment variables":**
- Sprawdz czy plik `.env` istnieje i zawiera wszystkie wymagane zmienne
- Na Railway sprawdz zakladke Variables

**Bot nie wykrywa wiadomosci:**
- Sprawdz czy `MONITORED_CHANNEL_ID` jest poprawne
- Upewnij sie, ze **Message Content Intent** jest wlaczony w Discord Developer Portal

**Bledy Claude API:**
- Sprawdz czy `ANTHROPIC_API_KEY` jest aktualny
- Sprawdz limity uzytkownika w Anthropic Console

## Licencja

MIT
