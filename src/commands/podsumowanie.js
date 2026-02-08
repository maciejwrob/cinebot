// Komenda /podsumowanie - podsumowanie top 3 z każdej kategorii z ostatnich 7 dni

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const database = require('../database');
const { formatMentionCount } = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('podsumowanie')
    .setDescription('Pokaż podsumowanie najpopularniejszych mediów z ostatnich 7 dni'),

  async execute(interaction) {
    const summary = database.getSummary();

    const embed = new EmbedBuilder()
      .setTitle('🔥 Co teraz jest HOT na serwerze?')
      .setColor(0xf39c12)
      .setTimestamp()
      .setFooter({ text: '📊 Podsumowanie z ostatnich 7 dni' });

    // Sekcja filmów
    const filmsText =
      summary.films.length > 0
        ? summary.films
            .map(
              (f, i) =>
                `${i + 1}. **${f.title}** (${formatMentionCount(f.mention_count)})`
            )
            .join('\n')
        : '_Brak wzmianek_';

    embed.addFields({ name: '🎬 FILMY', value: filmsText });

    // Sekcja seriali
    const seriesText =
      summary.series.length > 0
        ? summary.series
            .map(
              (s, i) =>
                `${i + 1}. **${s.title}** (${formatMentionCount(s.mention_count)})`
            )
            .join('\n')
        : '_Brak wzmianek_';

    embed.addFields({ name: '📺 SERIALE', value: seriesText });

    // Sekcja muzyki
    const musicText =
      summary.music.length > 0
        ? summary.music
            .map(
              (m, i) =>
                `${i + 1}. **${m.title}** (${formatMentionCount(m.mention_count)})`
            )
            .join('\n')
        : '_Brak wzmianek_';

    embed.addFields({ name: '🎵 MUZYKA', value: musicText });

    return interaction.reply({ embeds: [embed] });
  },
};
