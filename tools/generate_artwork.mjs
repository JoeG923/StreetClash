import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const albumEnvPath = path.resolve(repoRoot, "../AlbumCreator/codex_album/.env");
const outputDir = path.resolve(repoRoot, "assets");

const assets = [
  {
    name: "background.png",
    aspectRatio: "16:9",
    prompt:
      "Economy mode, 2D side-view fighting game stage at sunset, empty street arena, clean cartoon style, vibrant, no characters, no text, 1024x576 framing.",
  },
  {
    name: "fighter_red.png",
    aspectRatio: "1:1",
    prompt:
      "Economy mode, full-body 2D fighter sprite, martial artist in red outfit, side pose facing right, transparent background, clean outline, no text.",
  },
  {
    name: "fighter_blue.png",
    aspectRatio: "1:1",
    prompt:
      "Economy mode, full-body 2D fighter sprite, martial artist in blue outfit, side pose facing left, transparent background, clean outline, no text.",
  },
  {
    name: "win_banner.png",
    aspectRatio: "16:9",
    prompt:
      "Economy mode, bright celebration burst banner with confetti and stars, transparent background, no text, arcade vibe.",
  },
];

const modelCandidates = [
  "models/gemini-2.5-flash-image",
  "models/gemini-3-pro-image-preview",
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

async function generateWithModel({ key, model, prompt, aspectRatio }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio,
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

async function generateAsset({ key, target }) {
  for (const model of modelCandidates) {
    try {
      const bytes = await generateWithModel({
        key,
        model,
        prompt: target.prompt,
        aspectRatio: target.aspectRatio,
      });
      await fs.writeFile(path.join(outputDir, target.name), bytes);
      console.log(`generated ${target.name} with ${model}`);
      return;
    } catch (error) {
      console.log(`model ${model} failed for ${target.name}: ${error.message}`);
    }
  }
  throw new Error(`unable to generate ${target.name} with available models`);
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const key = await resolveGeminiKey();
  for (const target of assets) {
    await generateAsset({ key, target });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
