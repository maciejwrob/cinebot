// Główny plik startowy bota - ładowanie konfiguracji i uruchomienie

require('dotenv').config();

const logger = require('./utils/logger');
const bot = require('./bot');
const database = require('./database');

// Walidacja wymaganych zmiennych środowiskowych
const requiredEnvVars = [
  'DISCORD_BOT_TOKEN',
  'ANTHROPIC_API_KEY',
  'MONITORED_CHANNEL_ID',
];

const missing = requiredEnvVars.filter((v) => !process.env[v]);
if (missing.length > 0) {
  logger.error(`Missing required environment variables: ${missing.join(', ')}`);
  logger.error('Create a .env file based on .env.example');
  process.exit(1);
}

// Obsługa graceful shutdown
function handleShutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  database.close();
  process.exit(0);
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

// Obsługa nieobsłużonych błędów
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection', error);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  database.close();
  process.exit(1);
});

// Uruchom bota
logger.info('Starting Discord Media Tracker Bot...');
bot.start().catch((error) => {
  logger.error('Failed to start bot', error);
  process.exit(1);
});
