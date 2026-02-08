// Komenda /top-muzyka - wyświetla ranking najpopularniejszej muzyki

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const database = require('../database');
const { periodToSql, formatMentionCount, truncate } = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('top-muzyka')
    .setDescription('Pokaż najpopularniejszą muzykę na serwerze')
    .addStringOption((option) =>
      option
        .setName('okres')
        .setDescription('Okres czasowy rankingu')
        .setRequired(false)
        .addChoices(
          { name: 'Tydzień', value: 'tydzien' },
          { name: 'Miesiąc', value: 'miesiac' },
          { name: 'Rok', value: 'rok' },
          { name: 'Wszystkie', value: 'wszystkie' }
        )
    ),

  async execute(interaction) {
    const period = interaction.options.getString('okres') || 'tydzien';
    const { clause, label } = periodToSql(period);
    const results = database.getTopMedia('music', clause, 10);

    if (results.length === 0) {
      return interaction.reply({
        content: '🎵 Brak wzmianek o muzyce w wybranym okresie.',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`🎵 Top Muzyka - ${label}`)
      .setColor(0x2ecc71)
      .setTimestamp();

    const medals = ['🥇', '🥈', '🥉'];
    const numbers = ['4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    const description = results
      .map((row, i) => {
        const icon = i < 3 ? medals[i] : numbers[i - 3] || `**${i + 1}.**`;
        const users = row.users
          ? row.users.split(',').slice(0, 3).join(', ')
          : 'Brak danych';
        const snippet = row.snippet ? `💬 "${truncate(row.snippet, 80)}"` : '';
        const link = row.first_link ? `[Zobacz rozmowę](${row.first_link})` : '';

        return [
          `${icon} **${row.title}** (${formatMentionCount(row.mention_count)})`,
          `   👥 Polecali: ${users}`,
          snippet ? `   ${snippet}` : '',
          link ? `   🔗 ${link}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');

    embed.setDescription(description);
    embed.setFooter({ text: `📊 Ranking z okresu: ${label}` });

    return interaction.reply({ embeds: [embed] });
  },
};
