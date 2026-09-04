require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  Events,
  AttachmentBuilder
} = require("discord.js");

const config = require("./config");

const DATA_DIR = path.join(__dirname, "data");
const MOD_TIMERS_FILE = path.join(DATA_DIR, "mod-timers.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error("❌ JSON load error:", error);
    return fallback;
  }
}

function saveJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("❌ JSON save error:", error);
  }
}

const modTimers = loadJson(MOD_TIMERS_FILE, {});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Channel]
});

function isStaff(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    (config.staffRoleId && member?.roles?.cache?.has(config.staffRoleId))
  );
}

function parseDuration(input, maxDays = 30) {
  const match = String(input || "")
    .trim()
    .toLowerCase()
    .match(/^(\d+)\s*(s|m|h|d)$/);

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  const duration = amount * multipliers[unit];

  if (
    !Number.isFinite(duration) ||
    duration < 10 * 1000 ||
    duration > maxDays * 24 * 60 * 60 * 1000
  ) {
    return null;
  }

  return duration;
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} שניות`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} דקות`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} שעות`;

  const days = Math.floor(hours / 24);
  return `${days} ימים`;
}

function timerKey(guildId, userId, type) {
  return `${guildId}:${userId}:${type}`;
}

function addModTimer({ guildId, userId, type, expiresAt, reason, moderatorId }) {
  modTimers[timerKey(guildId, userId, type)] = {
    guildId,
    userId,
    type,
    expiresAt,
    reason,
    moderatorId,
    createdAt: Date.now()
  };

  saveJson(MOD_TIMERS_FILE, modTimers);
}

function removeModTimer(guildId, userId, type) {
  const key = timerKey(guildId, userId, type);

  if (modTimers[key]) {
    delete modTimers[key];
    saveJson(MOD_TIMERS_FILE, modTimers);
  }
}

async function sendModLog(guild, embed) {
  if (!config.modLogsChannelId) return;

  const channel = await guild.channels
    .fetch(config.modLogsChannelId)
    .catch(() => null);

  if (channel?.isTextBased()) {
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
}

function buildModEmbed(title, color, fields) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(fields)
    .setTimestamp();
}

async function getGuildMember(interaction, user) {
  return interaction.guild.members.fetch(user.id).catch(() => null);
}

async function checkModTimers() {
  const now = Date.now();
  let changed = false;

  for (const [key, timer] of Object.entries(modTimers)) {
    if (!timer || timer.expiresAt > now) continue;

    try {
      const guild = client.guilds.cache.get(timer.guildId);

      if (!guild) {
        delete modTimers[key];
        changed = true;
        continue;
      }

      const member = await guild.members
        .fetch(timer.userId)
        .catch(() => null);

      if (timer.type === "chat-mute") {
        const muteRole = config.muteRoleId
          ? await guild.roles.fetch(config.muteRoleId).catch(() => null)
          : null;

        if (member && muteRole && member.roles.cache.has(muteRole.id)) {
          await member.roles.remove(
            muteRole,
            "Zone X automatic mute expiration"
          ).catch(error => {
            console.error("❌ Auto unmute error:", error);
          });

          await sendModLog(
            guild,
            buildModEmbed(
              "🔊 Chat Mute הסתיים אוטומטית",
              "Green",
              [
                { name: "משתמש", value: `<@${timer.userId}>` },
                {
                  name: "סיבה מקורית",
                  value: timer.reason || "לא צוינה סיבה"
                }
              ]
            )
          );
        }
      }

      delete modTimers[key];
      changed = true;
    } catch (error) {
      console.error("❌ Timer processing error:", error);
    }
  }

  if (changed) {
    saveJson(MOD_TIMERS_FILE, modTimers);
  }
}

// =====================
// VERIFY — SAME STYLE AS SALES BOT
// =====================

async function sendVerifyPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor("Blue")
    .setTitle("Verify ✅")
    .setDescription(
      "לחץ על הכפתור, תקבל מספר, ואז תלחץ על המספר הנכון."
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("start_verify")
      .setLabel("Verify")
      .setStyle(ButtonStyle.Success)
  );

  return channel.send({ embeds: [embed], components: [row] });
}


// =====================
// TICKETS
// =====================

const TICKET_PANEL_IMAGE = path.join(
  __dirname,
  "assets",
  "zone-x-server.webp"
);

const TICKET_TYPES = {
  general_question: {
    name: "שאלה כללית",
    emoji: "❓",
    access: "regular"
  },
  complaint: {
    name: "תלונה על ממבר/חבר צוות",
    emoji: "⚠️",
    access: "regular"
  },
  bug_report: {
    name: "דיווח על באג בשרת",
    emoji: "🛠️",
    access: "regular"
  },
  partnership: {
    name: "שיתוף פעולה",
    emoji: "🤝",
    access: "regular"
  },
  staff_test: {
    name: "בחינה לצוות",
    emoji: "📝",
    access: "staff_test"
  }
};

function hasTicketConfig() {
  return Boolean(
    config.ticketCategoryId &&
    config.ticketStaffRoleId &&
    config.staffTestTicketRoleId &&
    config.ticketLogsChannelId
  );
}

function getTicketAccessRoleIdByType(ticketType) {
  return ticketType?.access === "staff_test"
    ? config.staffTestTicketRoleId
    : config.ticketStaffRoleId;
}

function getTicketAccessRoleIdFromChannel(channel) {
  const ticketKey =
    channel.topic?.match(/ticketKey:([^|]+)/)?.[1]?.trim();

  const ticketType = ticketKey
    ? TICKET_TYPES[ticketKey]
    : null;

  return getTicketAccessRoleIdByType(ticketType);
}

function isTicketStaff(member, channel = null) {
  if (member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const requiredRoleId = channel
    ? getTicketAccessRoleIdFromChannel(channel)
    : config.ticketStaffRoleId;

  return Boolean(
    requiredRoleId &&
    member?.roles?.cache?.has(requiredRoleId)
  );
}

function getTicketOwner(channel) {
  return (
    channel.topic?.match(/ticketOwner:(\d{17,20})/)?.[1] ||
    null
  );
}

function getTicketClaimedBy(channel) {
  return (
    channel.topic?.match(/claimedBy:(\d{17,20})/)?.[1] ||
    null
  );
}

function getTicketType(channel) {
  return (
    channel.topic?.match(/ticketType:([^|]+)/)?.[1]?.trim() ||
    "לא ידוע"
  );
}

async function setTicketClaimedBy(channel, userId = null) {
  const currentTopic = channel.topic || "";

  const cleanedTopic = currentTopic
    .replace(/\s*\|\s*claimedBy:\d{17,20}/g, "")
    .trim();

  const newTopic = userId
    ? `${cleanedTopic} | claimedBy:${userId}`.slice(0, 1024)
    : cleanedTopic.slice(0, 1024);

  await channel.setTopic(newTopic).catch(() => {});
}

function buildTicketButtons(claimedById = null) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("zone_ticket_claim")
      .setLabel("Claim")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Success)
      .setDisabled(Boolean(claimedById)),

    new ButtonBuilder()
      .setCustomId("zone_ticket_release")
      .setLabel("Release")
      .setEmoji("🔓")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!claimedById),

    new ButtonBuilder()
      .setCustomId("zone_ticket_add_user")
      .setLabel("Add User")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!claimedById),

    new ButtonBuilder()
      .setCustomId("zone_ticket_remove_user")
      .setLabel("Remove User")
      .setEmoji("➖")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!claimedById),

    new ButtonBuilder()
      .setCustomId("zone_ticket_close")
      .setLabel("Close")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );
}

async function sendTicketPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor("Blue")
    .setTitle("🎟️ מערכת פניות (טיקטים)")
    .setDescription(
      "בחרו את סוג הפנייה שלכם מהתפריט למטה כדי לפתוח טיקט מול צוות השרת.\n" +
      "אנא פתחו טיקט רק במידת הצורך."
    );

  const files = [];

  if (fs.existsSync(TICKET_PANEL_IMAGE)) {
    embed.setThumbnail("attachment://zone-x-server.webp");

    files.push(
      new AttachmentBuilder(TICKET_PANEL_IMAGE, {
        name: "zone-x-server.webp"
      })
    );
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("zone_ticket_type_select")
      .setPlaceholder("בחר את נושא הפנייה...")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("שאלה כללית")
          .setEmoji("❓")
          .setValue("general_question"),

        new StringSelectMenuOptionBuilder()
          .setLabel("תלונה על ממבר/חבר צוות")
          .setEmoji("⚠️")
          .setValue("complaint"),

        new StringSelectMenuOptionBuilder()
          .setLabel("דיווח על באג בשרת")
          .setEmoji("🛠️")
          .setValue("bug_report"),

        new StringSelectMenuOptionBuilder()
          .setLabel("שיתוף פעולה")
          .setEmoji("🤝")
          .setValue("partnership"),

        new StringSelectMenuOptionBuilder()
          .setLabel("בחינה לצוות")
          .setEmoji("📝")
          .setValue("staff_test")
      )
  );

  return channel.send({
    embeds: [embed],
    components: [row],
    files
  });
}

async function createTicketTranscript(channel) {
  const messages = await channel.messages.fetch({
    limit: 100
  });

  const sorted = [...messages.values()].sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );

  let transcript = `Zone X Ticket Transcript\n`;
  transcript += `Channel: #${channel.name}\n`;
  transcript += `Channel ID: ${channel.id}\n`;
  transcript += `Ticket Type: ${getTicketType(channel)}\n`;
  transcript += `Owner ID: ${getTicketOwner(channel) || "unknown"}\n`;
  transcript += `Created: ${new Date().toLocaleString("he-IL")}\n\n`;

  for (const message of sorted) {
    transcript +=
      `[${message.createdAt.toLocaleString("he-IL")}] ` +
      `${message.author.tag}: ` +
      `${message.content || "[בלי טקסט]"}\n`;

    message.attachments.forEach(attachment => {
      transcript += `Attachment: ${attachment.url}\n`;
    });
  }

  return new AttachmentBuilder(
    Buffer.from(transcript, "utf8"),
    {
      name: `${channel.name}-transcript.txt`
    }
  );
}

async function openTicket(interaction, ticketData) {
  if (!hasTicketConfig()) {
    return interaction.reply({
      content:
        "❌ חסרים IDs של מערכת הטיקטים ב־config.js.",
      ephemeral: true
    });
  }

  const existingChannel =
    interaction.guild.channels.cache.find(channel =>
      channel.topic?.includes(
        `ticketOwner:${interaction.user.id}`
      )
    );

  if (existingChannel) {
    return interaction.reply({
      content:
        `❌ כבר יש לך טיקט פתוח: ${existingChannel}`,
      ephemeral: true
    });
  }

  const safeName = interaction.user.username
    .toLowerCase()
    .replace(/[^a-z0-9א-ת]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 22);

  const ticketAccessRoleId =
    getTicketAccessRoleIdByType(ticketData);

  if (!ticketAccessRoleId) {
    return interaction.reply({
      content:
        "❌ לא הוגדר רול מתאים לסוג הטיקט הזה ב־config.js.",
      ephemeral: true
    });
  }

  const ticketKey = Object.entries(TICKET_TYPES)
    .find(([, data]) => data === ticketData)?.[0];

  const ticketChannel =
    await interaction.guild.channels.create({
      name: `ticket-${safeName || interaction.user.id}`,
      type: ChannelType.GuildText,
      parent: config.ticketCategoryId,
      topic:
        `ticketOwner:${interaction.user.id} | ` +
        `ticketType:${ticketData.name} | ` +
        `ticketKey:${ticketKey}`,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: [PermissionFlagsBits.ViewChannel]
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ]
        },
        {
          id: ticketAccessRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages
          ]
        }
      ]
    });

  const ticketEmbed = new EmbedBuilder()
    .setColor("Blue")
    .setTitle(`${ticketData.emoji} טיקט חדש`)
    .setDescription(
      `👤 משתמש: ${interaction.user}\n` +
      `📌 נושא: **${ticketData.name}**\n\n` +
      "צוות השרת יענה בהקדם האפשרי."
    )
    .setTimestamp();

  await ticketChannel.send({
    content:
      `<@${interaction.user.id}> <@&${ticketAccessRoleId}>`,
    embeds: [ticketEmbed],
    components: [buildTicketButtons()],
    allowedMentions: {
      users: [interaction.user.id],
      roles: [ticketAccessRoleId]
    }
  });

  return interaction.reply({
    content: `✅ הטיקט שלך נפתח: ${ticketChannel}`,
    ephemeral: true
  });
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`✅ Zone X logged in as ${readyClient.user.tag}`);
  console.log("🎟️ Zone X ticket system loaded");

  await checkModTimers();

  setInterval(() => {
    checkModTimers().catch(error => {
      console.error("❌ Mod timer interval error:", error);
    });
  }, 10 * 1000);
});

async function replyToInteraction(interaction, payload) {
  const data =
    typeof payload === "string"
      ? { content: payload }
      : { ...payload };

  // ephemeral is decided by deferReply and cannot be changed in editReply.
  if (interaction.deferred) {
    delete data.ephemeral;
    return interaction.editReply(data);
  }

  if (interaction.replied) {
    return interaction.followUp(data);
  }

  return interaction.reply(data);
}

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      // Discord requires slash commands to be acknowledged quickly.
      // Defer immediately, then all command replies below use editReply.
      await interaction.deferReply({ ephemeral: true });

      if (interaction.commandName === "ping") {
        return replyToInteraction(interaction, {
          content: `🏓 Pong! ${client.ws.ping}ms`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "verify-panel") {
        if (
          !interaction.member.permissions.has(
            PermissionFlagsBits.ManageGuild
          )
        ) {
          return replyToInteraction(interaction, {
            content: "❌ אין לך גישה לשלוח פאנל Verify.",
            ephemeral: true
          });
        }

        await sendVerifyPanel(interaction.channel);

        return replyToInteraction(interaction, {
          content: "✅ פאנל ה־Verify נשלח.",
          ephemeral: true
        });
      }

      if (interaction.commandName === "ticket-panel") {
        if (
          !interaction.member.permissions.has(
            PermissionFlagsBits.ManageGuild
          )
        ) {
          return replyToInteraction(interaction, {
            content:
              "❌ אין לך גישה לשלוח פאנל טיקטים.",
            ephemeral: true
          });
        }

        if (!hasTicketConfig()) {
          return replyToInteraction(interaction, {
            content:
              "❌ חסרים ticketCategoryId / ticketStaffRoleId / staffTestTicketRoleId / ticketLogsChannelId ב־config.js.",
            ephemeral: true
          });
        }

        if (!interaction.channel?.isTextBased()) {
          return replyToInteraction(interaction, {
            content:
              "❌ אפשר לשלוח את פאנל הטיקטים רק בחדר טקסט.",
            ephemeral: true
          });
        }

        const botMember =
          await interaction.guild.members
            .fetchMe()
            .catch(() => null);

        const permissions = botMember
          ? interaction.channel.permissionsFor(botMember)
          : null;

        const missingPermissions = [];

        if (
          !permissions?.has(
            PermissionFlagsBits.ViewChannel
          )
        ) {
          missingPermissions.push("View Channel");
        }

        if (
          !permissions?.has(
            PermissionFlagsBits.SendMessages
          )
        ) {
          missingPermissions.push("Send Messages");
        }

        if (
          !permissions?.has(
            PermissionFlagsBits.EmbedLinks
          )
        ) {
          missingPermissions.push("Embed Links");
        }

        if (
          fs.existsSync(TICKET_PANEL_IMAGE) &&
          !permissions?.has(
            PermissionFlagsBits.AttachFiles
          )
        ) {
          missingPermissions.push("Attach Files");
        }

        if (missingPermissions.length) {
          return replyToInteraction(interaction, {
            content:
              "❌ לבוט חסרות הרשאות בחדר הזה:\n" +
              missingPermissions
                .map(permission => `• ${permission}`)
                .join("\n"),
            ephemeral: true
          });
        }

        try {
          await sendTicketPanel(interaction.channel);

          return replyToInteraction(interaction, {
            content: "✅ פאנל הטיקטים נשלח.",
            ephemeral: true
          });
        } catch (error) {
          console.error(
            "❌ Ticket panel send error:",
            error
          );

          return replyToInteraction(interaction, {
            content:
              "❌ לא הצלחתי לשלוח את פאנל הטיקטים.\n" +
              `שגיאה: \`${error.code || error.message}\``,
            ephemeral: true
          });
        }
      }

      const moderationCommands = [
        "warn",
        "mute",
        "unmute",
        "timeout",
        "untimeout",
        "kick",
        "ban",
        "clear"
      ];

      if (moderationCommands.includes(interaction.commandName)) {
        if (!isStaff(interaction.member)) {
          return replyToInteraction(interaction, {
            content: "❌ אין לך גישה לפקודת המודרציה הזאת.",
            ephemeral: true
          });
        }
      }

      if (interaction.commandName === "warn") {
        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const member = await getGuildMember(interaction, user);

        if (!member) {
          return replyToInteraction(interaction, {
            content: "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        await user.send(
          `⚠️ קיבלת אזהרה בשרת **${interaction.guild.name}**.\n` +
          `סיבה: ${reason}`
        ).catch(() => {});

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "⚠️ Warn",
            "Yellow",
            [
              { name: "משתמש", value: `${user}` },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content: `✅ ${user} קיבל אזהרה.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "mute") {
        if (!config.muteRoleId) {
          return replyToInteraction(interaction, {
            content: "❌ חסר `muteRoleId` ב־config.js.",
            ephemeral: true
          });
        }

        const user = interaction.options.getUser("user");
        const durationText =
          interaction.options.getString("duration");
        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const duration = parseDuration(durationText, 28);

        if (!duration) {
          return replyToInteraction(interaction, {
            content:
              "❌ זמן לא תקין. השתמש לדוגמה ב־`30s`, `10m`, `2h`, `3d`. " +
              "המינימום 10 שניות והמקסימום 28 ימים.",
            ephemeral: true
          });
        }

        const member = await getGuildMember(interaction, user);

        if (!member) {
          return replyToInteraction(interaction, {
            content: "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        if (
          member.permissions.has(PermissionFlagsBits.Administrator) &&
          interaction.guild.ownerId !== interaction.user.id
        ) {
          return replyToInteraction(interaction, {
            content: "❌ אי אפשר לעשות Mute לאדמין.",
            ephemeral: true
          });
        }

        const muteRole = await interaction.guild.roles
          .fetch(config.muteRoleId)
          .catch(() => null);

        if (!muteRole) {
          return replyToInteraction(interaction, {
            content: "❌ לא מצאתי את רול ה־Mute.",
            ephemeral: true
          });
        }

        const botMember = await interaction.guild.members.fetchMe();

        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
          return replyToInteraction(interaction, {
            content: "❌ לבוט אין `Manage Roles`.",
            ephemeral: true
          });
        }

        if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
          return replyToInteraction(interaction, {
            content: "❌ לבוט אין `Moderate Members`, ולכן הוא לא יכול להפעיל Mute אמיתי.",
            ephemeral: true
          });
        }

        if (!member.moderatable) {
          return replyToInteraction(interaction, {
            content: "❌ אי אפשר לעשות Mute למשתמש הזה. בדוק שהרול של הבוט מעל הרול שלו.",
            ephemeral: true
          });
        }

        if (
          muteRole.managed ||
          muteRole.position >= botMember.roles.highest.position
        ) {
          return replyToInteraction(interaction, {
            content:
              "❌ הבוט לא יכול לנהל את רול ה־Mute. " +
              "שים את רול הבוט מעל רול ה־Mute.",
            ephemeral: true
          });
        }

        await member.roles.add(
          muteRole,
          `${reason} | by ${interaction.user.tag}`
        );

        try {
          await member.timeout(
            duration,
            `${reason} | Zone X mute by ${interaction.user.tag}`
          );
        } catch (error) {
          await member.roles.remove(
            muteRole,
            "Zone X mute rollback because timeout failed"
          ).catch(() => {});

          console.error("❌ Mute timeout error:", error);

          return replyToInteraction(interaction, {
            content:
              "❌ הצלחתי לתת את רול ה־Mute אבל לא הצלחתי להפעיל Mute אמיתי, ולכן ביטלתי את הפעולה.\n" +
              `שגיאה: \`${error.code || error.message}\``,
            ephemeral: true
          });
        }

        addModTimer({
          guildId: interaction.guild.id,
          userId: user.id,
          type: "chat-mute",
          expiresAt: Date.now() + duration,
          reason,
          moderatorId: interaction.user.id
        });

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "🔇 Chat Mute",
            "Orange",
            [
              { name: "משתמש", value: `${user}` },
              { name: "זמן", value: formatDuration(duration) },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content:
            `✅ ${user} קיבל Mute אמיתי ל־**${formatDuration(duration)}**.\n` +
            "הופעל גם Discord Timeout וגם רול Mute. בסוף הזמן ה־Timeout יסתיים והרול יוסר אוטומטית.",
          ephemeral: true
        });
      }

      if (interaction.commandName === "unmute") {
        if (!config.muteRoleId) {
          return replyToInteraction(interaction, {
            content: "❌ חסר `muteRoleId` ב־config.js.",
            ephemeral: true
          });
        }

        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") ||
          "הוסר ידנית";

        const member = await getGuildMember(interaction, user);

        if (!member) {
          return replyToInteraction(interaction, {
            content: "❌ המשתמש לא נמצא בשרת.",
            ephemeral: true
          });
        }

        const muteRole = await interaction.guild.roles
          .fetch(config.muteRoleId)
          .catch(() => null);

        if (!muteRole) {
          return replyToInteraction(interaction, {
            content: "❌ לא מצאתי את רול ה־Mute.",
            ephemeral: true
          });
        }

        await member.roles.remove(
          muteRole,
          `${reason} | by ${interaction.user.tag}`
        );

        if (member.moderatable) {
          await member.timeout(
            null,
            `${reason} | Zone X unmute by ${interaction.user.tag}`
          ).catch(error => {
            console.error("❌ Unmute timeout clear error:", error);
          });
        }

        removeModTimer(
          interaction.guild.id,
          user.id,
          "chat-mute"
        );

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "🔊 Chat Unmute",
            "Green",
            [
              { name: "משתמש", value: `${user}` },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content: `✅ ה־Mute הוסר מ־${user} — גם הרול וגם ה־Timeout.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "timeout") {
        const user = interaction.options.getUser("user");
        const durationText =
          interaction.options.getString("duration");
        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const duration = parseDuration(durationText, 28);

        if (!duration) {
          return replyToInteraction(interaction, {
            content:
              "❌ זמן לא תקין. השתמש לדוגמה ב־`30s`, `10m`, `2h`, `3d`. " +
              "המקסימום ל־Timeout הוא 28 ימים.",
            ephemeral: true
          });
        }

        const member = await getGuildMember(interaction, user);

        if (!member?.moderatable) {
          return replyToInteraction(interaction, {
            content: "❌ אי אפשר לעשות Timeout למשתמש הזה.",
            ephemeral: true
          });
        }

        await member.timeout(
          duration,
          `${reason} | by ${interaction.user.tag}`
        );

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "⏳ Timeout",
            "Orange",
            [
              { name: "משתמש", value: `${user}` },
              { name: "זמן", value: formatDuration(duration) },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content:
            `✅ ${user} קיבל Timeout ל־**${formatDuration(duration)}**.\n` +
            "Discord יסיר את ה־Timeout אוטומטית בזמן שנבחר.",
          ephemeral: true
        });
      }

      if (interaction.commandName === "untimeout") {
        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") ||
          "הוסר ידנית";

        const member = await getGuildMember(interaction, user);

        if (!member?.moderatable) {
          return replyToInteraction(interaction, {
            content: "❌ אי אפשר לשנות Timeout למשתמש הזה.",
            ephemeral: true
          });
        }

        await member.timeout(
          null,
          `${reason} | by ${interaction.user.tag}`
        );

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "✅ Timeout הוסר",
            "Green",
            [
              { name: "משתמש", value: `${user}` },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content: `✅ ה־Timeout הוסר מ־${user}.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "kick") {
        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const member = await getGuildMember(interaction, user);

        if (!member?.kickable) {
          return replyToInteraction(interaction, {
            content: "❌ אי אפשר להעיף את המשתמש הזה.",
            ephemeral: true
          });
        }

        await member.kick(
          `${reason} | by ${interaction.user.tag}`
        );

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "👢 Kick",
            "Red",
            [
              { name: "משתמש", value: `${user.tag}` },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content: `✅ ${user.tag} הועף מהשרת.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "ban") {
        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") ||
          "לא צוינה סיבה";

        const member = await getGuildMember(interaction, user);

        if (member && !member.bannable) {
          return replyToInteraction(interaction, {
            content: "❌ אי אפשר לתת באן למשתמש הזה.",
            ephemeral: true
          });
        }

        await interaction.guild.members.ban(user.id, {
          reason: `${reason} | by ${interaction.user.tag}`
        });

        await sendModLog(
          interaction.guild,
          buildModEmbed(
            "🔨 Ban",
            "DarkRed",
            [
              { name: "משתמש", value: `${user.tag}` },
              { name: "צוות", value: `${interaction.user}` },
              { name: "סיבה", value: reason }
            ]
          )
        );

        return replyToInteraction(interaction, {
          content: `✅ ${user.tag} קיבל באן.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "clear") {
        const amount = interaction.options.getInteger("amount");

        if (!interaction.channel?.isTextBased()) {
          return replyToInteraction(interaction, {
            content: "❌ הפקודה הזאת עובדת רק בחדר טקסט.",
            ephemeral: true
          });
        }

        const deleted = await interaction.channel.bulkDelete(amount, true);

        return replyToInteraction(interaction, {
          content: `✅ נמחקו ${deleted.size} הודעות.`,
          ephemeral: true
        });
      }

      console.warn(
        `⚠️ Unknown slash command received: /${interaction.commandName}`
      );

      return replyToInteraction(interaction, {
        content:
          `❌ הפקודה /${interaction.commandName} רשומה בדיסקורד, ` +
          "אבל ה־index.js שרץ כרגע לא מטפל בה. " +
          "עצור את הבוט, החלף לקובץ החדש והפעל מחדש.",
        ephemeral: true
      });
    }

    if (interaction.isStringSelectMenu()) {
      if (
        interaction.customId !==
        "zone_ticket_type_select"
      ) {
        return;
      }

      const ticketData =
        TICKET_TYPES[interaction.values[0]];

      if (!ticketData) {
        return interaction.reply({
          content: "❌ סוג הטיקט לא תקין.",
          ephemeral: true
        });
      }

      return openTicket(interaction, ticketData);
    }

    if (interaction.isUserSelectMenu()) {
      if (
        interaction.customId !==
          "zone_ticket_add_user_select" &&
        interaction.customId !==
          "zone_ticket_remove_user_select"
      ) {
        return;
      }

      const claimedById =
        getTicketClaimedBy(interaction.channel);

      if (!claimedById) {
        return interaction.reply({
          content:
            "❌ קודם איש צוות צריך לעשות Claim לטיקט.",
          ephemeral: true
        });
      }

      if (interaction.user.id !== claimedById) {
        return interaction.reply({
          content:
            "❌ רק מי שעשה Claim לטיקט יכול לבצע את הפעולה הזאת.",
          ephemeral: true
        });
      }

      const selectedUser =
        interaction.users.first();

      if (!selectedUser) {
        return interaction.update({
          content: "❌ לא נבחר משתמש.",
          components: []
        });
      }

      const ticketOwnerId =
        getTicketOwner(interaction.channel);

      if (
        interaction.customId ===
        "zone_ticket_add_user_select"
      ) {
        await interaction.channel.permissionOverwrites.edit(
          selectedUser.id,
          {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          },
          {
            reason:
              `Zone X ticket add user by ${interaction.user.tag}`
          }
        );

        return interaction.update({
          content: `✅ ${selectedUser} נוסף לטיקט.`,
          components: []
        });
      }

      if (selectedUser.id === ticketOwnerId) {
        return interaction.update({
          content:
            "❌ אי אפשר להסיר את מי שפתח את הטיקט.",
          components: []
        });
      }

      if (selectedUser.id === claimedById) {
        return interaction.update({
          content:
            "❌ אי אפשר להסיר את איש הצוות שלקח את הטיקט.",
          components: []
        });
      }

      const selectedMember =
        await interaction.guild.members
          .fetch(selectedUser.id)
          .catch(() => null);

      const ticketAccessRoleId =
        getTicketAccessRoleIdFromChannel(
          interaction.channel
        );

      if (
        ticketAccessRoleId &&
        selectedMember?.roles.cache.has(
          ticketAccessRoleId
        )
      ) {
        return interaction.update({
          content:
            "❌ אי אפשר להסיר איש צוות מהטיקט.",
          components: []
        });
      }

      await interaction.channel.permissionOverwrites
        .delete(
          selectedUser.id,
          `Zone X ticket remove user by ${interaction.user.tag}`
        )
        .catch(() => null);

      return interaction.update({
        content: `✅ ${selectedUser} הוסר מהטיקט.`,
        components: []
      });
    }

    if (!interaction.isButton()) return;

    if (interaction.customId === "zone_ticket_claim") {
      if (!isTicketStaff(interaction.member, interaction.channel)) {
        return interaction.reply({
          content: "❌ רק צוות יכול לעשות Claim לטיקט.",
          ephemeral: true
        });
      }

      const alreadyClaimedBy =
        getTicketClaimedBy(interaction.channel);

      if (alreadyClaimedBy) {
        return interaction.reply({
          content:
            `❌ הטיקט כבר נלקח על ידי <@${alreadyClaimedBy}>.`,
          ephemeral: true
        });
      }

      await setTicketClaimedBy(
        interaction.channel,
        interaction.user.id
      );

      await interaction.update({
        components: [
          buildTicketButtons(interaction.user.id)
        ]
      });

      return interaction.channel.send(
        `🙋 הטיקט נלקח על ידי <@${interaction.user.id}>`
      ).catch(() => {});
    }

    if (interaction.customId === "zone_ticket_release") {
      const claimedById =
        getTicketClaimedBy(interaction.channel);

      if (!claimedById) {
        return interaction.reply({
          content: "❌ הטיקט כבר משוחרר.",
          ephemeral: true
        });
      }

      if (interaction.user.id !== claimedById) {
        return interaction.reply({
          content:
            "❌ רק מי שעשה Claim יכול לשחרר את הטיקט.",
          ephemeral: true
        });
      }

      await setTicketClaimedBy(
        interaction.channel,
        null
      );

      await interaction.update({
        components: [buildTicketButtons()]
      });

      return interaction.channel.send(
        `🔓 <@${interaction.user.id}> שחרר את הטיקט.`
      ).catch(() => {});
    }

    if (interaction.customId === "zone_ticket_add_user") {
      const claimedById =
        getTicketClaimedBy(interaction.channel);

      if (
        !claimedById ||
        interaction.user.id !== claimedById
      ) {
        return interaction.reply({
          content:
            "❌ רק מי שעשה Claim יכול להוסיף משתמשים.",
          ephemeral: true
        });
      }

      const row =
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(
              "zone_ticket_add_user_select"
            )
            .setPlaceholder(
              "בחר משתמש להוסיף לטיקט"
            )
            .setMinValues(1)
            .setMaxValues(1)
        );

      return interaction.reply({
        content: "➕ בחר משתמש להוסיף:",
        components: [row],
        ephemeral: true
      });
    }

    if (
      interaction.customId ===
      "zone_ticket_remove_user"
    ) {
      const claimedById =
        getTicketClaimedBy(interaction.channel);

      if (
        !claimedById ||
        interaction.user.id !== claimedById
      ) {
        return interaction.reply({
          content:
            "❌ רק מי שעשה Claim יכול להסיר משתמשים.",
          ephemeral: true
        });
      }

      const row =
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(
              "zone_ticket_remove_user_select"
            )
            .setPlaceholder(
              "בחר משתמש להסיר מהטיקט"
            )
            .setMinValues(1)
            .setMaxValues(1)
        );

      return interaction.reply({
        content: "➖ בחר משתמש להסיר:",
        components: [row],
        ephemeral: true
      });
    }

    if (interaction.customId === "zone_ticket_close") {
      if (!isTicketStaff(interaction.member, interaction.channel)) {
        return interaction.reply({
          content: "❌ רק צוות יכול לסגור טיקטים.",
          ephemeral: true
        });
      }

      await interaction.deferReply({
        ephemeral: true
      });

      const logsChannel =
        await interaction.guild.channels
          .fetch(config.ticketLogsChannelId)
          .catch(() => null);

      const transcriptFile =
        await createTicketTranscript(
          interaction.channel
        ).catch(() => null);

      if (logsChannel?.isTextBased()) {
        const closeEmbed =
          new EmbedBuilder()
            .setColor("Red")
            .setTitle("🔒 Ticket Closed")
            .addFields(
              {
                name: "טיקט",
                value: `#${interaction.channel.name}`
              },
              {
                name: "נושא",
                value: getTicketType(
                  interaction.channel
                )
              },
              {
                name: "נפתח על ידי",
                value:
                  `<@${getTicketOwner(interaction.channel)}>`
              },
              {
                name: "נסגר על ידי",
                value: `${interaction.user}`
              }
            )
            .setTimestamp();

        await logsChannel.send({
          embeds: [closeEmbed],
          files:
            transcriptFile
              ? [transcriptFile]
              : []
        }).catch(() => {});
      }

      await interaction.editReply({
        content:
          "🔒 הטיקט ייסגר בעוד 5 שניות..."
      });

      setTimeout(() => {
        interaction.channel
          .delete(
            `Zone X ticket closed by ${interaction.user.tag}`
          )
          .catch(() => {});
      }, 5000);

      return;
    }

    if (interaction.customId === "start_verify") {
      const correct = String(Math.floor(1000 + Math.random() * 9000));
      const numbers = new Set([correct]);

      while (numbers.size < 4) {
        numbers.add(String(Math.floor(1000 + Math.random() * 9000)));
      }

      const shuffled = [...numbers].sort(() => Math.random() - 0.5);

      const row = new ActionRowBuilder().addComponents(
        shuffled.map(num =>
          new ButtonBuilder()
            .setCustomId(`verify:${interaction.user.id}:${correct}:${num}`)
            .setLabel(num)
            .setStyle(ButtonStyle.Secondary)
        )
      );

      return replyToInteraction(interaction, {
        content:
          `המספר שלך הוא: **${correct}**\n` +
          "תלחץ על הכפתור עם המספר הזה.",
        components: [row],
        ephemeral: true
      });
    }

    if (interaction.customId.startsWith("verify:")) {
      const [, userId, correct, picked] =
        interaction.customId.split(":");

      if (interaction.user.id !== userId) {
        return replyToInteraction(interaction, {
          content: "זה לא ה־Verify שלך 😭",
          ephemeral: true
        });
      }

      if (picked !== correct) {
        return replyToInteraction(interaction, {
          content: "לא נכון 💔 תלחץ שוב על Verify.",
          ephemeral: true
        });
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const botMember = await interaction.guild.members.fetchMe();
      const role = await interaction.guild.roles
        .fetch(config.memberRoleId)
        .catch(() => null);

      if (!role) {
        return interaction.update({
          content:
            "האימות הצליח, אבל לא מצאתי את הרול. " +
            "בדוק `memberRoleId` ב־config.js.",
          components: []
        });
      }

      if (role.managed) {
        return interaction.update({
          content:
            "האימות הצליח, אבל זה רול מנוהל שאי אפשר לתת ידנית.",
          components: []
        });
      }

      if (
        !botMember.permissions.has(PermissionFlagsBits.ManageRoles)
      ) {
        return interaction.update({
          content:
            "האימות הצליח, אבל לבוט אין `Manage Roles`.",
          components: []
        });
      }

      if (role.position >= botMember.roles.highest.position) {
        return interaction.update({
          content:
            "האימות הצליח, אבל רול הבוט נמוך מדי. " +
            "תעלה את רול הבוט מעל רול המאומת.",
          components: []
        });
      }

      try {
        await member.roles.add(
          role,
          "Zone X Verify completed"
        );
      } catch (error) {
        console.error("❌ Verify role add error:", error);

        return interaction.update({
          content:
            "האימות הצליח, אבל לא הצלחתי לתת את הרול.\n" +
            `שגיאה: \`${error.code || error.message}\``,
          components: []
        });
      }

      return interaction.update({
        content: "אומתת בהצלחה ✅ קיבלת את הרול!",
        components: []
      });
    }
  } catch (error) {
    console.error("❌ Interaction error:", error);

    const response = {
      content: "❌ הייתה שגיאה בביצוע הפעולה.",
      ephemeral: true
    };

    return replyToInteraction(interaction, response).catch(() => {});
  }
});

if (!process.env.TOKEN) {
  console.error("❌ TOKEN missing in .env");
  process.exit(1);
}

client.login(process.env.TOKEN).catch(error => {
  console.error("❌ Login error:", error);
  process.exit(1);
});
