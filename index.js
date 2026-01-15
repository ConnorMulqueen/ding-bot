import "dotenv/config";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import axios from "axios";
import cron from "node-cron";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_CLIENT_ID = process.env.API_CLIENT_ID;
const API_CLIENT_SECRET = process.env.API_CLIENT_SECRET;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// Load tracked characters
let tracked = JSON.parse(fs.readFileSync("./tracked.json", "utf8"));

// Load fun facts
const funFacts = JSON.parse(fs.readFileSync("./funFacts.json", "utf8"));

// Save helper
function saveTracked() {
  fs.writeFileSync("./tracked.json", JSON.stringify(tracked, null, 2));
}

// Helper function to get a random fun fact
function getRandomFunFact() {
  return funFacts[Math.floor(Math.random() * funFacts.length)];
}

// Fetch Blizzard API access token
let blizzardAccessToken = null;

async function fetchBlizzardAccessToken() {
  try {
    const response = await axios.post(
      "https://us.battle.net/oauth/token",
      new URLSearchParams({
        grant_type: "client_credentials",
      }),
      {
        auth: {
          username: API_CLIENT_ID,
          password: API_CLIENT_SECRET,
        },
      }
    );

    blizzardAccessToken = response.data.access_token;
    console.log("Blizzard API access token fetched successfully.");
  } catch (err) {
    console.error("Failed to fetch Blizzard API access token:", err.response?.data || err.message);
  }
}

// Fetch character data from Blizzard API
async function getCharacterData(server, name) {
  try {
    if (!blizzardAccessToken) {
      console.error("Blizzard API access token is missing. Fetching a new token...");
      await fetchBlizzardAccessToken();
    }
    let namespace;
    if (server === "dreamscythe") {
      namespace = "profile-classic-us";
    } else if (server === "doomhowl") {
      namespace = "profile-classic1x-us";
    } else {
      namespace = "profile-classic-us"; // Default namespace
    }

    const url = `https://us.api.blizzard.com/profile/wow/character/${server}/${name}?namespace=${namespace}`;
    console.log(`Fetching character data from: ${url}`);

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${blizzardAccessToken}`,
      },
    });

    const { level, race, character_class: characterClass, equipped_item_level: equippedItemLevel, gender } = response.data;

    // Extract the `name` property from `race` and `character_class`
    const raceName = race?.name.en_US || "Unknown Race";
    const className = characterClass?.name.en_US || "Unknown Class";
    const genderType = gender?.type || "MALE"; // Default to MALE if not provided

    console.log(
      `Fetched data for ${name}: Level ${level}, Race ${raceName}, Class ${className}, Gender ${genderType}, Equipped Item Level ${equippedItemLevel}`
    );

    return {
      level,
      race: raceName, // Extracted race name
      characterClass: className, // Extracted class name
      equippedItemLevel: equippedItemLevel || 0, // Default to 0 if not available
      gender: genderType, // Extracted gender
    };
  } catch (err) {
    if (err.response?.status === 401) {
      console.error("Blizzard API token expired. Fetching a new token...");
      await fetchBlizzardAccessToken();
      return await getCharacterData(server, name); // Retry after refreshing the token
    }

    console.error(`Failed to fetch character data for ${name} on ${server}:`, err.response?.data || err.message);
    return null;
  }
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

  // Default to male image if gender or race is not found
  return raceImages[race]?.[gender] || "https://warcraft.wiki.gg/images/Ui-charactercreate-races_default.png";
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

// Discord bot commands and cron job
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

    const characterData = await getCharacterData(trackedCharacter.server, trackedCharacter.name);

    if (!characterData) {
      msg.reply(`Could not fetch data for **${name}**. Please try again later.`);
      return;
    }

    const { level, race, characterClass, equippedItemLevel, gender } = characterData;

    // Update the tracked data with the latest gender and other fields
    trackedCharacter.lastLevel = level;
    trackedCharacter.race = race;
    trackedCharacter.characterClass = characterClass;
    trackedCharacter.equippedItemLevel = equippedItemLevel;
    trackedCharacter.gender = gender; // Update the gender
    trackedCharacter.lastChecked = new Date().toISOString();
    saveTracked();

    const embed = new EmbedBuilder()
      .setTitle(`Stats for ${trackedCharacter.name}`)
      .setColor(0x00ae86) // Set a nice blue color for the embed
      .setDescription(
        `• **Server:** ${trackedCharacter.server}\n` +
        `• **Level:** ${level}\n` +
        `• **Race:** ${race}\n` +
        `• **Class:** ${characterClass}\n` +
        `• **Equipped Item Level:** ${equippedItemLevel}\n` +
        `• **Last Checked:** ${new Date(trackedCharacter.lastChecked).toLocaleString()}`
      )
      .setThumbnail(getImageForRace(race, gender)) // Add race image
      .setImage(getImageForClass(characterClass)) // Add class image
      .setFooter({ text: "Character stats retrieved successfully." });

    msg.reply({ embeds: [embed] });
  }

  // -----------------------------
  // !track command
  // -----------------------------
  if (msg.content.startsWith("!track")) {
    const parts = msg.content.split(" ");
    if (parts.length < 3) {
      msg.reply("Usage: !track [characterName] [serverName]");
      return;
    }

    const name = parts[1].toLowerCase();
    const server = parts[2].toLowerCase();

    const characterData = await getCharacterData(server, name);

    if (!characterData) {
      msg.reply("Could not fetch character. Check spelling or try again.");
      return;
    }

    const { level, race, characterClass, equippedItemLevel, gender } = characterData;

    // Store the extracted data, including equipped item level
    tracked[`${server}-${name}`] = {
      server,
      name,
      lastLevel: level,
      race, // Already a string
      characterClass, // Already a string
      equippedItemLevel, // Store equipped item level
      gender, // Store gender
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
        `• **Class:** ${characterClass}\n` +
        `• **Equipped Item Level:** ${equippedItemLevel}`
      )
      .setThumbnail(getImageForClass(characterClass)) // Class image as the thumbnail
      .setImage(getImageForRace(race, gender)) // Race image as the main image
      .setFooter({ text: "Tracking updates will be announced in this channel." });

    msg.reply({ embeds: [embed] });
  }

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

      const characterData = await getCharacterData(server, name);

      if (!characterData) {
        msg.reply(`Could not fetch character: **${name}** on **${server}**. Skipping.`);
        continue;
      }

      const { level, race, characterClass, equippedItemLevel, gender } = characterData;

      tracked[`${server}-${name}`] = {
        server,
        name,
        lastLevel: level,
        race,
        characterClass,
        equippedItemLevel, // Store equipped item level
        gender, // Store gender
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

    const { server, lastLevel, race, characterClass, equippedItemLevel, channelId, gender } = trackedCharacter;

    // Simulate a level-up for debugging
    const newLevel = lastLevel + 1; // Increment the level for testing

    const embed = new EmbedBuilder()
      .setTitle(`🎉 Level Up!`)
      .setColor(0xffa500) // Orange color for the embed
      .setDescription(
        `🔥 **${trackedCharacter.name}** leveled up! **${lastLevel} → ${newLevel}**\n` +
        `• **Race:** ${race}\n` +
        `• **Class:** ${characterClass}\n` +
        `• **Equipped Item Level:** ${equippedItemLevel}`
      )
      .setThumbnail(getImageForRace(race, gender)) // Add race image
      .setImage(getImageForClass(characterClass)) // Add class image
      .setFooter({ text: getRandomFunFact() }); // Add a random fun fact in the footer

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
});

// Cron job: runs every 10 minutes
cron.schedule("*/10 * * * *", async () => {
  console.log("Running WoW level check every 10 minutes...");
  await runHourlyCheck();
});

async function runHourlyCheck() {
  console.log(`[${new Date().toISOString()}] Starting WoW level check...`);

  try {
    for (const key in tracked) {
      const entry = tracked[key];
      console.log(`[${new Date().toISOString()}] Checking character: ${entry.name} on ${entry.server}`);

      const characterData = await getCharacterData(entry.server, entry.name);

      if (characterData === null) {
        console.log(`[${new Date().toISOString()}] Failed to fetch data for ${entry.name}. Skipping.`);
        continue;
      }

      const { level: newLevel, equippedItemLevel, gender } = characterData;

      if (newLevel > entry.lastLevel) {
        console.log(`[${new Date().toISOString()}] Level up detected for ${entry.name}: ${entry.lastLevel} → ${newLevel}`);
        const channel = await client.channels.fetch(entry.channelId);

        const embed = new EmbedBuilder()
          .setTitle(`🎉 Level Up!`)
          .setColor(0xffa500) // Orange color for the embed
          .setDescription(
            `🔥 **${entry.name}** leveled up! **${entry.lastLevel} → ${newLevel}**\n` +
            `• **Race:** ${entry.race}\n` +
            `• **Class:** ${entry.characterClass}\n` +
            `• **Equipped Item Level:** ${equippedItemLevel}`
          )
          .setThumbnail(getImageForRace(entry.race, gender)) // Pass gender to getImageForRace
          .setImage(getImageForClass(entry.characterClass))
          .setFooter({ text: getRandomFunFact() });

        await channel.send({ embeds: [embed] });

        // Update the tracked data
        entry.lastLevel = newLevel;
        entry.equippedItemLevel = equippedItemLevel; // Update the equipped item level
        entry.gender = gender; // Update the gender
        entry.lastChecked = new Date().toISOString();
        saveTracked();
      } else {
        console.log(`[${new Date().toISOString()}] No level up for ${entry.name}.`);
        entry.lastChecked = new Date().toISOString();
        entry.gender = gender; // Update the gender even if no level-up occurred
        saveTracked();
      }
    }

    console.log(`[${new Date().toISOString()}] Finished WoW level check.`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] An error occurred during the WoW level check:`, err);
  }
}

// Login the bot
client.login(BOT_TOKEN);
