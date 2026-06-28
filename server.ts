import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import multer from "multer";
import mammoth from "mammoth";
import * as xlsx from "xlsx";
import Papa from "papaparse";
dotenv.config();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// Initialize Gemini SDK lazily to avoid crashing on start if key is temporarily absent.
let aiInstance: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is not defined. Will attempt fallback endpoints if called.");
      throw new Error("GEMINI_API_KEY is missing");
    }
    aiInstance = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiInstance;
}

// Consolidate initialization into startServer
// All routes and app initialization moved inside startServer to ensure correct order

const PROVIDERS = [
  { name: "gemini_native", displayName: "Cephboy Gemini Native", type: "primary" },
  { name: "cloudflare_llama", displayName: "Workers AI (Llama 3.1)", type: "cloudflare" }
];

async function callCloudflareWorkersAI(model: string, payload: any): Promise<Response> {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN || "").trim();

  if (!accountId || !apiToken) {
    throw new Error("Identifiants Cloudflare Workers AI (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN) manquants.");
  }

  if (accountId.includes("@")) {
    throw new Error("L'identifiant CLOUDFLARE_ACCOUNT_ID semble être une adresse e-mail. Veuillez utiliser l'ID hexadécimal de 32 caractères de votre compte Cloudflare (visible dans l'URL de votre tableau de bord ou dans la section Workers AI).");
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  
  console.log(`[Cloudflare] Calling model: ${model}`);
  
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, 45000);

  if (!response.ok) {
    let errMsg = `Cloudflare API error: ${response.statusText} (${response.status})`;
    if (response.status === 404) {
      errMsg = `Cloudflare Error 404 (No route for that URI). Vérifiez que votre CLOUDFLARE_ACCOUNT_ID (${accountId.slice(0, 4)}...) est correct et qu'il s'agit bien de l'ID hexadécimal.`;
    }
    try {
      const errJson = await response.json();
      errMsg = errJson.errors?.[0]?.message || errMsg;
    } catch (e) {}
    throw new Error(errMsg);
  }

  return response;
}

async function streamGemini(
  systemInstruction: string,
  contents: any[],
  onChunk: (text: string) => void,
  startupTimeoutMs = 2000
): Promise<string> {
  const modelsToTry = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro-preview",
    "gemini-2.0-flash",
    "gemini-pro-latest"
  ];
  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      console.log(`[Gemini] Attempting model: ${model}`);
      const client = getGeminiClient();
      const responseStream = await client.models.generateContentStream({
        model: model,
        contents: contents,
        config: {
          systemInstruction: systemInstruction,
        }
      });

      let receivedFirstChunk = false;
      let fullText = "";

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          if (!receivedFirstChunk) {
            reject(new Error(`Timeout: Gemini ${model} is slow to start`));
          }
        }, startupTimeoutMs);
      });

      const streamPromise = (async () => {
        for await (const chunk of responseStream) {
          const text = chunk.text;
          if (text) {
            if (!receivedFirstChunk) {
              receivedFirstChunk = true;
            }
            fullText += text;
            onChunk(text);
          }
        }
        return fullText;
      })();

      return await Promise.race([streamPromise, timeoutPromise]);
    } catch (err: any) {
      lastError = err;
      console.error(`Gemini model ${model} failed:`, err.message);
      
      // If it's a quota issue or specific model not found, try the next one
      if (err.message.includes("429") || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("404") || err.message.includes("not found")) {
        console.log(`Switching to next Gemini model due to: ${err.message}`);
        // Small delay to let quota breathe
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      
      // For other errors, we might want to try the next one too
      continue;
    }
  }

  throw lastError || new Error("All Gemini models failed");
}

async function streamCloudflare(
  payload: any,
  onChunk: (text: string) => void,
  startupTimeoutMs = 2500
): Promise<string> {
  // Try a few models in case one is down or has routing issues
  const modelsToTry = ["@cf/meta/llama-3.1-8b-instruct", "@cf/meta/llama-3-8b-instruct"];
  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      const response = await callCloudflareWorkersAI(model, payload);
      const reader = response.body;
      if (!reader) {
        throw new Error("No readable stream from Workers AI");
      }

      let receivedFirstChunk = false;
      let fullText = "";

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          if (!receivedFirstChunk) {
            reject(new Error(`Timeout: Cloudflare ${model} is slow to start`));
          }
        }, startupTimeoutMs);
      });

      const streamPromise = (async () => {
        const decoder = new TextDecoder();
        if (typeof (reader as any).getReader === "function") {
          const webReader = (reader as any).getReader();
          let sseBuffer = "";
          while (true) {
            const { done, value } = await webReader.read();
            if (done) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split("\n");
            sseBuffer = lines.pop() || "";
            for (const line of lines) {
              const cleaned = line.trim();
              if (cleaned.startsWith("data: ")) {
                const dataStr = cleaned.slice(6).trim();
                if (dataStr === "[DONE]") break;
                try {
                  const parsed = JSON.parse(dataStr);
                  if (parsed.response) {
                    if (!receivedFirstChunk) {
                      receivedFirstChunk = true;
                    }
                    fullText += parsed.response;
                    onChunk(parsed.response);
                  }
                } catch (e) {}
              }
            }
          }
        } else {
          for await (const chunk of reader as any) {
            const text = decoder.decode(chunk, { stream: true });
            const lines = text.split("\n");
            for (const line of lines) {
              const cleaned = line.trim();
              if (cleaned.startsWith("data: ")) {
                const dataStr = cleaned.slice(6).trim();
                if (dataStr === "[DONE]") break;
                try {
                  const parsed = JSON.parse(dataStr);
                  if (parsed.response) {
                    if (!receivedFirstChunk) {
                      receivedFirstChunk = true;
                    }
                    fullText += parsed.response;
                    onChunk(parsed.response);
                  }
                } catch (e) {}
              }
            }
          }
        }
        return fullText;
      })();

      return await Promise.race([streamPromise, timeoutPromise]);
    } catch (err: any) {
      lastError = err;
      console.error(`Cloudflare model ${model} failed:`, err.message);
      // ALWAYS try the next model if one fails, unless we're out of models
      continue;
    }
  }
  
  throw lastError || new Error("All Cloudflare models failed");
}

async function attemptFallbackChat(prompt: string, providerName: string): Promise<{ text: string; provider: string }> {
  console.log(`Trying fallback provider: ${providerName}...`);
  throw new Error(`All attempts failed for provider ${providerName}`);
}

// Helper to fetch with a strict timeout
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// 1. Search & Source Enrichment Functions
async function searchDuckDuckGo(queryText: string) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(queryText)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "Cephboy-AI-GPT/1.0" }
    }, 2500);
    
    if (!res.ok) return null;
    const data = await res.json();
    
    const citations: any[] = [];
    if (data.AbstractText) {
      citations.push({
        title: data.Heading || "DuckDuckGo Instant Answer",
        url: data.AbstractURL || "https://duckduckgo.com",
        snippet: data.AbstractText,
        source: "duckduckgo",
      });
    }
    
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      data.RelatedTopics.slice(0, 3).forEach((topic: any) => {
        if (topic.Text && topic.FirstURL) {
          citations.push({
            title: topic.Text.slice(0, 50) + "...",
            url: topic.FirstURL,
            snippet: topic.Text,
            source: "duckduckgo",
          });
        }
      });
    }
    return citations.length > 0 ? citations : null;
  } catch (e) {
    console.error("DDG Search error:", e);
    return null;
  }
}

async function searchWikipedia(queryText: string) {
  try {
    // 1. Find page titles
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(queryText)}&format=json&origin=*`;
    const searchRes = await fetchWithTimeout(searchUrl, {}, 2500);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    
    const results = searchData.query?.search;
    if (!results || results.length === 0) return null;
    
    const pageTitle = results[0].title;
    
    // 2. Fetch page summary
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
    const summaryRes = await fetchWithTimeout(summaryUrl, {
      headers: { "User-Agent": "Cephboy-AI-GPT/1.0" }
    }, 2500);
    if (!summaryRes.ok) return null;
    
    const summaryData = await summaryRes.json();
    if (summaryData.extract) {
      return [{
        title: summaryData.title || pageTitle,
        url: summaryData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`,
        snippet: summaryData.extract,
        source: "wikipedia",
      }];
    }
    return null;
  } catch (e) {
    console.error("Wikipedia search error:", e);
    return null;
  }
}

async function searchGitHub(queryText: string) {
  try {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(queryText)}&sort=stars&order=desc&per_page=3`;
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Cephboy-AI-GPT/1.0",
        "Accept": "application/vnd.github.v3+json"
      }
    }, 2500);
    
    if (!res.ok) return null;
    const data = await res.json();
    
    if (data.items && Array.isArray(data.items)) {
      return data.items.map((item: any) => ({
        title: item.full_name,
        url: item.html_url,
        snippet: `${item.description || "No description"} - Stars: ⭐ ${item.stargazers_count}`,
        source: "github",
      }));
    }
    return null;
  } catch (e) {
    console.error("GitHub search error:", e);
    return null;
  }
}

async function searchHackerNews(queryText: string) {
  try {
    // Get top stories
    const topUrl = "https://hacker-news.firebaseio.com/v0/topstories.json";
    const res = await fetchWithTimeout(topUrl, {}, 2000);
    if (!res.ok) return null;
    const topIds = await res.json();
    
    if (!Array.isArray(topIds)) return null;
    
    const citations: any[] = [];
    // Fetch details for first 3 top stories
    const promises = topIds.slice(0, 4).map(async (id: number) => {
      try {
        const itemRes = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {}, 1500);
        if (itemRes.ok) {
          const item = await itemRes.json();
          if (item && item.title) {
            citations.push({
              title: item.title,
              url: item.url || `https://news.ycombinator.com/item?id=${id}`,
              snippet: `Posted by ${item.by} with score ${item.score}`,
              source: "hackernews",
            });
          }
        }
      } catch (e) {
        // Ignore single story failure
      }
    });
    
    await Promise.all(promises);
    
    // Filter by query matches if needed, otherwise return top news
    const matches = citations.filter(c => 
      c.title.toLowerCase().includes(queryText.toLowerCase()) || 
      c.snippet.toLowerCase().includes(queryText.toLowerCase())
    );
    
    return matches.length > 0 ? matches : citations.slice(0, 3);
  } catch (e) {
    console.error("HN Fetch error:", e);
    return null;
  }
}

async function searchReddit(queryText: string) {
  try {
    const url = "https://www.reddit.com/.json?limit=5";
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "Cephboy-AI-GPT/1.0" }
    }, 2500);
    
    if (!res.ok) return null;
    const data = await res.json();
    
    const posts = data.data?.children;
    if (!posts || !Array.isArray(posts)) return null;
    
    const citations = posts.map((post: any) => ({
      title: post.data.title,
      url: `https://reddit.com${post.data.permalink}`,
      snippet: `Subreddit: r/${post.data.subreddit} | Score: ⬆️ ${post.data.score}`,
      source: "reddit",
    }));
    
    // Filter matching or return top
    const matches = citations.filter(c => 
      c.title.toLowerCase().includes(queryText.toLowerCase())
    );
    
    return matches.length > 0 ? matches : citations.slice(0, 3);
  } catch (e) {
    console.error("Reddit search error:", e);
    return null;
  }
}

// LinkedIn Search (Simulated or via API if keys provided)
async function searchLinkedIn(queryText: string) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.warn("LinkedIn keys missing. Skipping LinkedIn search.");
    return null;
  }

  try {
    // For now, we perform a search using DuckDuckGo restricted to LinkedIn
    // as the official LinkedIn search API is restricted to special partners.
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(queryText + " site:linkedin.com")}&format=json&no_html=1`;
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "Cephboy-AI-GPT/1.0" }
    }, 2500);
    
    if (!res.ok) return null;
    const data = await res.json();
    
    const citations: any[] = [];
    if (data.AbstractText) {
      citations.push({
        title: data.Heading || "LinkedIn Profile/Page",
        url: data.AbstractURL || "https://linkedin.com",
        snippet: data.AbstractText,
        source: "linkedin",
      });
    }
    
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      data.RelatedTopics.slice(0, 3).forEach((topic: any) => {
        if (topic.Text && topic.FirstURL && topic.FirstURL.includes("linkedin.com")) {
          citations.push({
            title: topic.Text.slice(0, 50) + "...",
            url: topic.FirstURL,
            snippet: topic.Text,
            source: "linkedin",
          });
        }
      });
    }
    return citations.length > 0 ? citations : null;
  } catch (e) {
    console.error("LinkedIn search emulation error:", e);
    return null;
  }
}

// Helper to parse uploaded files
async function parseFile(file: Express.Multer.File): Promise<string> {
  const mimetype = file.mimetype;
  const buffer = file.buffer;

  try {
    if (mimetype === "application/pdf") {
      const pdfModule: any = await import("pdf-parse");
      const pdfParser = pdfModule.default || pdfModule;
      const data = await pdfParser(buffer);
      return data.text;
    } else if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const data = await mammoth.extractRawText({ buffer });
      return data.value;
    } else if (mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || mimetype === "application/vnd.ms-excel") {
      const workbook = xlsx.read(buffer, { type: "buffer" });
      let text = "";
      workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        text += `\nSheet: ${sheetName}\n${xlsx.utils.sheet_to_txt(worksheet)}`;
      });
      return text;
    } else if (mimetype === "text/csv") {
      const content = buffer.toString("utf-8");
      const results = Papa.parse(content, { header: true });
      return JSON.stringify(results.data, null, 2);
    } else if (mimetype.startsWith("text/")) {
      return buffer.toString("utf-8");
    }
    return "Error: Unsupported file format";
  } catch (err: any) {
    console.error("File parsing error:", err);
    return `Error parsing file: ${err.message}`;
  }
}

// Coordinate web search and returns context & sources
async function performWebSearch(queryText: string, searchSources: string[]) {
  const citationsList: any[] = [];
  const searchPromises: Promise<any>[] = [];
  
  if (searchSources.includes("duckduckgo")) {
    searchPromises.push(searchDuckDuckGo(queryText));
  }
  if (searchSources.includes("wikipedia")) {
    searchPromises.push(searchWikipedia(queryText));
  }
  if (searchSources.includes("github")) {
    searchPromises.push(searchGitHub(queryText));
  }
  if (searchSources.includes("hackernews")) {
    searchPromises.push(searchHackerNews(queryText));
  }
  if (searchSources.includes("reddit")) {
    searchPromises.push(searchReddit(queryText));
  }
  if (searchSources.includes("linkedin")) {
    searchPromises.push(searchLinkedIn(queryText));
  }
  
  const results = await Promise.all(searchPromises);
  results.forEach(res => {
    if (res && Array.isArray(res)) {
      citationsList.push(...res);
    }
  });
  
  return citationsList;
}

// 2. Configure Express App
export const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Serve public folder explicitly to ensure logo is accessible
app.use(express.static(path.join(process.cwd(), "public")));

// API Routes
app.post("/api/save-logo", upload.single('logo'), (req, res) => {
  console.log("Logo upload request received");
  if (!req.file) {
    console.log("No file in request");
    return res.status(400).json({ error: "Aucun fichier reçu." });
  }
  
  try {
    const publicPath = path.join(process.cwd(), "public");
    if (!fs.existsSync(publicPath)) {
      console.log("Creating public directory at", publicPath);
      fs.mkdirSync(publicPath, { recursive: true });
    }
    
    const logoPath = path.join(publicPath, "logo.png");
    console.log("Saving logo to", logoPath);
    fs.writeFileSync(logoPath, req.file.buffer);
    
    res.json({ status: "ok", url: "/logo.png?v=" + Date.now() });
  } catch (err: any) {
    console.error("Error saving logo:", err);
    res.status(500).json({ error: "Erreur lors de la sauvegarde du logo: " + err.message });
  }
});

// Providers Health & Latency Checker
app.get("/api/providers/status", async (req, res) => {
  try {
    const statusPromises = PROVIDERS.map(async (provider) => {
      let status: 'online' | 'offline' = 'offline';
      const startTime = Date.now();
      
      try {
        if (provider.name === "gemini_native") {
          // Check if API key is present instead of pinging to save quota (which is very low in this environment)
          if (process.env.GEMINI_API_KEY) {
            status = 'online';
          }
        } else if (provider.name === "cloudflare_llama") {
          if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
            status = 'online';
          }
        }
      } catch (e) {
        status = 'offline';
      }
      
      return {
        name: provider.name,
        displayName: provider.displayName,
        status,
        latency: status === 'online' ? Date.now() - startTime : 0,
        type: provider.type
      };
    });
    
    const results = await Promise.all(statusPromises);
    res.json(results);
  } catch (err) {
    console.error("Provider status check error:", err);
    res.status(500).json({ error: "Failed to check providers" });
  }
});

// Helper for image generation
async function generateImageHelper(prompt: string, preferredEngine?: string): Promise<{ imageUrl: string; provider: string }> {
  const enginesToTry = [];
  if (preferredEngine === "gemini") enginesToTry.push("gemini", "cloudflare", "pollinations");
  else if (preferredEngine === "cloudflare") enginesToTry.push("cloudflare", "pollinations", "gemini");
  else enginesToTry.push("pollinations", "cloudflare", "gemini");

  let lastError: any = null;

  for (const engine of enginesToTry) {
    if (engine === "gemini") {
      try {
        const client = getGeminiClient();
        const modelsToTry = [
          { name: "gemini-3.1-flash-image", type: "native" },
          { name: "gemini-2.5-flash-image", type: "native" },
          { name: "imagen-4.0-generate-001", type: "imagen" }
        ];
        
        for (const modelInfo of modelsToTry) {
          try {
            console.log(`[Gemini Image] Attempting model: ${modelInfo.name}`);
            const response = await client.models.generateContent({
              model: modelInfo.name,
              contents: [{ parts: [{ text: prompt }] }]
            });
            
            const parts = response.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (part.inlineData && part.inlineData.data) {
                const mime = part.inlineData.mimeType || "image/png";
                return { 
                  imageUrl: `data:${mime};base64,${part.inlineData.data}`, 
                  provider: `Cephboy AI (Visuel - ${modelInfo.name})` 
                };
              }
            }
          } catch (e: any) {
            console.warn(`Gemini ${modelInfo.name} failed:`, e.message);
            lastError = e;
          }
        }
      } catch (e: any) {
         lastError = e;
      }
    } else if (engine === "cloudflare") {
      if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
        continue;
      }
      const models = [
        "@cf/stabilityai/stable-diffusion-xl-base-1.0",
        "@cf/lykon/dreamshaper-8-lcm"
      ];
      for (const model of models) {
        try {
          console.log(`[Cloudflare Image] Attempting model: ${model}`);
          const response = await callCloudflareWorkersAI(model, { prompt });
          const arrayBuffer = await response.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");
          return { 
            imageUrl: `data:image/png;base64,${base64}`, 
            provider: `Workers AI (${model.split('/').pop()})` 
          };
        } catch (err: any) {
          console.warn(`Cloudflare ${model} failed:`, err.message);
          lastError = err;
        }
      }
    } else if (engine === "pollinations") {
      try {
        console.log("[Image] Attempting Pollinations AI...");
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&private=true`;
        const headers: Record<string, string> = {};
        if (process.env.POLLINATIONS_API_KEY) {
          headers["Authorization"] = `Bearer ${process.env.POLLINATIONS_API_KEY}`;
        }
        
        const apiRes = await fetchWithTimeout(url, { headers }, 30000);
        if (apiRes.ok) {
          const arrayBuffer = await apiRes.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");
          const contentType = apiRes.headers.get("content-type") || "image/png";
          return { imageUrl: `data:${contentType};base64,${base64}`, provider: "Pollinations AI" };
        } else {
          lastError = new Error(`Pollinations failed with status: ${apiRes.status}`);
        }
      } catch (e: any) {
         console.warn("Pollinations failed:", e.message);
         lastError = e;
      }
    }
  }

  throw lastError || new Error("Tous les générateurs d'images ont échoué. Vérifiez vos clés API ou réessayez.");
}

// Helper for video generation
async function generateVideoHelper(prompt: string, engine?: string): Promise<{ frames: string[]; prompts: string[]; provider: string }> {
  let framePrompts = [
    `${prompt} - Scene 1: Début, plan d'ensemble cinématique, détails extrêmes, masterpiece`,
    `${prompt} - Scene 2: Progression, action, composition dynamique, éclairage dramatique`,
    `${prompt} - Scene 3: Climax, intensité visuelle, cadrage serré, détails époustouflants`,
    `${prompt} - Scene 4: Résolution, atmosphère calme et magnifique, plan de fin, post-traité`
  ];

  try {
    const client = getGeminiClient();
    const models = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite"];
    for (const model of models) {
      try {
        const geminiRes = await client.models.generateContent({
          model: model,
          contents: [{ parts: [{ text: `You are an expert cinematic storyboard artist. Expand this video prompt: "${prompt}" into 4 consecutive, highly descriptive visual prompts in French for AI image generation to form a coherent, high-quality 4-second video sequence. Respond ONLY with a valid JSON array containing 4 string elements. Do not include any markdown or prefix. Example format: ["scène 1", "scène 2", "scène 3", "scène 4"]` }] }]
        });
        const text = geminiRes.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const match = text.match(/\[.*\]/s);
          const cleanText = match ? match[0] : text.replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(cleanText);
          if (Array.isArray(parsed) && parsed.length === 4) {
            framePrompts = parsed;
            break;
          }
        }
      } catch (e: any) {
        console.warn(`Storyboard failed with ${model}:`, e.message);
        if (e.message.includes("429") || e.status === 429) {
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
      }
    }
  } catch (e) {
    console.warn("Failed to storyboard prompts with Gemini, using standard: ", e);
  }

  // Generate 4 images in parallel
  const imagePromises = framePrompts.map(async (framePrompt) => {
    let lastError: any = null;
    
    // Try Cloudflare first if selected or if others fail
    if ((engine === "cloudflare" || engine === "gemini") && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
      try {
        const apiRes = await callCloudflareWorkersAI("@cf/lykon/dreamshaper-8-lcm", { prompt: framePrompt });
        const arrayBuffer = await apiRes.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return `data:image/png;base64,${base64}`;
      } catch (err: any) {
        console.error("Cloudflare video frame generation failed, falling back to Pollinations:", err.message || err);
        lastError = err;
      }
    }
    
    // Fallback engine: Pollinations AI
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(framePrompt)}?width=1024&height=1024&nologo=true&private=true`;
    const pollinationsHeaders: Record<string, string> = {};
    if (process.env.POLLINATIONS_API_KEY) {
      pollinationsHeaders["Authorization"] = `Bearer ${process.env.POLLINATIONS_API_KEY}`;
    }
    try {
      const apiRes = await fetchWithTimeout(url, { headers: pollinationsHeaders }, 30000);
      if (apiRes.ok) {
        const arrayBuffer = await apiRes.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return `data:image/png;base64,${base64}`;
      }
      throw new Error(`Erreur Pollinations HTTP ${apiRes.status}`);
    } catch (e: any) {
      throw new Error(`Échec de la génération d'un des plans: ${e.message}. Précédente erreur: ${lastError?.message || 'Aucune'}`);
    }
  });

  const imageUrls = await Promise.all(imagePromises);
  return {
    frames: imageUrls,
    prompts: framePrompts,
    provider: engine === "cloudflare" ? "Cloudflare Workers AI" : "Pollinations AI"
  };
}

// Image Generation API
app.post("/api/generate-image", async (req, res) => {
    const { prompt, engine: preferredEngine } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Le prompt est requis." });
    }

    try {
      const result = await generateImageHelper(prompt, preferredEngine);
      res.json(result);
    } catch (err: any) {
      console.error("Image generation error:", err);
      res.status(500).json({ error: err.message || "Erreur lors de la génération de l'image." });
    }
});

// Video Generation API
app.post("/api/generate-video", async (req, res) => {
    const { prompt, engine } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Le prompt est requis." });
    }

    try {
      const result = await generateVideoHelper(prompt, engine);
      res.json(result);
    } catch (err: any) {
      console.error("Video generation error:", err);
      res.status(500).json({ error: err.message || "Erreur lors de la génération de la vidéo." });
    }
});

  // Principal Chat Completion Route (Supports simulated SSE streaming for fallbacks too!)
  app.post("/api/chat", async (req, res) => {
    const { messages, searchWeb, searchSources, preferCloudflare, selectedModel } = req.body;
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(": connected\n\n");

    let systemInstruction = `You are Cephboy AI, a versatile and high-performance assistant.
Your goal is to provide accurate, helpful, and concise information.
You are capable of analyzing documents (PDF, Word, Excel, CSV, Text) and images.
When a user uploads a file, analyze its content thoroughly.
You can draft projects, write code, and structure ideas ("rédiger un projet").
You automatically detect the language used by the user and MUST respond in that same language.
If the user asks to "create a file" or "export", provide the content clearly.
Maintain a professional and friendly tone.
If you use web search results, cite them appropriately.`;
    
    // Check if we need to perform web search
    if (searchWeb) {
      try {
        const lastUserMessage = [...messages].reverse().find(m => m.role === "user")?.content || "";
        res.write(`data: ${JSON.stringify({ type: "status", status: "Recherche en cours..." })}\n\n`);
        const citations = await performWebSearch(lastUserMessage, searchSources);
        
        if (citations && citations.length > 0) {
          systemInstruction += `\n\nSearch results to help you answer:\n${JSON.stringify(citations)}`;
          res.write(`data: ${JSON.stringify({ type: "citations", citations })}\n\n`);
        }
      } catch (e) {
        console.error("Web search failed:", e);
      }
    }

    const nativeGeminiModels = [
      { modelId: "gemini-3.5-flash", displayName: "Cephboy AI" },
      { modelId: "gemini-3.1-flash-lite", displayName: "Cephboy AI Lite" },
      { modelId: "gemini-3.1-pro-preview", displayName: "Cephboy AI Pro" },
      { modelId: "gemini-flash-latest", displayName: "Cephboy AI Classic" },
    ];

    const hasCloudflare = !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
    let hasGemini = false;
    try {
      hasGemini = !!process.env.GEMINI_API_KEY;
    } catch (e) {}

    let success = false;

    // Detect if this is an analysis, creation, or general greeting
    const lastUserMessage = [...messages].reverse().find(m => m.role === "user")?.content || "";
    const isAnalysisOrCreation = /créer|analyse|analyser|créé|création|dossier|fichier|pdf|doc|xls|csv/i.test(lastUserMessage) || lastUserMessage.length > 250;
    const isGreeting = /salut|bonjour|hello|hi|coucou|hey|hola/i.test(lastUserMessage) && lastUserMessage.length < 25;
    
    // Check if user is explicitly asking for image or video generation
    const isVideoReq = /(vidéo|video|anime|animer)/i.test(lastUserMessage) && /(génère|génere|générer|crée|créer|fais)/i.test(lastUserMessage);
    const isImageReq = !isVideoReq && /(image|photo|dessin|illustra|portrait)/i.test(lastUserMessage) && /(génère|génere|générer|crée|créer|fais)/i.test(lastUserMessage);

    if (isVideoReq) {
      res.write(`data: ${JSON.stringify({ type: "provider", provider: "Cephboy AI (Vidéo)" })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "status", status: "Génération de la séquence vidéo en cours..." })}\n\n`);
      try {
        const data = await generateVideoHelper(lastUserMessage, 'cloudflare');
        if (data.frames) {
          res.write(`data: ${JSON.stringify({ type: "media", videoFrames: data.frames })}\n\n`);
          res.end();
          return;
        } else {
          throw new Error("Échec de génération vidéo.");
        }
      } catch (e: any) {
        res.write(`data: ${JSON.stringify({ type: "error", error: e.message })}\n\n`);
        res.end();
        return;
      }
    } else if (isImageReq) {
      res.write(`data: ${JSON.stringify({ type: "provider", provider: "Cephboy AI (Image)" })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "status", status: "Génération de l'image en cours..." })}\n\n`);
      try {
        const data = await generateImageHelper(lastUserMessage, 'cloudflare');
        if (data.imageUrl) {
          res.write(`data: ${JSON.stringify({ type: "media", imageUrl: data.imageUrl })}\n\n`);
          res.end();
          return;
        } else {
          throw new Error("Échec de génération d'image.");
        }
      } catch (e: any) {
        res.write(`data: ${JSON.stringify({ type: "error", error: e.message })}\n\n`);
        res.end();
        return;
      }
    }

    // Default to 'duo' if not specified
    let activeMode = selectedModel || 'duo';
    
    if (activeMode === 'duo' && (isGreeting || !isAnalysisOrCreation)) {
      // Use single engine (CephGPT-1) for fast and normal greeting response
      activeMode = 'cephgpt1';
    } else if (isAnalysisOrCreation && activeMode !== 'duo') {
      // Auto-switch to collaborative duo for file analysis or creation work
      activeMode = 'duo';
    }

    // 1. DUO COLLABORATIF (Sequential collaborative streaming with no silent lag!)
    if (activeMode === 'duo' && hasGemini && hasCloudflare) {
      try {
        const providerName = "Duo Collaboratif";
        res.write(`data: ${JSON.stringify({ type: "provider", provider: providerName })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "status", status: "Analyse collaborative en cours..." })}\n\n`);

        let primaryOutput = "";
        const contents = messages.map((m: any) => ({
          role: m.role === "assistant" ? "model" as const : "user" as const,
          parts: [{ text: m.content }]
        }));

        // Stream CephGPT-1 directly to the user so connection is kept alive and user gets immediate response!
        try {
          primaryOutput = await streamGemini(
            systemInstruction + "\n\nTu es CephGPT-1 (Moteur principal). Fournis une analyse détaillée, claire et complète de la requête.",
            contents,
            (text) => {
              res.write(`data: ${JSON.stringify({ type: "content", content: text })}\n\n`);
            },
            8000
          );
        } catch (geminiError: any) {
          console.error("Duo Phase 1 (CephGPT-1) failed:", geminiError.message);
        }

        // If Phase 1 succeeded, let CephGPT-2 enrich it dynamically
        if (primaryOutput.trim()) {
          res.write(`data: ${JSON.stringify({ type: "status", status: "Finalisation par CephGPT-2..." })}\n\n`);
          
          const enricherSystemInstruction = `You are CephGPT-2, an expert AI collaborator.
Your partner CephGPT-1 has provided the response below.
Your task is to review and provide additional deep synthesis, next steps, or missing details to perfectly complete the response.
Do not repeat what CephGPT-1 already said. Write in the same language. Ensure a single cohesive flow.`;

          const cloudflarePayload = {
            messages: [
              { role: "system", content: enricherSystemInstruction },
              ...messages.map((m: any) => ({
                role: m.role === "assistant" ? "assistant" : "user",
                content: m.content
              })),
              { role: "assistant", content: primaryOutput },
              { role: "user", content: "Complète cette réponse avec brio et apporte une valeur ajoutée sans répéter ce qui précède ni faire référence à l'ébauche." }
            ],
            stream: true
          };

          res.write(`data: ${JSON.stringify({ type: "content", content: "\n\n" })}\n\n`); // Add space between sections seamlessly

          try {
            await streamCloudflare(
              cloudflarePayload,
              (text) => {
                res.write(`data: ${JSON.stringify({ type: "content", content: text })}\n\n`);
              },
              8000
            );
          } catch (cfError: any) {
            console.error("Duo Phase 2 (CephGPT-2) failed:", cfError.message);
          }
          success = true;
        } else {
          // If Phase 1 failed to stream anything, fallback to a full Cloudflare run
          res.write(`data: ${JSON.stringify({ type: "status", status: "CephGPT-2 prend le relais..." })}\n\n`);
          const payload = {
            messages: [
              { role: "system", content: systemInstruction },
              ...messages.map((m: any) => ({
                role: m.role === "assistant" ? "assistant" : "user",
                content: m.content
              }))
            ],
            stream: true
          };
          await streamCloudflare(payload, (text) => {
            res.write(`data: ${JSON.stringify({ type: "content", content: text })}\n\n`);
          }, 8000);
          success = true;
        }
      } catch (collabError: any) {
        console.error("Duo Collaboratif mode failure, falling back to CephGPT-1:", collabError);
        activeMode = 'cephgpt1';
      }
    }

    // 2. CEPHGPT-1 (Gemini Single Engine)
    if (!success && activeMode === 'cephgpt1' && hasGemini) {
      try {
        res.write(`data: ${JSON.stringify({ type: "provider", provider: "CephGPT-1" })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "status", status: "Connexion à CephGPT-1..." })}\n\n`);

        const contents = messages.map((m: any) => ({
          role: m.role === "assistant" ? "model" as const : "user" as const,
          parts: [{ text: m.content }]
        }));

        await streamGemini(systemInstruction, contents, (text) => {
          res.write(`data: ${JSON.stringify({ type: "content", content: text })}\n\n`);
        }, 8000);
        success = true;
      } catch (err: any) {
        console.error("CephGPT-1 failed, trying CephGPT-2:", err.message);
        activeMode = 'cephgpt2';
      }
    }

    // 3. CEPHGPT-2 (Cloudflare Single Engine)
    if (!success && activeMode === 'cephgpt2' && hasCloudflare) {
      try {
        res.write(`data: ${JSON.stringify({ type: "provider", provider: "CephGPT-2" })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "status", status: "Connexion à CephGPT-2..." })}\n\n`);

        const payload = {
          messages: [
            { role: "system", content: systemInstruction },
            ...messages.map((m: any) => ({
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content
            }))
          ],
          stream: true
        };

        await streamCloudflare(payload, (text) => {
          res.write(`data: ${JSON.stringify({ type: "content", content: text })}\n\n`);
        }, 8000);
        success = true;
      } catch (err: any) {
        console.error("CephGPT-2 failed:", err.message);
      }
    }

    // Fallback flow if everything failed
    if (!success) {
      if (preferCloudflare && hasCloudflare) {
        try {
          res.write(`data: ${JSON.stringify({ type: "provider", provider: "Cephboy AI GPT" })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "status", status: "Connexion au réseau Cephboy..." })}\n\n`);
          
          const payload = {
            messages: [
              { role: "system", content: systemInstruction },
              ...messages.map((m: any) => ({
                role: m.role === "assistant" ? "assistant" : "user",
                content: m.content
              }))
            ],
            stream: true
          };

          await streamCloudflare(payload, (text) => {
            res.write(`data: ${JSON.stringify({ type: "content", content: text })}\n\n`);
          }, 8000);
          success = true;
        } catch (err: any) {
          console.error("Fallback A failed, fallback to Gemini:", err.message);
        }
      }

      if (!success && hasGemini) {
        for (const modelConfig of nativeGeminiModels) {
          try {
            res.write(`data: ${JSON.stringify({ type: "provider", provider: "Cephboy AI GPT" })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: "status", status: "Connexion au réseau Cephboy..." })}\n\n`);
            
            const contents = messages.map((m: any) => ({
              role: m.role === "assistant" ? "model" as const : "user" as const,
              parts: [{ text: m.content }]
            }));

            await streamGemini(systemInstruction, contents, (text) => {
              res.write(`data: ${JSON.stringify({ type: "content", content: text })}\n\n`);
            }, 8000);
            
            success = true;
            break;
          } catch (err: any) {
            console.error(`Native Gemini model ${modelConfig.modelId} failed:`, err.message);
          }
        }
      }

      // Final fallback retry
      if (!success && !preferCloudflare && hasCloudflare) {
        try {
          res.write(`data: ${JSON.stringify({ type: "provider", provider: "Cephboy AI GPT" })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "status", status: "Connexion de secours..." })}\n\n`);
          const payload = {
            messages: [
              { role: "system", content: systemInstruction },
              ...messages.map((m: any) => ({
                role: m.role === "assistant" ? "assistant" : "user",
                content: m.content
              }))
            ],
            stream: true
          };
          await streamCloudflare(payload, (text) => {
            res.write(`data: ${JSON.stringify({ type: "content", content: text })}\n\n`);
          }, 8000);
          success = true;
        } catch (err: any) {
          console.error("Final fallback failed:", err.message);
        }
      }
    }

    if (!success) {
      res.write(`data: ${JSON.stringify({ type: "error", error: "Désolé, tous les moteurs IA de Cephboy AI GPT sont actuellement surchargés. Veuillez réessayer ultérieurement." })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    }
    
    res.end();
  });

  // Global Error Handler (Registered at module level)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global Server Error:", err);
    res.status(err.status || 500).json({ 
      error: err.message || "Une erreur interne est survenue sur le serveur Cephboy.",
    });
  });

// 3. Start the Server
async function startServer() {
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Standard production mode
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath) && !process.env.VERCEL) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  // Bind to port 3000 only if NOT on Vercel
  if (!process.env.VERCEL) {
    const PORT = Number(process.env.PORT) || 3000;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Cephboy AI GPT server running on http://0.0.0.0:${PORT}`);
    });
  }
}

// Only run startServer if we are the main module or not on Vercel
// Vercel handles the app via the export
startServer().catch(err => {
  console.error("Initialization failed:", err);
});

export default app;
