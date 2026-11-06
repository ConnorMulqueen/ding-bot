// Blizzard API access for WoW: Forever.
// The Forever namespaces (profile-forever-{region}) are UNDOCUMENTED and may change.
import axios from "axios";

const REGION = (process.env.BLIZZARD_REGION || "us").toLowerCase();
const LOCALE = "en_US";
const API_BASE = `https://${REGION}.api.blizzard.com`;
const OAUTH_URL = `https://${REGION}.battle.net/oauth/token`;
const PROFILE_NAMESPACE = `profile-forever-${REGION}`;

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh 5 min before expiry
const MAX_TRANSIENT_RETRIES = 2; // for 429 / 5xx / network errors
const MAX_BACKOFF_MS = 30 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// -----------------------------
// Name helpers
// -----------------------------

function normalizeNamePart(part) {
  return String(part).normalize("NFC").trim().toLowerCase();
}

// Unique key for a Forever character: "first-last", lowercased.
export function characterKey(first, last) {
  return `${normalizeNamePart(first)}-${normalizeNamePart(last)}`;
}

// "cOLD" -> "Cold". Works with accented characters.
export function capitalizeName(part) {
  const lower = normalizeNamePart(part);
  const chars = Array.from(lower);
  if (chars.length === 0) return "";
  return chars[0].toLocaleUpperCase() + chars.slice(1).join("");
}

// e.g. https://worldofwarcraft.blizzard.com/en-us/forever/us/armory/character/windslap-mcgee
export function armoryUrl(first, last) {
  return `https://worldofwarcraft.blizzard.com/en-us/forever/${REGION}/armory/character/${encodeURIComponent(characterKey(first, last))}`;
}

export function displayName(first, last) {
  return `${capitalizeName(first)} ${capitalizeName(last)}`;
}

// -----------------------------
// Response parsing helpers
// -----------------------------

// With locale set, names come back as plain strings; without it, as { en_US: "..." }.
function localized(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (typeof value[LOCALE] === "string") return value[LOCALE];
    const first = Object.values(value).find((v) => typeof v === "string");
    return first || null;
  }
  return null;
}

const RULESET_LABELS = {
  NORMAL: "Normal",
  PVP: "PvP",
  RP: "RP",
  HARDCORE: "Hardcore",
};

function prettifyRulesetType(type) {
  const upper = String(type).trim().toUpperCase();
  if (RULESET_LABELS[upper]) return RULESET_LABELS[upper];
  return upper
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

// The `ruleset` field's shape is undocumented. Accept a string, or an object with name/type.
export function parseRuleset(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") return raw.trim() ? prettifyRulesetType(raw) : null;
  if (typeof raw === "object") {
    const name = localized(raw.name);
    if (name) return name;
    if (typeof raw.type === "string" && raw.type.trim()) return prettifyRulesetType(raw.type);
  }
  return null;
}

// -----------------------------
// OAuth token
// -----------------------------

let accessToken = null;
let tokenExpiresAt = 0;

async function fetchAccessToken() {
  const response = await axios.post(
    OAUTH_URL,
    new URLSearchParams({ grant_type: "client_credentials" }),
    {
      auth: {
        username: process.env.API_CLIENT_ID,
        password: process.env.API_CLIENT_SECRET,
      },
    }
  );

  accessToken = response.data.access_token;
  const expiresInSec = Number(response.data.expires_in) || 3600;
  tokenExpiresAt = Date.now() + expiresInSec * 1000;
  console.log(`Blizzard API access token fetched successfully (expires in ${expiresInSec}s).`);
}

async function ensureAccessToken() {
  if (!accessToken || Date.now() >= tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
    await fetchAccessToken();
  }
}

function retryDelayMs(err, attempt) {
  const retryAfter = Number(err.response?.headers?.["retry-after"]);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_BACKOFF_MS);
  }
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS); // 1s, 2s, ...
}

function isTransient(err) {
  const status = err.response?.status;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return !err.response; // network error / timeout
}

// GET with: one token refresh on 401, short backoff on 429/5xx/network errors.
export async function apiGet(url) {
  let refreshedOn401 = false;
  let transientAttempts = 0;

  while (true) {
    try {
      await ensureAccessToken();
      return await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000,
      });
    } catch (err) {
      const status = err.response?.status;

      if (status === 401 && !refreshedOn401) {
        console.error("Blizzard API returned 401. Refreshing token and retrying once...");
        refreshedOn401 = true;
        accessToken = null;
        continue;
      }

      if (isTransient(err) && transientAttempts < MAX_TRANSIENT_RETRIES) {
        const delay = retryDelayMs(err, transientAttempts);
        transientAttempts++;
        console.warn(`Blizzard API ${status || "network error"}; retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      throw err;
    }
  }
}

// -----------------------------
// Character data
// -----------------------------

// Returns one of:
//   { ok: true, level, race, characterClass, equippedItemLevel, gender, ruleset, raw }
//   { ok: false, notFound: true }   -> 404: Blizzard doesn't have this profile (yet)
//   { ok: false, error }            -> anything else
export async function getCharacterData(first, last) {
  const slug = encodeURIComponent(characterKey(first, last));
  const url = `${API_BASE}/profile/wow/character/${slug}?namespace=${PROFILE_NAMESPACE}&locale=${LOCALE}`;
  const label = displayName(first, last);

  try {
    console.log(`Fetching character data from: ${url}`);
    const response = await apiGet(url);
    const data = response.data || {};

    const { level, race, character_class: characterClass, equipped_item_level: equippedItemLevel, gender } = data;

    const raceName = localized(race?.name) || "Unknown Race";
    const className = localized(characterClass?.name) || "Unknown Class";
    const genderType = gender?.type || "MALE"; // Default to MALE if not provided
    const ruleset = parseRuleset(data.ruleset);

    console.log(
      `Fetched data for ${label}: Level ${level}, Race ${raceName}, Class ${className}, Gender ${genderType}, Equipped Item Level ${equippedItemLevel}, Ruleset ${ruleset ?? "unknown"}`
    );

    return {
      ok: true,
      level,
      race: raceName,
      characterClass: className,
      equippedItemLevel: equippedItemLevel || 0, // Default to 0 if not available
      gender: genderType,
      ruleset,
      faction: localized(data.faction?.name), // "Horde" / "Alliance"
      lastLogin: Number(data.last_login_timestamp) || null, // ms epoch
      experience: Number.isFinite(Number(data.experience)) ? Number(data.experience) : null, // XP into the current level
      // Blizzard's own casing (e.g. "McGee"); fall back to what was typed
      firstName: typeof data.name === "string" && data.name ? data.name : capitalizeName(first),
      lastName: typeof data.surname === "string" && data.surname ? data.surname : capitalizeName(last),
      raw: data,
    };
  } catch (err) {
    if (err.response?.status === 404) {
      console.log(`Character ${label} not found (404). Forever profile may not be populated yet.`);
      return { ok: false, notFound: true };
    }
    console.error(`Failed to fetch character data for ${label}:`, err.response?.data || err.message);
    return { ok: false, error: err };
  }
}

// -----------------------------
// Extra character details (separate endpoints linked from the profile)
// -----------------------------

function withLocale(href) {
  if (href.includes("locale=")) return href;
  return href + (href.includes("?") ? "&" : "?") + `locale=${LOCALE}`;
}

async function fetchLinked(raw, key) {
  const href = raw?.[key]?.href;
  if (!href) return null;
  try {
    return (await apiGet(withLocale(href))).data;
  } catch (err) {
    console.warn(`Could not fetch ${key}:`, err.response?.status || err.message);
    return null;
  }
}

function findStatistic(categories, wantedNames) {
  const wanted = wantedNames.map((n) => n.toLowerCase());
  const stack = [...(categories || [])];
  while (stack.length) {
    const cat = stack.pop();
    for (const stat of cat.statistics || []) {
      if (wanted.includes(String(stat.name).toLowerCase())) return stat.quantity;
    }
    stack.push(...(cat.sub_categories || []));
  }
  return null;
}

function parseProfessions(data) {
  const list = [
    ...(data?.primaries || []).map((p) => ({ ...p, primary: true })),
    ...(data?.secondaries || []).map((p) => ({ ...p, primary: false })),
  ];
  return list
    .map((p) => {
      const tier = p.tiers?.[0];
      const name = localized(p.profession?.name);
      if (!name) return null;
      return { name, primary: p.primary, skill: tier?.skill_points ?? null, max: tier?.max_skill_points ?? null };
    })
    .filter(Boolean);
}

// Fetches media, spec, professions and journey stats. Every part is optional:
// anything that fails or is missing comes back as null / [].
export async function getCharacterExtras(characterData) {
  const raw = characterData?.raw;
  const [media, specs, professions, stats] = await Promise.all([
    fetchLinked(raw, "media"),
    fetchLinked(raw, "specializations"),
    fetchLinked(raw, "professions"),
    fetchLinked(raw, "achievements_statistics"),
  ]);

  const asset = (key) => media?.assets?.find((a) => a.key === key)?.value || null;

  const activeGroup = specs?.specialization_groups?.find((g) => g.is_active) || specs?.specialization_groups?.[0];
  const topSpec = [...(activeGroup?.specializations || [])].sort((a, b) => (b.spent_points || 0) - (a.spent_points || 0))[0];
  const spec = localized(topSpec?.specialization_name) || localized(topSpec?.specialization?.name);

  const cats = stats?.categories;
  return {
    avatar: asset("avatar-sd") || asset("avatar"), // classic (SD) model first
    spec: spec || null,
    professions: parseProfessions(professions),
    quests: findStatistic(cats, ["Quests completed"]),
    kills: findStatistic(cats, ["Total kills", "Creatures killed"]),
    deaths: findStatistic(cats, ["Total deaths"]),
  };
}
