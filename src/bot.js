// Główna logika Discord bota - obsługa eventów, rejestracja komend, monitoring kanału

const {
  Client,
  GatewayIntentBits,
  Collection,
  REST,
  Routes,
  Events,
  EmbedBuilder,
} = require('discord.js');
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');
const database = require('./database');
const aiAnalyzer = require('./ai-analyzer');
const { generateThreadId, createMessageLink, formatMentionCount, truncate, formatDate } = require('./utils/helpers');

// Rate limiting - kolejka wiadomości do analizy
const messageQueue = [];
let isProcessing = false;
const MAX_QUEUE_SIZE = 50;
const PROCESS_INTERVAL = 1200; // ~50 req/min = 1 req per 1.2s

// Rate limiting komend per user
const commandCooldowns = new Map();
const COMMAND_COOLDOWN = 12000; // 12 sekund (max 5/min)

/**
 * Tworzy i konfiguruje klienta Discord
 * @returns {Client} Skonfigurowany klient
 */
function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageTyping,
    ],
  });

  // Kolekcja komend
  client.commands = new Collection();

  return client;
}

/**
 * Ładuje komendy z katalogu commands/
 * @param {Client} client - Klient Discord
 */
function loadCommands(client) {
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith('.js'));

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.data && command.execute) {
      client.commands.set(command.data.name, command);
      logger.info(`Command loaded: /${command.data.name}`);
    }
  }
}

/**
 * Rejestruje slash commands w API Discorda
 * @param {Client} client - Klient Discord
 */
async function registerCommands(client) {
  const commands = [];
  client.commands.forEach((cmd) => commands.push(cmd.data.toJSON()));

  const rest = new REST({ version: '10' }).setToken(
    process.env.DISCORD_BOT_TOKEN
  );

  try {
    logger.info(`Registering ${commands.length} slash commands...`);
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands,
    });
    logger.success(`Successfully registered ${commands.length} slash commands`);
  } catch (error) {
    logger.error('Failed to register slash commands', error);
  }
}

/**
 * Sprawdza rate limit komendy dla użytkownika
 * @param {string} userId - ID użytkownika
 * @returns {boolean} true jeśli dozwolone
 */
function checkCommandRateLimit(userId) {
  const now = Date.now();
  const lastUsed = commandCooldowns.get(userId) || 0;

  if (now - lastUsed < COMMAND_COOLDOWN) {
    return false;
  }

  commandCooldowns.set(userId, now);
  return true;
}

/**
 * Przetwarza kolejkę wiadomości do analizy AI
 */
async function processQueue() {
  if (isProcessing || messageQueue.length === 0) return;

  isProcessing = true;

  while (messageQueue.length > 0) {
    const message = messageQueue.shift();

    try {
      await processMessage(message);
    } catch (error) {
      logger.error('Error processing message from queue', error.message);
    }

    // Odczekaj między requestami (rate limiting)
    if (messageQueue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, PROCESS_INTERVAL));
    }
  }

  isProcessing = false;
}

/**
 * Analizuje wiadomość i zapisuje wynik do bazy
 * @param {Message} message - Wiadomość Discord
 */
async function processMessage(message) {
  const result = await aiAnalyzer.analyzeMessage(message);

  if (!result || !result.is_media_related || !result.title) return;

  const channelId = message.channel.id;
  const guildId = message.guild?.id;

  // Szukaj istniejącego wątku lub utwórz nowy
  let thread = database.findActiveThread(result.title, channelId);
  let threadId;

  if (thread) {
    threadId = thread.thread_id;
    // Aktualizuj czas aktywności
    database.upsertThread({
      threadId,
      mainTopic: result.title,
      topicType: result.media_type,
    });
  } else {
    threadId = generateThreadId(channelId, result.title);
    database.upsertThread({
      threadId,
      mainTopic: result.title,
      topicType: result.media_type,
    });
  }

  // Zapisz wzmiankę
  const messageLink = guildId
    ? createMessageLink(guildId, channelId, message.id)
    : '';

  database.addMention({
    title: result.title,
    type: result.media_type,
    userId: message.author.id,
    userName: message.author.username,
    messageId: message.id,
    messageLink,
    contextSnippet: result.has_spoilers ? null : result.safe_snippet,
    threadId,
    mentionedAt: message.createdAt.toISOString(),
  });
}

/**
 * Konfiguruje event handlery bota
 * @param {Client} client - Klient Discord
 */
function setupEventHandlers(client) {
  // Bot gotowy
  client.once(Events.ClientReady, async (readyClient) => {
    logger.success(`Bot logged in as ${readyClient.user.tag}`);
    logger.info(
      `Monitoring channel: ${process.env.MONITORED_CHANNEL_ID}`
    );

    // Rejestruj komendy po zalogowaniu
    await registerCommands(client);
  });

  // Nowa wiadomość na kanale
  client.on(Events.MessageCreate, async (message) => {
    // Ignoruj wiadomości od botów i własne
    if (message.author.bot) return;

    // Sprawdź czy to monitorowany kanał lub thread wewnątrz niego
    const channelId = message.channel.isThread()
      ? message.channel.parentId
      : message.channel.id;
    if (channelId !== process.env.MONITORED_CHANNEL_ID) return;

    // Dodaj do kolejki analizy
    if (messageQueue.length < MAX_QUEUE_SIZE) {
      messageQueue.push(message);
      processQueue();
    } else {
      logger.warn('Message queue full, dropping message');
    }
  });

  // Obsługa slash commands
  client.on(Events.InteractionCreate, async (interaction) => {
    // Obsługa select menu (dropdown z tytułami w rankingach)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('info_select')) {
      const selectedTitle = interaction.values[0];
      const info = database.getMediaInfo(selectedTitle);

      if (!info) {
        return interaction.reply({ content: `Nie znaleziono wzmianek o "${selectedTitle}".`, ephemeral: true });
      }

      const typeIcons = { film: '🎬', serial: '📺', music: '🎵' };
      const typeIcon = typeIcons[info.type] || '📌';

      const embed = new EmbedBuilder()
        .setTitle(`${typeIcon} ${info.title}`)
        .setColor(0x9b59b6)
        .setTimestamp();

      const statsText = [
        `Wzmianek: **${info.total_mentions}** | Użytkowników: **${info.unique_users}**`,
        `Pierwsza: **${formatDate(info.first_mention)}** | Ostatnia: **${formatDate(info.last_mention)}**`,
      ].join('\n');
      embed.addFields({ name: '📊 Statystyki', value: statsText });

      if (info.users.length > 0) {
        const usersText = info.users.map((u) => `**${u.user_name}** (${u.count})`).join(', ');
        embed.addFields({ name: '👥 Polecali', value: truncate(usersText, 1024) });
      }

      if (info.snippets.length > 0) {
        const opinionsText = info.snippets.filter(Boolean).slice(0, 3).map((s) => `"${truncate(s, 80)}"`).join('\n');
        if (opinionsText) embed.addFields({ name: '💬 Opinie', value: opinionsText });
      }

      if (info.links.length > 0) {
        const maxLinks = 5;
        const linksText = info.links.slice(0, maxLinks).map((l) => `[${formatDate(l.mentioned_at)} — ${l.user_name}](${l.message_link})`).join('\n');
        const suffix = info.total_mentions > maxLinks ? `\n*...i ${info.total_mentions - maxLinks} więcej*` : '';
        embed.addFields({ name: '🔗 Rozmowy', value: truncate(linksText + suffix, 1024) });
      }

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Obsługa autocomplete (np. /info)
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (error) {
          logger.error(`Autocomplete error for /${interaction.commandName}`, error.message);
        }
      }
      return;
    }

    // Obsługa komend
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    // Rate limiting
    if (!checkCommandRateLimit(interaction.user.id)) {
      return interaction.reply({
        content: '⏳ Poczekaj chwilę przed użyciem kolejnej komendy.',
        ephemeral: true,
      });
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error(`Command error: /${interaction.commandName}`, error.message);

      const errorMessage =
        '❌ Wystąpił błąd podczas wykonywania komendy. Spróbuj ponownie później.';

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  });
}

/**
 * Uruchamia bota
 */
async function start() {
  // Inicjalizuj bazę danych
  database.initialize();

  // Utwórz klienta i załaduj komendy
  const client = createClient();
  loadCommands(client);
  setupEventHandlers(client);

  // Zaloguj do Discorda
  try {
    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (error) {
    logger.error('Failed to login to Discord', error);
    process.exit(1);
  }

  return client;
}

module.exports = { start };
