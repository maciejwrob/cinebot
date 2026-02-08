// Komenda /top-filmy - kompaktowa lista wszystkich filmów

const { SlashCommandBuilder } = require('discord.js');
const database = require('../database');
const { periodToSql } = require('../utils/helpers');
const { buildTopEmbed, ITEMS_PER_PAGE } = require('../utils/top-embed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('top-filmy')
    .setDescription('Pokaż wszystkie filmy omawiane na serwerze')
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
    const results = database.getTopMedia('film', clause);

    if (results.length === 0) {
      return interaction.reply({
        content: '🎬 Brak wzmianek o filmach w wybranym okresie.',
        ephemeral: true,
      });
    }

    const { embed, row } = buildTopEmbed(results, '🎬 Filmy', 0xe74c3c, label, 0);
    const options = { embeds: [embed] };
    if (row) options.components = [row];

    const reply = await interaction.reply({ ...options, fetchReply: true });

    if (results.length > ITEMS_PER_PAGE) {
      const collector = reply.createMessageComponentCollector({ time: 300000 });
      let currentPage = 0;

      collector.on('collect', async (btn) => {
        if (btn.user.id !== interaction.user.id) {
          return btn.reply({ content: 'To nie Twoja komenda.', ephemeral: true });
        }
        if (btn.customId.startsWith('top_next')) currentPage++;
        if (btn.customId.startsWith('top_prev')) currentPage--;

        const { embed: newEmbed, row: newRow } = buildTopEmbed(results, '🎬 Filmy', 0xe74c3c, label, currentPage);
        const opts = { embeds: [newEmbed] };
        opts.components = newRow ? [newRow] : [];
        await btn.update(opts);
      });
    }
  },
};
