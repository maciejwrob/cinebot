// Komenda /top-seriale - kompaktowa lista wszystkich seriali

const { SlashCommandBuilder } = require('discord.js');
const database = require('../database');
const { periodToSql } = require('../utils/helpers');
const { buildTopEmbed, ITEMS_PER_PAGE } = require('../utils/top-embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('top-seriale')
    .setDescription('Pokaż wszystkie seriale omawiane na serwerze')
    .addStringOption((option) =>
      option
        .setName('okres')
        .setDescription('Okres czasowy')
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
    const results = database.getTopMedia('serial', clause);

    if (results.length === 0) {
      return interaction.reply({
        content: '📺 Brak wzmianek o serialach w wybranym okresie.',
        ephemeral: true,
      });
    }

    const { embed, rows } = buildTopEmbed(results, '📺 Seriale', 0x3498db, label, 0);
    const options = { embeds: [embed] };
    if (rows.length) options.components = rows;

    const reply = await interaction.reply({ ...options, fetchReply: true });

    const collector = reply.createMessageComponentCollector({ time: 300000 });
    let currentPage = 0;

    collector.on('collect', async (btn) => {
      if (btn.customId.startsWith('info_select')) return;
      if (btn.user.id !== interaction.user.id) {
        return btn.reply({ content: 'To nie Twoja komenda.', ephemeral: true });
      }
      if (btn.customId.startsWith('top_next')) currentPage++;
      if (btn.customId.startsWith('top_prev')) currentPage--;

      const { embed: newEmbed, rows: newRows } = buildTopEmbed(results, '📺 Seriale', 0x3498db, label, currentPage);
      await btn.update({ embeds: [newEmbed], components: newRows });
    });
  },
};
