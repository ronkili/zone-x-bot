module.exports = {
  clientId: "1545332033734311966",
  guildId: "1508751366690967664",

  // רול שמקבלים אחרי Verify
  memberRoleId: "1508813260412027063",

  // רול צוות שמורשה להשתמש בפקודות מודרציה
  staffRoleId: "1508813254074564761",

  // רול יחיד שמורשה להשתמש ב:
  // /timeout /untimeout /kick /ban
  punishmentRoleId: "1545733059947528313",

  // רול Chat Mute
  muteRoleId: "1508813281660370954",

  // חדר לוגים למודרציה
  // אפשר להשאיר "" אם לא רוצים לוגים
  modLogsChannelId: "1508813300253720717",

  // =====================
  // TICKETS
  // =====================

  // הקטגוריה שבה ייפתחו הטיקטים
  ticketCategoryId: "1545339458176684143",

  // רול הצוות שמטפל בכל הטיקטים הרגילים
  ticketStaffRoleId: "1508813254074564761",

  // רול נפרד שרק הוא רואה ומטפל בטיקט "בחינה לצוות"
  staffTestTicketRoleId: "1508813258004627557",

  // חדר שאליו נשלחים לוג סגירה + Transcript
  ticketLogsChannelId: "1508813298076745810",

  // =====================
  // XP + SHOP
  // =====================

  // Prefix של מערכת ה־XP והמשחקים
  xpPrefix: "!",

  // XP שמקבלים על הודעה רגילה
  xpPerMessageMin: 5,
  xpPerMessageMax: 15,

  // כמה זמן צריך לחכות בין קבלת XP מהודעות
  xpMessageCooldownMs: 60 * 1000,

  // מקסימום XP שאפשר לשים במשחק מזל אחד
  maxCasinoBet: 1000,

  // Cooldown בין משחקי מזל
  casinoCooldownMs: 5 * 1000,

  // רולים שאפשר לקנות עם XP
  // key = מה שכותבים אחרי !buy
  xpShop: [
    {
      key: "supporter",
      name: "Zone X Supporter",
      emoji: "💙",
      price: 2500,
      roleId: "1545456740164829234"
    },
    {
      key: "elite",
      name: "Zone X Elite",
      emoji: "💎",
      price: 5000,
      roleId: "1545457055140155476"
    },
    {
      key: "legend",
      name: "Zone X Legend",
      emoji: "👑",
      price: 10000,
      roleId: "1545457287932416161"
    }
  ]
};
