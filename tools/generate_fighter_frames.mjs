import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const albumEnvPath = path.resolve(repoRoot, "../AlbumCreator/codex_album/.env");
const outputDir = path.resolve(repoRoot, "assets/anim");

const modelCandidates = [
  "models/gemini-2.5-flash-image",
  "models/gemini-3-pro-image-preview",
];

const fighters = [
  {
    prefix: "p1",
    baseDescription:
      "full-body 2D arcade fighting character, red gi with black belt, black gloves, short dark hair",
  },
  {
    prefix: "p2",
    baseDescription:
      "full-body 2D arcade fighting character, blue gi with black belt, dark gloves, short dark hair",
  },
];

const poses = [
  { name: "idle", details: "idle combat stance, balanced feet, guard up" },
  { name: "walk1", details: "walking forward frame, lead foot stepping, guard up" },
  { name: "walk2", details: "walking forward frame, trailing foot passing through, guard up" },
  { name: "punch1", details: "punch wind-up pose, torso twisting, fist chambered" },
  { name: "punch2", details: "punch extension pose, fist striking forward" },
  { name: "kick1", details: "kick wind-up pose, knee raised, torso braced" },
  { name: "kick2", details: "kick extension pose, leg fully extended in front kick" },
  { name: "jump_up", details: "jump ascent pose, knees bent upward, airborne" },
  { name: "jump_down", details: "jump descent pose, one leg dropping to land, airborne" },
  { name: "jumpkick1", details: "jump kick chamber pose, airborne, knee lifted high" },
  { name: "jumpkick2", details: "jump kick extension pose, airborne, leg fully extended" },
  { name: "victory1", details: "victory pose with raised fist toward camera, confident smile" },
  { name: "victory2", details: "victory pose with thumbs up toward camera, celebratory stance" },
  { name: "hurt", details: "hurt recoil pose, torso recoiling backward, defensive expression" },
];

function parseEnvValue(raw, key) {
  const line = raw
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${key}=`));
  if (!line) return null;
  const value = line.slice(key.length + 1).trim();
  return value.replace(/^['"]|['"]$/g, "");
}

async function resolveGeminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const raw = await fs.readFile(albumEnvPath, "utf8");
  const key = parseEnvValue(raw, "GEMINI_API_KEY");
  if (!key) {
    throw new Error(`GEMINI_API_KEY not found in ${albumEnvPath}`);
  }
  return key;
}

function extractImageBytes(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const data = part?.inlineData?.data || part?.inline_data?.data;
      if (typeof data === "string" && data.length > 0) {
        return Buffer.from(data, "base64");
      }
    }
  }
  return null;
}

async function generateWithModel({ key, model, prompt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.25,
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: "1:1",
        imageSize: "1K",
      },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    const short = payload?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(short);
  }

  const image = extractImageBytes(payload);
  if (!image) {
    throw new Error("No inline image bytes in response");
  }
  return image;
}

async function generateTarget({ key, target }) {
  for (const model of modelCandidates) {
    try {
      const bytes = await generateWithModel({
        key,
        model,
        prompt: target.prompt,
      });
      await fs.writeFile(target.path, bytes);
      console.log(`generated ${target.name} with ${model}`);
      return;
    } catch (error) {
      console.log(`model ${model} failed for ${target.name}: ${error.message}`);
    }
  }
  throw new Error(`unable to generate ${target.name}`);
}

function buildPrompt({ baseDescription, details }) {
  return [
    "Economy mode.",
    "Single character only, full body visible, centered in frame.",
    `${baseDescription}.`,
    `${details}.`,
    "2D arcade fighting game sprite style, clean outlines, dynamic pose.",
    "Facing right.",
    "Transparent or plain light background, no scene elements, no text, no logo, no UI.",
  ].join(" ");
}

function resizeToTargetSize(files) {
  if (!files.length) return;
  for (const file of files) {
    execFileSync("sips", ["-Z", "320", file], { stdio: "ignore" });
  }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const key = await resolveGeminiKey();

  const targets = [];
  for (const fighter of fighters) {
    for (const pose of poses) {
      const name = `${fighter.prefix}_${pose.name}.png`;
      targets.push({
        name,
        path: path.join(outputDir, name),
        prompt: buildPrompt({
          baseDescription: fighter.baseDescription,
          details: pose.details,
        }),
      });
    }
  }

  for (const target of targets) {
    await generateTarget({ key, target });
  }
  resizeToTargetSize(targets.map((target) => target.path));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
