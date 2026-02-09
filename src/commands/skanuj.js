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
        content: '❌ Nie mogę znaleźć monitorowanego kanału.',
        ephemeral: true,
      });
    }

    // Odpowiedz od razu
    await interaction.reply({
      content: `🔍 Rozpoczynam skanowanie kanału z ostatnich **${days} dni**...`,
    });

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
        return interaction.editReply({
          content: `📭 Brak wiadomości do przeanalizowania z ostatnich ${days} dni.`,
        });
      }

      // Sortuj chronologicznie
      allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      // Wyslij osobna wiadomosc z postepem (interaction.editReply wygasa po 15min)
      const progressMsg = await channel.send(
        `🔍 Skanowanie: znaleziono **${allMessages.length}** wiadomości. Analizuję...`
      );

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

        // Aktualizuj postęp co 50 wiadomości (edytuj wiadomość bota, nie interaction)
        if (analyzed % 50 === 0) {
          await progressMsg.edit(
            `🔍 Skanowanie: **${analyzed}/${allMessages.length}** — znaleziono ${found} wzmianek${errors > 0 ? ` (${errors} błędów)` : ''}`
          ).catch(() => {});
        }

        await new Promise((resolve) => setTimeout(resolve, API_DELAY));
      }

      // Podsumowanie - edytuj wiadomość postępu
      const embed = new EmbedBuilder()
        .setTitle('✅ Skanowanie zakończone')
        .setColor(0x2ecc71)
        .setDescription([
          `📊 **Przeanalizowano:** ${analyzed} wiadomości`,
          `🎯 **Znaleziono wzmianek:** ${found}`,
          errors > 0 ? `⚠️ **Błędy:** ${errors}` : '',
          `📅 **Okres:** ostatnie ${days} dni`,
          '',
          'Użyj `/podsumowanie` aby zobaczyć wyniki!',
        ].filter(Boolean).join('\n'))
        .setTimestamp();

      await progressMsg.edit({ content: null, embeds: [embed] });

      logger.success(`Backfill completed: ${analyzed} analyzed, ${found} found, ${errors} errors`);
    } catch (error) {
      logger.error('Backfill failed', error.message);
      await channel.send('❌ Skanowanie przerwane z powodu błędu. Sprawdź logi.').catch(() => {});
    }
  },
};
