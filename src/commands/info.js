// Komenda /info - szczegółowe informacje o konkretnym tytule

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const database = require('../database');
const { formatMentionCount, truncate } = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Pokaż szczegółowe informacje o filmie, serialu lub muzyce')
    .addStringOption((option) =>
      option
        .setName('tytul')
        .setDescription('Tytuł do wyszukania')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  // Obsługa autocomplete - podpowiadanie tytułów z bazy
  async autocomplete(interaction) {
    const query = interaction.options.getFocused();

    // Pokaż najpopularniejsze tytuły jeśli nic nie wpisano
    const results = query.length === 0
      ? database.searchTitles('%')
      : database.searchTitles(query);

    const choices = results.map((r) => ({
      name: truncate(`${r.title} (${r.type}) - ${formatMentionCount(r.mention_count)}`, 100),
      value: r.title,
    }));

    return interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const title = interaction.options.getString('tytul');
    const info = database.getMediaInfo(title);

    if (!info) {
      return interaction.reply({
        content: `❌ Nie znaleziono wzmianek o "${title}".`,
        ephemeral: true,
      });
    }

    // Ikona w zależności od typu
    const typeIcons = { film: '🎬', serial: '📺', music: '🎵' };
    const typeIcon = typeIcons[info.type] || '📌';

    const embed = new EmbedBuilder()
      .setTitle(`${typeIcon} Informacje: "${info.title}"`)
      .setColor(0x9b59b6)
      .setTimestamp();

    // Statystyki
    const statsText = [
      `• Łącznie wzmianek: **${info.total_mentions}**`,
      `• Unikalni użytkownicy: **${info.unique_users}**`,
      `• Pierwsza wzmianka: ${info.first_mention}`,
      `• Ostatnia wzmianka: ${info.last_mention}`,
    ].join('\n');

    embed.addFields({ name: '📊 Statystyki', value: statsText });

    // Użytkownicy
    if (info.users.length > 0) {
      const usersText = info.users
        .map((u) => `${u.user_name} (${formatMentionCount(u.count)})`)
        .join(', ');
      embed.addFields({ name: '👥 Polecali', value: truncate(usersText, 1024) });
    }

    // Opinie (snippety)
    if (info.snippets.length > 0) {
      const opinionsText = info.snippets
        .filter(Boolean)
        .map((s) => `"${truncate(s, 100)}"`)
        .join('\n');
      if (opinionsText) {
        embed.addFields({ name: '💬 Przykładowe opinie', value: opinionsText });
      }
    }

    // Linki do rozmów z datami
    if (info.links.length > 0) {
      const linksText = info.links
        .map((l) => {
          const date = l.mentioned_at.substring(0, 10); // YYYY-MM-DD
          return `• [${date} — ${l.user_name}](${l.message_link})`;
        })
        .join('\n');
      embed.addFields({
        name: `🔗 Ostatnie rozmowy (${Math.min(info.links.length, 10)} z ${info.total_mentions})`,
        value: truncate(linksText, 1024),
      });
    }

    return interaction.reply({ embeds: [embed] });
  },
};
