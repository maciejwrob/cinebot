// Komenda /skanuj - jednorazowe skanowanie historii kanału

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const database = require('../database');
const aiAnalyzer = require('../ai-analyzer');
const { generateThreadId, createMessageLink } = require('../utils/helpers');

// Szybszy delay - Haiku jest szybki i tani
const API_DELAY = 500; // 0.5s

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skanuj')
    .setDescription('[Admin] Przeskanuj historię kanału i przeanalizuj wzmianki o mediach')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) =>
      option
        .setName('dni')
        .setDescription('Ile dni wstecz skanować (domyślnie 7, max 365)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(365)
    ),

  async execute(interaction) {
    const days = interaction.options.getInteger('dni') || 7;
    const monitoredChannelId = process.env.MONITORED_CHANNEL_ID;

    // Pobierz monitorowany kanał
    const channel = interaction.client.channels.cache.get(monitoredChannelId);
    if (!channel) {
      return interaction.reply({
        content: 'Nie mogę znaleźć monitorowanego kanału.',
        ephemeral: true,
      });
    }

    // Odpowiedz od razu (ephemeral)
    await interaction.reply({
      content: `Rozpoczynam skanowanie kanału z ostatnich **${days} dni**... Postęp wyślę Ci na DM.`,
      ephemeral: true,
    });

    // Otwórz DM z użytkownikiem do raportowania postępu
    let dmChannel;
    try {
      dmChannel = await interaction.user.createDM();
      await dmChannel.send(`🔍 Rozpoczynam skanowanie kanału z ostatnich **${days} dni**...`);
    } catch (e) {
      logger.error('Cannot open DM with user', e.message);
      // Fallback - jeśli DM zablokowane, użyj kanału
      dmChannel = null;
    }

    // Funkcja do wysyłania/edytowania postępu
    let progressMsg = null;
    async function updateProgress(text) {
      try {
        if (dmChannel) {
          if (progressMsg) {
            await progressMsg.edit(text);
          } else {
            progressMsg = await dmChannel.send(text);
          }
        }
      } catch (e) {
        // cicho ignoruj błędy edycji
      }
    }

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      let allMessages = [];
      let lastMessageId = null;
      let fetching = true;

      // Pobieraj wiadomości partiami po 100
      while (fetching) {
        const options = { limit: 100 };
        if (lastMessageId) options.before = lastMessageId;

        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) {
          fetching = false;
          break;
        }

        for (const [, msg] of batch) {
          if (msg.createdAt < cutoffDate) {
            fetching = false;
            break;
          }
          if (!msg.author.bot) {
            allMessages.push(msg);
          }
        }

        lastMessageId = batch.last().id;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      if (allMessages.length === 0) {
        await updateProgress(`📭 Brak wiadomości do przeanalizowania z ostatnich ${days} dni.`);
        return;
      }

      // Sortuj chronologicznie
      allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      await updateProgress(`🔍 Skanowanie: znaleziono **${allMessages.length}** wiadomości. Analizuję...`);

      let analyzed = 0;
      let found = 0;
      let errors = 0;

      for (const message of allMessages) {
        try {
          const result = await aiAnalyzer.analyzeMessage(message);

          if (result && result.is_media_related && result.title) {
            const channelId = message.channel.id;
            const guildId = message.guild?.id;

            let thread = database.findActiveThread(result.title, channelId);
            let threadId;

            if (thread) {
              threadId = thread.thread_id;
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

            found++;
          }
        } catch (error) {
          errors++;
          logger.error(`Backfill error for message ${message.id}`, error.message);

          // Jeśli błąd API (rate limit, brak kredytów) - poczekaj dłużej
          if (error.status === 429 || error.status === 400) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        }

        analyzed++;

        // Aktualizuj postęp co 50 wiadomości
        if (analyzed % 50 === 0) {
          await updateProgress(
            `🔍 Skanowanie: **${analyzed}/${allMessages.length}** — znaleziono ${found} wzmianek${errors > 0 ? ` (${errors} błędów)` : ''}`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, API_DELAY));
      }

      // Podsumowanie
      const embed = new EmbedBuilder()
        .setTitle('Skanowanie zakończone')
        .setColor(0x2ecc71)
        .setDescription([
          `**Przeanalizowano:** ${analyzed} wiadomości`,
          `**Znaleziono wzmianek:** ${found}`,
          errors > 0 ? `**Błędy:** ${errors}` : '',
          `**Okres:** ostatnie ${days} dni`,
          '',
          'Użyj `/podsumowanie` aby zobaczyć wyniki!',
        ].filter(Boolean).join('\n'))
        .setTimestamp();

      if (dmChannel) {
        if (progressMsg) {
          await progressMsg.edit({ content: null, embeds: [embed] }).catch(() => {});
        } else {
          await dmChannel.send({ embeds: [embed] }).catch(() => {});
        }
      }

      logger.success(`Backfill completed: ${analyzed} analyzed, ${found} found, ${errors} errors`);
    } catch (error) {
      logger.error('Backfill failed', error.message);
      if (dmChannel) {
        await dmChannel.send('Skanowanie przerwane z powodu błędu. Sprawdź logi.').catch(() => {});
      }
    }
  },
};
