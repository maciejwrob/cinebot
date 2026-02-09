// Komenda /wyczysc - czyści bazę danych (do ponownego skanowania)

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const database = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wyczysc')
    .setDescription('[Admin] Wyczyść bazę danych wzmianek (przed ponownym skanowaniem)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    database.clearAll();

    return interaction.reply({
      content: '🗑️ Baza danych wyczyszczona. Możesz teraz użyć `/skanuj` aby przeskanować od nowa.',
    });
  },
};
