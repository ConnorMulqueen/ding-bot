import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
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
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);

    // Find any text that contains "Level"
    const levelSpan = $('span.bold')
      .filter((i, el) => $(el).text().includes("Level"))
      .first();

    if (!levelSpan.length) {
      console.log(`No level element found for ${name} on ${server}`);
      return null;
    }

    const text = levelSpan.text().trim();  // "Level 28"
    const level = parseInt(text.replace("Level", "").trim(), 10);

    if (isNaN(level)) {
      console.log(`Failed to extract numeric level for ${name} on ${server}`);
      return null;
    }

    return level;
  } catch (err) {
    console.error("Error fetching character:", err);
    return null;
  }
}


client.on("messageCreate", async (msg) => {
  // -----------------------------
  // !listtracks command
  // -----------------------------
  if (msg.content === "!listtracks") {
    if (Object.keys(tracked).length === 0) {
      msg.reply("No characters are currently being tracked.");
      return;
    }

    let output = "**Currently Tracked Characters:**\n\n";

    for (const key in tracked) {
      const entry = tracked[key];
      const channelMention = `<#${entry.channelId}>`;

      output += `• **${entry.name}** (Server: ${entry.server}) — Last Level: ${entry.lastLevel} — Announcing in: ${channelMention}\n`;
    }

    msg.reply(output);
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

  const level = await getCharacterLevel(server, name);

  if (level === null) {
    msg.reply("Could not fetch character. Check spelling or try again.");
    return;
  }

  tracked[`${server}-${name}`] = {
    server,
    name,
    lastLevel: level,
    channelId: msg.channel.id
  };

  saveTracked();

  msg.reply(`Tracking **${name}** on **${server}** (Level ${level})`);
});


// Cron job: runs every hour on the hour
cron.schedule("0 * * * *", async () => {
  console.log("Running hourly WoW level check...");

  for (const key in tracked) {
    const entry = tracked[key];
    const newLevel = await getCharacterLevel(entry.server, entry.name);

    if (newLevel === null) continue;

    if (newLevel > entry.lastLevel) {
      // Character leveled!
      const channel = await client.channels.fetch(entry.channelId);
      channel.send(
        `🔥 **${entry.name}** leveled up! **${entry.lastLevel} → ${newLevel}**`
      );

      entry.lastLevel = newLevel;
      saveTracked();
    }
  }
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(BOT_TOKEN);
