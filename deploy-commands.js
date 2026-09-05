require("dotenv").config();

const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const config = require("./config");

function userReasonCommand(name, description, withDuration = false) {
  const command = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("המשתמש")
        .setRequired(true)
    );

  if (withDuration) {
    command.addStringOption(option =>
      option
        .setName("duration")
        .setDescription("זמן: 30s / 10m / 2h / 3d")
        .setRequired(true)
    );
  }

  command.addStringOption(option =>
    option
      .setName("reason")
      .setDescription("סיבה")
      .setRequired(false)
  );

  return command;
}

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("בודק אם Zone X עובד"),

  new SlashCommandBuilder()
    .setName("verify-panel")
    .setDescription("שולח פאנל Verify")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("שולח את פאנל הטיקטים של Zone X")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("setup-xp-shop")
    .setDescription("שולח את פאנל ה־XP Shop של Zone X"),

  userReasonCommand("warn", "נותן אזהרה למשתמש"),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("מציג את כל ה-Warns של משתמש")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("המשתמש לבדיקה")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("remove-warn")
    .setDescription("מסיר Warn ספציפי ממשתמש")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("המשתמש")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("id")
        .setDescription("Warn ID, לדוגמה W0001")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clear-warns")
    .setDescription("מוחק את כל ה-Warns של משתמש")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("המשתמש")
        .setRequired(true)
    ),

  userReasonCommand(
    "mute",
    "נותן Chat Mute זמני למשתמש",
    true
  ),

  userReasonCommand(
    "unmute",
    "מסיר Chat Mute ממשתמש"
  ),

  userReasonCommand(
    "timeout",
    "נותן Timeout זמני למשתמש",
    true
  ),

  userReasonCommand(
    "untimeout",
    "מסיר Timeout ממשתמש"
  ),

  userReasonCommand(
    "kick",
    "מעיף משתמש מהשרת"
  ),

  userReasonCommand(
    "ban",
    "נותן באן למשתמש"
  ),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("מוחק הודעות")
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("כמות הודעות")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
].map(command => command.toJSON());

const rest = new REST({
  version: "10"
}).setToken(process.env.TOKEN);

async function deployCommands() {
  try {
    if (!process.env.TOKEN) {
      console.error("❌ TOKEN missing in .env");
      process.exit(1);
    }

    if (!config.clientId) {
      console.error("❌ clientId missing in config.js");
      process.exit(1);
    }

    if (!config.guildId) {
      console.error("❌ guildId missing in config.js");
      process.exit(1);
    }

    console.log(
      `🔄 Registering ${commands.length} Zone X slash commands...`
    );

    const registered = await rest.put(
      Routes.applicationGuildCommands(
        config.clientId,
        config.guildId
      ),
      { body: commands }
    );

    console.log(
      `✅ Registered ${registered.length} Zone X slash commands`
    );

    console.log(
      registered
        .map(command => `✅ /${command.name}`)
        .join("\n")
    );
  } catch (error) {
    console.error("❌ Deploy error:", error);
    process.exit(1);
  }
}

deployCommands();
