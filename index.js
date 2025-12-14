import "dotenv/config";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js"; // Import EmbedBuilder for creating embeds
import axios from "axios";
import * as cheerio from "cheerio";
import cron from "node-cron";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Load tracked characters
let tracked = JSON.parse(fs.readFileSync("./tracked.json", "utf8"));

// Save helper
function saveTracked() {
  fs.writeFileSync("./tracked.json", JSON.stringify(tracked, null, 2));
}

// Scrape character level
async function getCharacterLevel(server, name) {
  try {
    const url = `https://classicwowarmory.com/character/us/${server}/${name}`;
    console.log(`Fetching character data from: ${url}`); // Log the URL being fetched
    const res = await axios.get(url, {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
    console.log(`Response status: ${res.status}`);
    // console.log(`Response data: ${res.data}`);
    const $ = cheerio.load(res.data);

    // Find any text that contains "Level"
    const levelSpan = $('span.bold')
      .filter((i, el) => $(el).text().includes("Level"))
      .first();

    if (!levelSpan.length) {
      console.log(`No level element found for ${name} on ${server}`);
      return null;
    }

    const text = levelSpan.text().trim(); // "Level 28"
    const level = parseInt(text.replace("Level", "").trim(), 10);

    if (isNaN(level)) {
      console.log(`Failed to extract numeric level for ${name} on ${server}`);
      return null;
    }

    console.log(`Found level for ${name} on ${server}: ${level}`); // Log the extracted level

    // Extract race and class
    const race = $(".extra span:nth-child(2)").text().trim(); // "Orc"
    const characterClass = $(".extra span.class-colors").text().trim(); // "Hunter"

    if (!race || !characterClass) {
      console.log(`Failed to extract race or class for ${name} on ${server}`);
      return null;
    }

    console.log(`Fetched data for ${name}: Level ${level}, Race ${race}, Class ${characterClass}`);
    return { level, race, characterClass };
  } catch (err) {
    console.error(`Error fetching character data for ${name} on ${server}:`, err);
    return null;
  }
}

function getImageForRace(race) {
  const raceImages = {
    Orc: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_orc-male.png",
    Human: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_human-male.png",
    NightElf: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_nightelf-male.png",
    Undead: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_undead-male.png",
    Troll: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_troll-male.png",
    Dwarf: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_dwarf-male.png",
    Gnome: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_gnome-male.png",
    Tauren: "https://warcraft.wiki.gg/images/Ui-charactercreate-races_tauren-male.png",
  };

  return raceImages[race] || "https://warcraft.wiki.gg/images/Ui-charactercreate-races_default.png"; // Default image if race not found
}

function getImageForClass(characterClass) {
  const classImages = {
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

  return classImages[characterClass] || "https://wow.zamimg.com/images/wow/icons/medium/class_default.jpg"; // Default image if class not found
}

client.on("messageCreate", async (msg) => {
  // -----------------------------
  // !listnames command
  // -----------------------------
  if (msg.content === "!listnames") {
    if (Object.keys(tracked).length === 0) {
      msg.reply("No characters are currently being tracked.");
      return;
    }

    let response = "**Tracked Characters:**\n";

    for (const key in tracked) {
      const entry = tracked[key];
      response += `• **${entry.name}** (Level: ${entry.lastLevel}, Class: ${entry.characterClass})\n`;
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

  // -----------------------------
  // !listtracks command
  // -----------------------------
  if (msg.content === "!listtracks") {
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

      embed.addFields({
        name: `**${entry.name}** (Server: ${entry.server})`,
        value: `• **Level:** ${entry.lastLevel}\n• **Race:** ${entry.race}\n• **Class:** ${entry.characterClass}\n• **Last Checked:** ${lastChecked}\n• **Announcing in:** <#${entry.channelId}>`,
        inline: false,
      });
    }

    msg.reply({ embeds: [embed] });
    return;
  }

  // -----------------------------
  // !check command
  // -----------------------------
  if (msg.content.startsWith("!check")) {
    const parts = msg.content.split(" ");
    if (parts.length < 2) {
      msg.reply("Usage: !check [characterName]");
      return;
    }

    const name = parts[1].toLowerCase();

    // Find the character in the tracked list
    const trackedCharacter = Object.values(tracked).find(
      (entry) => entry.name.toLowerCase() === name
    );

    if (!trackedCharacter) {
      msg.reply(`Character **${name}** is not being tracked.`);
      return;
    }

    const { server, lastLevel, race, characterClass, lastChecked } = trackedCharacter;

    const embed = new EmbedBuilder()
      .setTitle(`Stats for ${trackedCharacter.name}`)
      .setColor(0x00ae86) // Set a nice blue color for the embed
      .setDescription(
        `• **Server:** ${server}\n• **Level:** ${lastLevel}\n• **Race:** ${race}\n• **Class:** ${characterClass}\n• **Last Checked:** ${
          lastChecked ? new Date(lastChecked).toLocaleString() : "Unknown"
        }`
      )
      .setThumbnail(getImageForRace(race)) // Add race image
      .setImage(getImageForClass(characterClass)) // Add class image
      .setFooter({ text: "Character stats retrieved successfully." });

    msg.reply({ embeds: [embed] });
    return;
  }

  // -----------------------------
  // !track command
  // -----------------------------
  if (!msg.content.startsWith("!track")) return;

  const parts = msg.content.split(" ");
  if (parts.length < 3) {
    msg.reply("Usage: !track [characterName] [serverName]");
    return;
  }

  const name = parts[1].toLowerCase();
  const server = parts[2].toLowerCase();

  const characterData = await getCharacterLevel(server, name);

  if (!characterData) {
    msg.reply("Could not fetch character. Check spelling or try again.");
    return;
  }

  const { level, race, characterClass } = characterData;

  tracked[`${server}-${name}`] = {
    server,
    name,
    lastLevel: level,
    race,
    characterClass,
    lastChecked: new Date().toISOString(),
    channelId: msg.channel.id,
  };

  saveTracked();

  const embed = new EmbedBuilder()
    .setTitle(`🎯 Tracking Started for ${name}`)
    .setColor(0x00ff00) // Green color for success
    .setDescription(
      `Tracking **${name}** on **${server}**:\n` +
      `• **Level:** ${level}\n` +
      `• **Race:** ${race}\n` +
      `• **Class:** ${characterClass}`
    )
    .setThumbnail(getImageForClass(characterClass)) // Class image as the thumbnail
    .setImage(getImageForRace(race)) // Race image as the main image
    .setFooter({ text: "Tracking updates will be announced in this channel." });

  msg.reply({ embeds: [embed] });
});

client.on("messageCreate", async (msg) => {
  // -----------------------------
  // !batchTrack command
  // -----------------------------
  if (msg.content.startsWith("!batchTrack")) {
    const input = msg.content.replace("!batchTrack", "").trim();

    if (!input) {
      msg.reply("Usage: !batchTrack [character name] [server name], [character name] [server name], ...");
      return;
    }

    // Split the input into individual character-server pairs
    const pairs = input.split(",").map(pair => pair.trim());
    let successCount = 0;

    for (const pair of pairs) {
      const parts = pair.split(" ");
      if (parts.length < 2) {
        msg.reply(`Invalid format for: "${pair}". Skipping.`);
        continue;
      }

      const name = parts[0].toLowerCase();
      const server = parts.slice(1).join(" ").toLowerCase();

      const characterData = await getCharacterLevel(server, name);

      if (!characterData) {
        msg.reply(`Could not fetch character: **${name}** on **${server}**. Skipping.`);
        continue;
      }

      const { level, race, characterClass } = characterData;

      tracked[`${server}-${name}`] = {
        server,
        name,
        lastLevel: level,
        race,
        characterClass,
        lastChecked: new Date().toISOString(),
        channelId: msg.channel.id,
      };

      successCount++;
    }

    saveTracked();

    msg.reply(`✅ Successfully tracked **${successCount}** characters!`);
  }

  // -----------------------------
  // !debugLevelUp command
  // -----------------------------
  if (msg.content.startsWith("!debugLevelUp")) {
    const parts = msg.content.split(" ");
    if (parts.length < 2) {
      msg.reply("Usage: !debugLevelUp [characterName]");
      return;
    }

    const name = parts[1].toLowerCase();

    // Find the character in the tracked list
    const trackedCharacter = Object.values(tracked).find(
      (entry) => entry.name.toLowerCase() === name
    );

    if (!trackedCharacter) {
      msg.reply(`Character **${name}** is not being tracked.`);
      return;
    }

    const { server, lastLevel, race, characterClass, channelId } = trackedCharacter;

    // Simulate a level-up for debugging
    const newLevel = lastLevel + 1; // Increment the level for testing

    const embed = new EmbedBuilder()
      .setTitle(`🎉 Level Up!`)
      .setColor(0xffa500) // Orange color for the embed
      .setDescription(
        `🔥 **${trackedCharacter.name}** leveled up! **${lastLevel} → ${newLevel}**\n` +
        `• **Race:** ${race}\n` +
        `• **Class:** ${characterClass}`
      )
      .setThumbnail(getImageForRace(race)) // Add race image
      .setImage(getImageForClass(characterClass)) // Add class image
      .setFooter({ text: "This is a debug message. No actual level-up occurred." });

    // Send the debug message to the channel where the command was issued
    msg.reply({ embeds: [embed] });
  }

  // -----------------------------
  // !hardrefresh command
  // -----------------------------
  if (msg.content === "!hardrefresh") {
    msg.reply("🔄 Running a manual refresh of the hourly level check...");
    await runHourlyCheck();
    msg.reply("✅ Manual refresh complete!");
  }

  // -----------------------------
  // Other commands (e.g., !track, !check)
  // -----------------------------
  // Existing code for other commands...
});

// Cron job: runs every hour on the hour
cron.schedule("0 * * * *", async () => {
  console.log("Running hourly WoW level check...");
  await runHourlyCheck();
});

// Cron job: runs every 15 minutes
cron.schedule("*/15 * * * *", async () => {
  console.log("Running WoW level check every 15 minutes...");
  await runHourlyCheck();
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runHourlyCheck() {
  console.log("Running WoW level check...");

  for (const key in tracked) {
    const entry = tracked[key];
    console.log(`Checking character: ${entry.name} on ${entry.server}`);

    const newLevel = await getCharacterLevel(entry.server, entry.name);

    if (newLevel === null) {
      console.log(`Failed to fetch level for ${entry.name}. Skipping.`);
      continue;
    }

    console.log("new level", newLevel.level, "last level", entry.lastLevel);
    if (newLevel.level > entry.lastLevel) {
      console.log(`Level up detected for ${entry.name}: ${entry.lastLevel} → ${newLevel.level}`);
      const channel = await client.channels.fetch(entry.channelId);

      const embed = new EmbedBuilder()
        .setTitle(`🎉 Level Up!`)
        .setColor(0xffa500)
        .setDescription(
          `🔥 **${entry.name}** leveled up! **${entry.lastLevel} → ${newLevel.level}**\n` +
          `• **Race:** ${entry.race}\n` +
          `• **Class:** ${entry.characterClass}`
        )
        .setThumbnail(getImageForRace(entry.race))
        .setImage(getImageForClass(entry.characterClass))
        .setFooter({ text: "Keep up the grind!" });

      channel.send({ embeds: [embed] });

      entry.lastLevel = newLevel.level;
      entry.lastChecked = new Date().toISOString();
      saveTracked();
    } else {
      console.log(`No level up for ${entry.name}.`);
      entry.lastChecked = new Date().toISOString();
      saveTracked();
    }

    // Add a delay between requests
    await delay(2000); // 2 seconds
  }
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(BOT_TOKEN);
