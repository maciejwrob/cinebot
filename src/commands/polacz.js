// Komenda /polacz - łączy dwa tytuły w jeden (np. polski i angielski wariant)

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const database = require('../database');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('polacz')
    .setDescription('Połącz dwa tytuły w jeden (np. angielski i polski wariant)')
    .addStringOption((option) =>
      option
        .setName('zrodlo')
        .setDescription('Tytuł do scalenia (zostanie zamieniony)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName('cel')
        .setDescription('Tytuł docelowy (zostanie zachowany)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    const query = focusedOption.value;

    const results = query.length === 0
      ? database.searchTitles('%')
      : database.searchTitles(query);

    const choices = results.map((r) => ({
      name: `${r.title} (${r.mention_count} wzmianek)`,
      value: r.title,
    }));

    return interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const fromTitle = interaction.options.getString('zrodlo');
    const toTitle = interaction.options.getString('cel');

    if (fromTitle.toLowerCase() === toTitle.toLowerCase()) {
      return interaction.reply({
        content: '❌ Oba tytuły są identyczne.',
        ephemeral: true,
      });
    }

    const merged = database.mergeTitles(fromTitle, toTitle);

    logger.info(`Title merge by ${interaction.user.username}: "${fromTitle}" → "${toTitle}" (${merged} records)`);

    return interaction.reply({
      content: `✅ Scalono **"${fromTitle}"** → **"${toTitle}"**\n` +
        `Zaktualizowano **${merged}** wzmianek.\n` +
        `Przyszłe wzmianki "${fromTitle}" będą automatycznie zapisywane jako "${toTitle}".`,
    });
  },
};
