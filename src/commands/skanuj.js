// Komenda /skanuj - jednorazowe skanowanie historii kanału

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const database = require('../database');
const aiAnalyzer = require('../ai-analyzer');
const { generateThreadId, createMessageLink } = require('../utils/helpers');

// Czas oczekiwania między requestami do Claude API (rate limiting)
const API_DELAY = 1500; // 1.5s

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skanuj')
    .setDescription('[Admin] Przeskanuj historię kanału i przeanalizuj wzmianki o mediach')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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

    // Odpowiedz od razu - skanowanie trwa długo
    await interaction.reply({
      content: `🔍 Rozpoczynam skanowanie kanału z ostatnich **${days} dni**. To może potrwać kilka minut...`,
    });

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      let allMessages = [];
      let lastMessageId = null;
      let fetching = true;

      // Pobieraj wiadomości partiami po 100 (limit Discord API)
      while (fetching) {
        const options = { limit: 100 };
        if (lastMessageId) options.before = lastMessageId;

        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) {
          fetching = false;
          break;
        }

        for (const [, msg] of batch) {
          // Sprawdź czy wiadomość jest w zakresie dat
          if (msg.createdAt < cutoffDate) {
            fetching = false;
            break;
          }
          // Ignoruj wiadomości botów
          if (!msg.author.bot) {
            allMessages.push(msg);
          }
        }

        lastMessageId = batch.last().id;

        // Krótka przerwa żeby nie przekroczyć rate limitu Discord API
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      if (allMessages.length === 0) {
        return interaction.editReply({
          content: `📭 Brak wiadomości do przeanalizowania z ostatnich ${days} dni.`,
        });
      }

      // Sortuj chronologicznie (najstarsze najpierw) dla lepszego kontekstu
      allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      await interaction.editReply({
        content: `🔍 Znaleziono **${allMessages.length}** wiadomości. Analizuję... (0/${allMessages.length})`,
      });

      let analyzed = 0;
      let found = 0;

      for (const message of allMessages) {
        try {
          const result = await aiAnalyzer.analyzeMessage(message);

          if (result && result.is_media_related && result.title) {
            const channelId = message.channel.id;
            const guildId = message.guild?.id;

            // Szukaj istniejącego wątku lub utwórz nowy
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
          logger.error(`Backfill analysis error for message ${message.id}`, error.message);
        }

        analyzed++;

        // Aktualizuj postęp co 20 wiadomości
        if (analyzed % 20 === 0) {
          await interaction.editReply({
            content: `🔍 Analizuję... (**${analyzed}/${allMessages.length}**) - znaleziono ${found} wzmianek`,
          }).catch(() => {});
        }

        // Rate limiting Claude API
        await new Promise((resolve) => setTimeout(resolve, API_DELAY));
      }

      // Podsumowanie
      const embed = new EmbedBuilder()
        .setTitle('✅ Skanowanie zakończone')
        .setColor(0x2ecc71)
        .setDescription([
          `📊 **Przeanalizowano:** ${analyzed} wiadomości`,
          `🎯 **Znaleziono wzmianek:** ${found}`,
          `📅 **Okres:** ostatnie ${days} dni`,
          '',
          'Użyj `/podsumowanie` aby zobaczyć wyniki!',
        ].join('\n'))
        .setTimestamp();

      await interaction.editReply({ content: null, embeds: [embed] });

      logger.success(`Backfill completed: ${analyzed} messages analyzed, ${found} mentions found`);
    } catch (error) {
      logger.error('Backfill failed', error.message);
      await interaction.editReply({
        content: '❌ Wystąpił błąd podczas skanowania. Sprawdź logi.',
      }).catch(() => {});
    }
  },
};
