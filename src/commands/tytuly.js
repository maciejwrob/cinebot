// Komenda /tytuly - wysyła pełną listę tytułów na DM (admin only)

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const database = require('../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tytuly')
    .setDescription('[Admin] Wyślij pełną listę tytułów na DM')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('kategoria')
        .setDescription('Kategoria do wyświetlenia')
        .setRequired(true)
        .addChoices(
          { name: 'Seriale', value: 'serial' },
          { name: 'Filmy', value: 'film' },
          { name: 'Muzyka', value: 'music' }
        )
    ),

  async execute(interaction) {
    const type = interaction.options.getString('kategoria');
    const labels = { serial: '📺 Seriale', film: '🎬 Filmy', music: '🎵 Muzyka' };
    const label = labels[type];

    const results = database.getTopMedia(type, '1=1');

    if (results.length === 0) {
      return interaction.reply({ content: `Brak wzmianek w kategorii ${label}.`, ephemeral: true });
    }

    // Buduj listę tekstową
    const lines = results.map((r, i) =>
      `${i + 1}. ${r.title} (${r.mention_count}x, ${r.unique_users} os.)`
    );

    // Discord DM ma limit 2000 znaków na wiadomość - dziel na części
    const header = `**${label} — ${results.length} tytułów:**\n`;
    const chunks = [];
    let current = header;

    for (const line of lines) {
      if (current.length + line.length + 1 > 1900) {
        chunks.push(current);
        current = '';
      }
      current += line + '\n';
    }
    if (current) chunks.push(current);

    // Wyślij na DM
    await interaction.reply({ content: `Wysyłam listę ${label} na DM...`, ephemeral: true });

    try {
      const dm = await interaction.user.createDM();
      for (const chunk of chunks) {
        await dm.send(chunk);
      }
    } catch (e) {
      await interaction.followUp({ content: 'Nie mogę wysłać DM - sprawdź ustawienia prywatności.', ephemeral: true });
    }
  },
};
