// Wspólna logika wyświetlania rankingów - kompaktowa lista wszystkich tytułów

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { formatMentionCount } = require('./helpers');

const ITEMS_PER_PAGE = 15;

/**
 * Buduje embed z kompaktową listą tytułów (paginowana)
 * @param {Array} results - Wyniki z bazy danych
 * @param {string} title - Tytuł embeda (np. "🎬 Filmy")
 * @param {number} color - Kolor embeda
 * @param {string} label - Etykieta okresu
 * @param {number} page - Numer strony (od 0)
 * @returns {{ embed: EmbedBuilder, rows: ActionRowBuilder[], totalPages: number }}
 */
function buildTopEmbed(results, title, color, label, page = 0) {
  const totalPages = Math.ceil(results.length / ITEMS_PER_PAGE);
  const start = page * ITEMS_PER_PAGE;
  const pageResults = results.slice(start, start + ITEMS_PER_PAGE);

  const medals = ['🥇', '🥈', '🥉'];

  const lines = pageResults.map((row, i) => {
    const rank = start + i;
    const icon = rank < 3 ? medals[rank] : `**${rank + 1}.**`;
    const userNames = row.users
      ? row.users.split(',').slice(0, 4).join(', ')
      : '';
    const usersSuffix = row.unique_users > 4 ? ` +${row.unique_users - 4}` : '';
    return `${icon} **${row.title}** — ${formatMentionCount(row.mention_count)}\n    👥 ${userNames}${usersSuffix}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${title} — ${label}`)
    .setColor(color)
    .setDescription(lines.join('\n'))
    .setFooter({
      text: `Łącznie ${results.length} tytułów | Strona ${page + 1}/${totalPages}`,
    })
    .setTimestamp();

  const rows = [];

  // Dropdown z tytułami do szybkiego podglądu info
  if (pageResults.length > 0) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`info_select_${page}`)
      .setPlaceholder('Wybierz tytuł aby zobaczyć szczegóły...')
      .addOptions(
        pageResults.map((row, i) => ({
          label: row.title.substring(0, 100),
          description: `${formatMentionCount(row.mention_count)}, ${row.unique_users} użytkowników`,
          value: row.title.substring(0, 100),
        }))
      );
    rows.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  // Przyciski nawigacji (tylko gdy > 1 strona)
  if (totalPages > 1) {
    rows.push(
      new ActionRowBuilder().addComponents(
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
      )
    );
  }

  return { embed, rows, totalPages };
}

module.exports = { buildTopEmbed, ITEMS_PER_PAGE };
