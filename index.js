import "dotenv/config";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import cron from "node-cron";
import fs from "fs";
import { getCharacterData, getCharacterExtras, characterKey, capitalizeName, displayName, armoryUrl } from "./blizzard.js";

const BOT_TOKEN = process.env.BOT_TOKEN;

const TRACKED_PATH = "./tracked.json";
const CHECK_DELAY_MS = 1000; // pause between characters in the level check

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// Create tracked.json on startup if it doesn't exist
if (!fs.existsSync(TRACKED_PATH)) {
  fs.writeFileSync(TRACKED_PATH, "{}\n");
  console.log("Created empty tracked.json");
}

// Load tracked characters
let tracked = JSON.parse(fs.readFileSync(TRACKED_PATH, "utf8"));

// Load fun facts
const funFacts = JSON.parse(fs.readFileSync("./funFacts.json", "utf8"));

// Save helper
function saveTracked() {
  fs.writeFileSync(TRACKED_PATH, JSON.stringify(tracked, null, 2));
}

// Helper function to get a random fun fact
function getRandomFunFact() {
  return funFacts[Math.floor(Math.random() * funFacts.length)];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Stored names already use Blizzard's casing (e.g. "McGee")
function entryName(entry) {
  return `${entry.firstName} ${entry.lastName}`;
}

function getImageForRace(race, gender) {
  const raceImages = {
    Orc: {
      MALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_orc-male.png",
      FEMALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_orc-female.png",
    },
    Human: {
      MALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_human-male.png",
      FEMALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_human-female.png",
    },
    "Night Elf": {
      MALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_nightelf-male.png",
      FEMALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_nightelf-female.png",
    },
    Undead: {
      MALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_undead-male.png",
      FEMALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_undead-female.png",
    },
    Troll: {
      MALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_troll-male.png",
      FEMALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_troll-female.png",
    },
    Dwarf: {
      MALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_dwarf-male.png",
      FEMALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_dwarf-female.png",
    },
    Gnome: {
      MALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_gnome-male.png",
      FEMALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_gnome-female.png",
    },
    Tauren: {
      MALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_tauren-male.png",
      FEMALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_tauren-female.png",
    },
    "Blood Elf": {
      MALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_bloodelf-male.png",
      FEMALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_bloodelf-female.png",
    },
    Draenei: {
      MALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_draenei-male.png",
      FEMALE: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_draenei-female.png",
    },
  };

  // Unknown race (e.g. Skyborne) or gender falls back to the default image
  return raceImages[race]?.[gender] || "https://warcraft.wiki.gg/images/Ui-charactercreate-races_default.png";
}

const CLASS_IMAGES = {
  Hunter: "https://wow.zamimg.com/images/wow/icons/medium/class_hunter.jpg",
  Warrior: "https://wow.zamimg.com/images/wow/icons/medium/class_warrior.jpg",
  Mage: "https://wow.zamimg.com/images/wow/icons/medium/class_mage.jpg",
  Rogue: "https://wow.zamimg.com/images/wow/icons/medium/class_rogue.jpg",
  Priest: "https://wow.zamimg.com/images/wow/icons/medium/class_priest.jpg",
  Warlock: "https://wow.zamimg.com/images/wow/icons/medium/class_warlock.jpg",
  Paladin: "https://wow.zamimg.com/images/wow/icons/medium/class_paladin.jpg",
  Shaman: "https://wow.zamimg.com/images/wow/icons/medium/class_shaman.jpg",
  Druid: "https://wow.zamimg.com/images/wow/icons/medium/class_druid.jpg",
};

function getImageForClass(characterClass) {
  return CLASS_IMAGES[characterClass] || "https://wow.zamimg.com/images/wow/icons/medium/class_default.jpg"; // Default image if class not found
}

// -----------------------------
// Embed helpers
// -----------------------------

const formatNumber = (n) => Number(n).toLocaleString("en-US");

// "Enhancement Shaman", or just "Shaman" if the spec is unknown
function classLabel(characterClass, extras) {
  return extras?.spec ? `${extras.spec} ${characterClass}` : characterClass;
}

// Character portrait if Blizzard has one, otherwise the race image
function portraitImage(extras, race, gender) {
  return extras?.avatar || getImageForRace(race, gender);
}

// Discord renders <t:...:R> as "2 hours ago" in each viewer's own time zone
function discordRelativeTime(ms) {
  return ms ? `<t:${Math.floor(ms / 1000)}:R>` : null;
}

// WoW: Forever uses the original 1-60 XP curve. XP_TO_NEXT_LEVEL[n - 1] = XP needed to go from level n to n+1.
// (Sums to 4,084,700 for 1-60, matching published Forever XP tables.)
const XP_TO_NEXT_LEVEL = [
  400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500, 7600,
  8800, 10100, 11400, 12900, 14400, 16000, 17700, 19400, 21300, 23200,
  25200, 27300, 29400, 31700, 34000, 36400, 38900, 41400, 44300, 47400,
  50800, 54500, 58600, 62800, 67100, 71600, 76100, 80800, 85700, 90700,
  95800, 101000, 106300, 111800, 117500, 123200, 129100, 135100, 141200, 147500,
  153900, 160400, 167100, 173900, 180800, 187900, 195000, 202300, 209800,
];
const MAX_LEVEL = XP_TO_NEXT_LEVEL.length + 1; // 60

// `▰▰▰▰▱▱▱▱▱▱`
function progressBar(fraction, width = 10) {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return "`" + "▰".repeat(filled) + "▱".repeat(width - filled) + "`";
}

// "`▰▰▰▰▱▱▱▱▱▱` 42% · 4,234 / 10,100 XP", or null if we can't tell
function xpLine(level, experience) {
  if (level >= MAX_LEVEL) return "`▰▰▰▰▰▰▰▰▰▰` Max level";
  const needed = XP_TO_NEXT_LEVEL[level - 1];
  if (!needed || experience == null) return null;
  const fraction = Math.min(experience / needed, 1);
  return `${progressBar(fraction)} ${Math.floor(fraction * 100)}% · ${formatNumber(experience)} / ${formatNumber(needed)} XP`;
}

// The tooltip-style header:
//   **Level 12 Enhancement Shaman**
//   Orc · Horde · Normal · iLvl 4
//   `▰▰▰▰▱▱▱▱▱▱` 42% · 4,234 / 10,100 XP
function characterSheet(data, extras, { showLevel = true, lastLogin = null } = {}) {
  const headline = showLevel
    ? `**Level ${data.level} ${classLabel(data.characterClass, extras)}**`
    : `**${classLabel(data.characterClass, extras)}**`;
  const facts = [data.race, data.faction, data.ruleset, `iLvl ${data.equippedItemLevel ?? 0}`].filter(Boolean).join(" · ");
  const xp = xpLine(data.level, data.experience);
  const seen = lastLogin ? `🕒 Last seen ${discordRelativeTime(lastLogin)}` : null;
  return [headline, facts, xp, seen].filter(Boolean).join("\n");
}

// "Mining `▰▰▰▰▱▱▱▱` 39/75" per line (primary professions only)
function professionsBlock(extras) {
  return (extras?.professions || [])
    .filter((p) => p.primary)
    .map((p) =>
      p.skill != null && p.max
        ? `${p.name} ${progressBar(p.skill / p.max, 8)} ${p.skill}/${p.max}`
        : p.name
    )
    .join("\n");
}

// Professions section under the sheet
function addDetailFields(embed, extras) {
  const professions = professionsBlock(extras);
  if (professions) embed.addFields({ name: "Professions", value: professions, inline: false });
  return embed;
}

// Small class icon + class name shown above the title, like a class badge
function withClassAuthor(embed, data) {
  const iconURL = CLASS_IMAGES[data.characterClass];
  return embed.setAuthor(iconURL ? { name: data.characterClass, iconURL } : { name: data.characterClass });
}

const armoryLink = (first, last) => `🔗 [View on Armory](${armoryUrl(first, last)})`;

function buildLevelUpEmbed(entry, fromLevel, toLevel, data, extras) {
  const name = entryName(entry);
  const sheet = characterSheet({ ...data, level: toLevel, faction: data.faction || entry.faction, ruleset: data.ruleset || entry.ruleset }, extras, { showLevel: false });
  const embed = new EmbedBuilder()
    .setTitle(`🎉 Level Up!`)
    .setURL(armoryUrl(entry.firstName, entry.lastName)) // Title links to the armory
    .setColor(0xffa500) // Orange color for the embed
    .setDescription(`🔥 **${name}** leveled up! **${fromLevel} → ${toLevel}**\n\n${sheet}`)
    .setThumbnail(portraitImage(extras, data.race, data.gender)) // Classic character portrait (or race image)
    .setFooter({ text: getRandomFunFact() }) // Add a random fun fact in the footer
    .setTimestamp();

  withClassAuthor(embed, data, extras);
  return addDetailFields(embed, extras);
}

// -----------------------------
// Command parsing
// -----------------------------

// "!Track  Cold Potato" -> { command: "track", args: "Cold Potato" }
// The command word is matched exactly (case-insensitive), so "!trackfoo" is not "!track".
function parseCommand(content) {
  const match = content.trim().match(/^!(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: (match[2] || "").trim() };
}

// "Cold Potato" -> { first: "cold", last: "potato" }, or null if not exactly two words.
function parseName(text) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2) return null;
  return { first: parts[0], last: parts[1] };
}

// Why a 404 happens, in plain words (shared by !check and !track)
const NOT_FOUND_EXPLAINER =
  "This usually isn't a bot problem: Blizzard's WoW: Forever profiles are still filling in.";

function notFoundMessage(name) {
  return `🔍 Blizzard's API doesn't have **${name}** yet.\n${NOT_FOUND_EXPLAINER}`;
}

function buildTrackedEntry(first, last, characterData, channelId) {
  const { level, race, characterClass, equippedItemLevel, gender, ruleset } = characterData;
  return {
    firstName: characterData.firstName, // Blizzard's casing (e.g. "McGee")
    lastName: characterData.lastName,
    ruleset, // null if Blizzard didn't return one
    faction: characterData.faction || null,
    lastLevel: level,
    race,
    characterClass,
    equippedItemLevel,
    gender,
    lastChecked: new Date().toISOString(),
    channelId,
  };
}

// A character Blizzard doesn't have yet (404). The level check keeps looking for them,
// and starts tracking for real (with the usual "Tracking Started" embed) once they show up.
function buildPendingEntry(first, last, channelId) {
  return {
    firstName: capitalizeName(first),
    lastName: capitalizeName(last),
    pending: true,
    addedAt: new Date().toISOString(),
    lastChecked: new Date().toISOString(),
    channelId,
  };
}

function pendingMessage(name) {
  return `⏳ Blizzard's API doesn't have **${name}** yet, so I've saved them as **pending**.\n` +
    `${NOT_FOUND_EXPLAINER}\n` +
    `I'll keep checking every 10 minutes and post **🎯 Tracking Started** here as soon as they show up. ` +
    `Use \`!untrack ${name}\` to cancel.`;
}

function buildTrackingStartedEmbed(characterData, extras) {
  const { firstName: first, lastName: last, race, gender } = characterData;
  const embed = new EmbedBuilder()
    .setTitle(`🎯 Tracking Started for ${first} ${last}`)
    .setURL(armoryUrl(first, last)) // Title links to the armory
    .setColor(0x00ff00) // Green color for success
    .setDescription(characterSheet(characterData, extras, { lastLogin: characterData.lastLogin }))
    .setThumbnail(portraitImage(extras, race, gender)) // Classic character portrait (or race image)
    .setFooter({ text: "Tracking updates will be announced in this channel." });

  withClassAuthor(embed, characterData, extras);
  addDetailFields(embed, extras);
  embed.addFields({ name: "\u200b", value: armoryLink(first, last), inline: false }); // armory link at the bottom
  return embed;
}

// -----------------------------
// Command handlers
// -----------------------------

async function handleListNames(msg) {
  if (Object.keys(tracked).length === 0) {
    msg.reply("No characters are currently being tracked.");
    return;
  }

  let response = "**Tracked Characters:**\n";

  for (const key in tracked) {
    const entry = tracked[key];
    response += entry.pending
      ? `• **${entryName(entry)}** (⏳ waiting for Blizzard's API)\n`
      : `• **${entryName(entry)}** (Level: ${entry.lastLevel}, Class: ${entry.characterClass})\n`;
  }

  // Discord messages have a character limit of 2000, so split the response if necessary
  if (response.length > 2000) {
    const chunks = response.match(/[\s\S]{1,1999}/g); // Split into chunks of 1999 characters
    for (const chunk of chunks) {
      await msg.reply(chunk);
    }
  } else {
    msg.reply(response);
  }
}

async function handleListTracks(msg) {
  if (Object.keys(tracked).length === 0) {
    msg.reply("No characters are currently being tracked.");
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Currently Tracked Characters")
    .setColor(0x00ae86) // Set a nice blue color for the embed
    .setDescription("Here are the characters being tracked:");

  for (const key in tracked) {
    const entry = tracked[key];
    const lastChecked = entry.lastChecked
      ? new Date(entry.lastChecked).toLocaleString()
      : "Unknown";

    if (entry.pending) {
      embed.addFields({
        name: `**${entryName(entry)}** (⏳ Pending)`,
        value: `• Not in Blizzard's API yet. Checking every 10 minutes.\n• **Last Checked:** ${lastChecked}\n• **Announcing in:** <#${entry.channelId}>`,
        inline: false,
      });
      continue;
    }

    embed.addFields({
      name: entry.ruleset ? `**${entryName(entry)}** (Ruleset: ${entry.ruleset})` : `**${entryName(entry)}**`,
      value: `• **Level:** ${entry.lastLevel}\n• **Race:** ${entry.race}\n• **Class:** ${entry.characterClass}\n• **Last Checked:** ${lastChecked}\n• **Announcing in:** <#${entry.channelId}>`,
      inline: false,
    });
  }

  msg.reply({ embeds: [embed] });
}

async function handleCheck(msg, args) {
  const parsed = parseName(args);
  if (!parsed) {
    msg.reply("Usage: !check [first name] [last name]");
    return;
  }

  const { first, last } = parsed;
  const typedName = displayName(first, last);
  const characterData = await getCharacterData(first, last);

  if (characterData.notFound) {
    msg.reply(notFoundMessage(typedName));
    return;
  }
  if (!characterData.ok) {
    msg.reply(`Could not fetch data for **${typedName}**. Please try again later.`);
    return;
  }

  const { level, race, characterClass, equippedItemLevel, gender, ruleset } = characterData;
  const name = `${characterData.firstName} ${characterData.lastName}`;
  const extras = await getCharacterExtras(characterData);
  const checkedAt = new Date().toISOString();

  // Only update tracked.json if this character is tracked
  const trackedCharacter = tracked[characterKey(first, last)];
  if (trackedCharacter) {
    delete trackedCharacter.pending; // found now
    delete trackedCharacter.addedAt;
    trackedCharacter.lastLevel = level;
    trackedCharacter.race = race;
    trackedCharacter.characterClass = characterClass;
    trackedCharacter.equippedItemLevel = equippedItemLevel;
    trackedCharacter.gender = gender;
    if (ruleset) trackedCharacter.ruleset = ruleset;
    if (characterData.faction) trackedCharacter.faction = characterData.faction;
    trackedCharacter.firstName = characterData.firstName;
    trackedCharacter.lastName = characterData.lastName;
    trackedCharacter.lastChecked = checkedAt;
    saveTracked();
  }

  const embed = new EmbedBuilder()
    .setTitle(`Stats for ${name}`)
    .setURL(armoryUrl(first, last)) // Title links to the armory
    .setColor(0x00ae86) // Set a nice blue color for the embed
    .setDescription(characterSheet(characterData, extras, { lastLogin: characterData.lastLogin }))
    .setThumbnail(portraitImage(extras, race, gender)) // Classic character portrait (or race image)
    .setFooter({ text: "Character stats retrieved successfully." })
    .setTimestamp(new Date(checkedAt));

  withClassAuthor(embed, characterData, extras);
  addDetailFields(embed, extras);
  embed.addFields({ name: "\u200b", value: armoryLink(first, last), inline: false }); // armory link at the bottom

  msg.reply({ embeds: [embed] });
}

async function handleTrack(msg, args) {
  const parsed = parseName(args);
  if (!parsed) {
    msg.reply("Usage: !track [first name] [last name]");
    return;
  }

  const { first, last } = parsed;
  const characterData = await getCharacterData(first, last);

  const key = characterKey(first, last);

  if (characterData.notFound) {
    const existing = tracked[key];
    if (existing && !existing.pending) {
      // Already tracked for real; a 404 now is probably a Blizzard hiccup, so leave it alone
      msg.reply(`**${entryName(existing)}** is already being tracked (Blizzard's API returned 404 just now; I'll keep checking).`);
      return;
    }
    tracked[key] = buildPendingEntry(first, last, msg.channel.id);
    saveTracked();
    msg.reply(pendingMessage(displayName(first, last)));
    return;
  }
  if (!characterData.ok) {
    msg.reply("Could not fetch character. Check spelling or try again.");
    return;
  }

  const extras = await getCharacterExtras(characterData);
  tracked[key] = buildTrackedEntry(first, last, characterData, msg.channel.id);
  saveTracked();

  msg.reply({ embeds: [buildTrackingStartedEmbed(characterData, extras)] });
}

async function handleBulkTrack(msg, args, usedCommand) {
  if (!args) {
    msg.reply(`Usage: !${usedCommand} [first name] [last name], [first name] [last name], ...`);
    return;
  }

  // Split the input into individual "first last" names
  const names = args.split(",").map((n) => n.trim()).filter(Boolean);
  let successCount = 0;
  let pendingCount = 0;

  for (const [i, raw] of names.entries()) {
    if (i > 0) await sleep(CHECK_DELAY_MS);

    const parsed = parseName(raw);
    if (!parsed) {
      msg.reply(`Invalid format for: "${raw}". Expected [first name] [last name]. Skipping.`);
      continue;
    }

    const { first, last } = parsed;
    const name = displayName(first, last);
    const characterData = await getCharacterData(first, last);

    if (characterData.notFound) {
      const key = characterKey(first, last);
      if (!tracked[key] || tracked[key].pending) {
        tracked[key] = buildPendingEntry(first, last, msg.channel.id);
        pendingCount++;
      }
      continue;
    }
    if (!characterData.ok) {
      msg.reply(`Could not fetch character: **${name}**. Skipping.`);
      continue;
    }

    tracked[characterKey(first, last)] = buildTrackedEntry(first, last, characterData, msg.channel.id);
    successCount++;
  }

  saveTracked();

  msg.reply(
    `✅ Successfully tracked **${successCount}** characters!` +
    (pendingCount ? `\n⏳ **${pendingCount}** aren't in Blizzard's API yet. I'll start tracking them here once they show up.` : "")
  );
}

async function handleUntrack(msg, args) {
  const parsed = parseName(args);
  if (!parsed) {
    msg.reply("Usage: !untrack [first name] [last name]");
    return;
  }

  const key = characterKey(parsed.first, parsed.last);
  const entry = tracked[key];

  if (!entry) {
    msg.reply(`Character **${displayName(parsed.first, parsed.last)}** is not being tracked.`);
    return;
  }

  delete tracked[key];
  saveTracked();

  msg.reply(`✅ Stopped tracking **${entryName(entry)}**.`);
}

async function handleDebugLevelUp(msg, args) {
  const parsed = parseName(args);
  if (!parsed) {
    msg.reply("Usage: !debugLevelUp [first name] [last name]");
    return;
  }

  const trackedCharacter = tracked[characterKey(parsed.first, parsed.last)];

  if (!trackedCharacter) {
    msg.reply(`Character **${displayName(parsed.first, parsed.last)}** is not being tracked.`);
    return;
  }

  if (trackedCharacter.pending) {
    msg.reply(`**${entryName(trackedCharacter)}** isn't in Blizzard's API yet, so there's nothing to level up. Try again once tracking starts.`);
    return;
  }

  const { lastLevel } = trackedCharacter;

  // Simulate a level-up for debugging, using live data when available so the preview matches the real thing
  const newLevel = lastLevel + 1; // Increment the level for testing
  const live = await getCharacterData(trackedCharacter.firstName, trackedCharacter.lastName);
  const data = live.ok ? live : trackedCharacter;
  const extras = live.ok ? await getCharacterExtras(live) : null;

  const embed = buildLevelUpEmbed(trackedCharacter, lastLevel, newLevel, data, extras);

  // Send the debug message to the channel where the command was issued
  msg.reply({ embeds: [embed] });
}

async function handleHelp(msg) {
  const embed = new EmbedBuilder()
    .setTitle("Ding Bot Commands")
    .setColor(0x00ae86) // Same blue as !check / !listtracks
    .setDescription("Characters are looked up by **first and last name**, e.g. `Windslap Mcgee`. Commands aren't case-sensitive.")
    .addFields(
      { name: "`!track <first> <last>`", value: "Start tracking a character. Level-ups are announced in this channel.", inline: false },
      { name: "`!untrack <first> <last>`", value: "Stop tracking a character.", inline: false },
      { name: "`!check <first> <last>`", value: "Show a character's stats. Works for anyone, tracked or not.", inline: false },
      { name: "`!bulkTrack <first> <last>, <first> <last>, ...`", value: "Track several characters at once (`!batchTrack` works too).", inline: false },
      { name: "`!listtracks`", value: "Tracked characters with details.", inline: false },
      { name: "`!listnames`", value: "Tracked characters as a short list.", inline: false },
      { name: "`!hardrefresh`", value: "Run the level-up check now instead of waiting for the next 10-minute check.", inline: false },
      { name: "`!debugLevelUp <first> <last>`", value: "Preview a level-up announcement for a tracked character.", inline: false },
      { name: "`!help`", value: "Show this list.", inline: false }
    )
    .setFooter({ text: "Characters Blizzard doesn't have yet are kept as pending and tracked once they show up." });

  msg.reply({ embeds: [embed] });
}

async function handleHardRefresh(msg) {
  if (isChecking) {
    msg.reply("⏳ A level check is already running. Try again in a moment.");
    return;
  }
  msg.reply("🔄 Running a manual refresh of the hourly level check...");
  await runHourlyCheck();
  msg.reply("✅ Manual refresh complete!");
}

// Discord bot commands
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const parsed = parseCommand(msg.content);
  if (!parsed) return;
  const { command, args } = parsed;

  try {
    switch (command) {
      case "listnames":
        await handleListNames(msg);
        break;
      case "listtracks":
        await handleListTracks(msg);
        break;
      case "check":
        await handleCheck(msg, args);
        break;
      case "track":
        await handleTrack(msg, args);
        break;
      case "bulktrack":
      case "batchtrack":
        await handleBulkTrack(msg, args, command === "batchtrack" ? "batchTrack" : "bulkTrack");
        break;
      case "untrack":
        await handleUntrack(msg, args);
        break;
      case "debuglevelup":
        await handleDebugLevelUp(msg, args);
        break;
      case "hardrefresh":
        await handleHardRefresh(msg);
        break;
      case "help":
      case "commands":
        await handleHelp(msg);
        break;
      default:
        break; // not one of ours
    }
  } catch (err) {
    console.error(`Error handling !${command}:`, err);
  }
});

// Cron job: runs every 10 minutes
cron.schedule("*/10 * * * *", async () => {
  console.log("Running WoW level check every 10 minutes...");
  await runHourlyCheck();
});

let isChecking = false;

async function runHourlyCheck() {
  if (isChecking) {
    console.log(`[${new Date().toISOString()}] Level check already running. Skipping this run.`);
    return;
  }
  isChecking = true;
  console.log(`[${new Date().toISOString()}] Starting WoW level check...`);

  try {
    // Snapshot keys so !track / !untrack during the run don't break iteration
    const keys = Object.keys(tracked);

    for (const [i, key] of keys.entries()) {
      if (i > 0) await sleep(CHECK_DELAY_MS);

      const entry = tracked[key];
      if (!entry) continue; // untracked mid-run
      const name = entryName(entry);

      try {
        console.log(`[${new Date().toISOString()}] Checking character: ${name}`);

        const characterData = await getCharacterData(entry.firstName, entry.lastName);

        if (!characterData.ok) {
          const reason = characterData.notFound ? "not found (404)" : "fetch failed";
          console.log(`[${new Date().toISOString()}] ${name}: ${reason}. Skipping.`);
          entry.lastChecked = new Date().toISOString();
          continue;
        }

        // A pending character finally showed up: start tracking for real and announce it
        if (entry.pending) {
          console.log(`[${new Date().toISOString()}] ${name} is now in Blizzard's API. Starting tracking.`);
          const extras = await getCharacterExtras(characterData);
          tracked[key] = buildTrackedEntry(entry.firstName, entry.lastName, characterData, entry.channelId);
          const channel = await client.channels.fetch(entry.channelId);
          await channel.send({ embeds: [buildTrackingStartedEmbed(characterData, extras)] });
          continue;
        }

        const { level: newLevel, equippedItemLevel, gender, ruleset, race, characterClass } = characterData;

        // Forever profiles fill in over time, so pick up newly-available fields
        if (ruleset) entry.ruleset = ruleset;
        if (characterData.faction) entry.faction = characterData.faction;
        if (race !== "Unknown Race") entry.race = race;
        if (characterClass !== "Unknown Class") entry.characterClass = characterClass;

        if (newLevel > entry.lastLevel) {
          console.log(`[${new Date().toISOString()}] Level up detected for ${name}: ${entry.lastLevel} → ${newLevel}`);
          const channel = await client.channels.fetch(entry.channelId);

          // Extra endpoints are only fetched on a level-up, to keep the 10-minute check light
          const extras = await getCharacterExtras(characterData);
          const embed = buildLevelUpEmbed(entry, entry.lastLevel, newLevel, characterData, extras);

          await channel.send({ embeds: [embed] });

          entry.lastLevel = newLevel;
        } else {
          console.log(`[${new Date().toISOString()}] No level up for ${name}.`);
        }

        entry.equippedItemLevel = equippedItemLevel;
        entry.gender = gender;
        entry.lastChecked = new Date().toISOString();
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Error checking ${name}:`, err);
      }
    }

    console.log(`[${new Date().toISOString()}] Finished WoW level check.`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] An error occurred during the WoW level check:`, err);
  } finally {
    saveTracked(); // once per run
    isChecking = false;
  }
}

// Login the bot
client.login(BOT_TOKEN);
