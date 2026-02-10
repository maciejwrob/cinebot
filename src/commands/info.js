// Komenda /info - szczegółowe informacje o konkretnym tytule

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const database = require('../database');
const { formatMentionCount, truncate, formatDate } = require('../utils/helpers');

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
        content: `Nie znaleziono wzmianek o "${title}".`,
        ephemeral: true,
      });
    }

    // Ikona w zależności od typu
    const typeIcons = { film: '🎬', serial: '📺', music: '🎵' };
    const typeIcon = typeIcons[info.type] || '📌';

    const embed = new EmbedBuilder()
      .setTitle(`${typeIcon} ${info.title}`)
      .setColor(0x9b59b6)
      .setTimestamp();

    // Statystyki - kompaktowe z ładnymi datami
    const statsText = [
      `Wzmianek: **${info.total_mentions}** | Użytkowników: **${info.unique_users}**`,
      `Pierwsza: **${formatDate(info.first_mention)}** | Ostatnia: **${formatDate(info.last_mention)}**`,
    ].join('\n');

    embed.addFields({ name: '📊 Statystyki', value: statsText });

    // Użytkownicy - kompaktowo
    if (info.users.length > 0) {
      const usersText = info.users
        .map((u) => `**${u.user_name}** (${u.count})`)
        .join(', ');
      embed.addFields({ name: '👥 Polecali', value: truncate(usersText, 1024) });
    }

    // Opinie (snippety) - max 3 żeby zmieścić się w limicie
    if (info.snippets.length > 0) {
      const opinionsText = info.snippets
        .filter(Boolean)
        .slice(0, 3)
        .map((s) => `"${truncate(s, 80)}"`)
        .join('\n');
      if (opinionsText) {
        embed.addFields({ name: '💬 Opinie', value: opinionsText });
      }
    }

    // Linki do rozmów - max 5 żeby nie przekroczyć limitu embeda
    if (info.links.length > 0) {
      const maxLinks = 5;
      const linksText = info.links
        .slice(0, maxLinks)
        .map((l) => `[${formatDate(l.mentioned_at)} — ${l.user_name}](${l.message_link})`)
        .join('\n');
      const suffix = info.total_mentions > maxLinks
        ? `\n*...i ${info.total_mentions - maxLinks} więcej*`
        : '';
      embed.addFields({
        name: '🔗 Rozmowy',
        value: truncate(linksText + suffix, 1024),
      });
    }

    return interaction.reply({ embeds: [embed] });
  },
};
