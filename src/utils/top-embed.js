// Wspólna logika wyświetlania rankingów - kompaktowa lista wszystkich tytułów

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { formatMentionCount } = require('./helpers');

const ITEMS_PER_PAGE = 20;

/**
 * Buduje embed z kompaktową listą tytułów (paginowana)
 * @param {Array} results - Wyniki z bazy danych
 * @param {string} title - Tytuł embeda (np. "🎬 Filmy")
 * @param {number} color - Kolor embeda
 * @param {string} label - Etykieta okresu
 * @param {number} page - Numer strony (od 0)
 * @returns {{ embed: EmbedBuilder, row: ActionRowBuilder|null, totalPages: number }}
 */
function buildTopEmbed(results, title, color, label, page = 0) {
  const totalPages = Math.ceil(results.length / ITEMS_PER_PAGE);
  const start = page * ITEMS_PER_PAGE;
  const pageResults = results.slice(start, start + ITEMS_PER_PAGE);

  const medals = ['🥇', '🥈', '🥉'];

  const lines = pageResults.map((row, i) => {
    const rank = start + i;
    const icon = rank < 3 ? medals[rank] : `**${rank + 1}.**`;
    const users = row.unique_users === 1 ? '1 osoba' : `${row.unique_users} osób`;
    return `${icon} **${row.title}** — ${formatMentionCount(row.mention_count)} (${users})`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${title} — ${label}`)
    .setColor(color)
    .setDescription(lines.join('\n'))
    .setFooter({
      text: `Łącznie ${results.length} tytułów | Strona ${page + 1}/${totalPages} | Użyj /info [tytuł] aby zobaczyć szczegóły`,
    })
    .setTimestamp();

  // Przyciski nawigacji (tylko gdy > 1 strona)
  let row = null;
  if (totalPages > 1) {
    row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`top_prev_${page}`)
        .setLabel('◀ Poprzednia')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`top_next_${page}`)
        .setLabel('Następna ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );
  }

  return { embed, row, totalPages };
}

module.exports = { buildTopEmbed, ITEMS_PER_PAGE };
