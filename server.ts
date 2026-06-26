import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import multer from "multer";
import mammoth from "mammoth";
import * as xlsx from "xlsx";
import Papa from "papaparse";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

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
];

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
      const data = await pdf(buffer);
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

  // Image Generation API
  app.post("/api/generate-image", async (req, res) => {
    const { prompt, engine } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Le prompt est requis." });
    }

    try {
      if (engine === "gemini") {
        const client = getGeminiClient();
        const modelsToTry = [
          { name: "gemini-3.1-flash-image", type: "native" },
          { name: "gemini-2.5-flash-image", type: "native" },
          { name: "imagen-4.0-generate-001", type: "imagen" }
        ];
        
        let lastError = null;
        for (const modelInfo of modelsToTry) {
          try {
            if (modelInfo.type === "imagen") {
              const apiRes = await client.models.generateImages({
                model: modelInfo.name,
                prompt: prompt,
                config: {
                  numberOfImages: 1,
                  outputMimeType: "image/jpeg",
                  aspectRatio: "1:1",
                },
              });
              
              if (apiRes.generatedImages && apiRes.generatedImages[0]) {
                const base64Bytes = apiRes.generatedImages[0].image.imageBytes;
                return res.json({ 
                  imageUrl: `data:image/jpeg;base64,${base64Bytes}`, 
                  provider: `Cephboy AI (Visuel)` 
                });
              }
              throw new Error("No image generated");
            } else {
              const response = await client.models.generateContent({
                model: modelInfo.name,
                contents: [{ parts: [{ text: `Generate a high-quality image based on this prompt: ${prompt}` }] }],
                config: {
                  imageConfig: {
                    aspectRatio: "1:1",
                    imageSize: "1K"
                  }
                }
              });
              const parts = response.candidates?.[0]?.content?.parts || [];
              for (const part of parts) {
                if (part.inlineData && part.inlineData.data) {
                  const mime = part.inlineData.mimeType || "image/png";
                  return res.json({ 
                    imageUrl: `data:${mime};base64,${part.inlineData.data}`, 
                    provider: `Cephboy AI (Visuel)` 
                  });
                }
              }
              throw new Error("No inline image data found");
            }
          } catch (err: any) {
            console.error(`Gemini image generation failed with ${modelInfo.name}:`, err.message || err);
            lastError = err;
          }
        }
        throw lastError || new Error("Échec de la génération d'image avec Gemini.");
      } else if (engine === "pixelapi") {
        const url = "https://api.pixelapi.dev/v1/image/generate";
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (process.env.PIXELAPI_KEY) {
          headers["Authorization"] = `Bearer ${process.env.PIXELAPI_KEY}`;
        }
        
        const apiRes = await fetchWithTimeout(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ prompt })
        }, 30000);

        if (apiRes.ok) {
          const contentType = apiRes.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const data = await apiRes.json();
            const imageUrl = data.url || data.imageUrl || data.image || data.result;
            if (imageUrl) {
              return res.json({ imageUrl, provider: "PixelAPI" });
            }
          } else if (contentType.includes("image")) {
            const arrayBuffer = await apiRes.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString("base64");
            return res.json({ imageUrl: `data:${contentType};base64,${base64}`, provider: "PixelAPI" });
          }
        }
        
        let errorMessage = `PixelAPI a échoué avec le statut ${apiRes.status}`;
        try {
          const errorData = await apiRes.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (e) {}
        throw new Error(errorMessage);
      } else {
        // Default to pollinations
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&private=true`;
        const headers: Record<string, string> = {};
        if (process.env.POLLINATIONS_API_KEY) {
          headers["Authorization"] = `Bearer ${process.env.POLLINATIONS_API_KEY}`;
        }
        
        const apiRes = await fetchWithTimeout(url, { headers }, 15000);
        if (apiRes.ok) {
          const arrayBuffer = await apiRes.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");
          const contentType = apiRes.headers.get("content-type") || "image/png";
          return res.json({ imageUrl: `data:${contentType};base64,${base64}`, provider: "Pollinations AI" });
        }
        throw new Error("Échec de la génération d'image avec Pollinations.");
      }
    } catch (err: any) {
      console.error("Image generation error:", err);
      return res.status(500).json({ error: err.message || "Erreur lors de la génération de l'image." });
    }
  });

  // File Upload & Analysis API
  app.post("/api/parse-file", upload.single("file"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier n'a été téléchargé." });
    }

    try {
      const content = await parseFile(req.file);
      res.json({ 
        fileName: req.file.originalname,
        content: content,
        mimetype: req.file.mimetype
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/remove-background", async (req, res) => {
    const { imageUrl } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ error: "L'URL de l'image est requise." });
    }

    try {
      const url = "https://api.pixelapi.dev/v1/image/remove-background";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (process.env.PIXELAPI_KEY) {
        headers["Authorization"] = `Bearer ${process.env.PIXELAPI_KEY}`;
      }

      const isBase64 = imageUrl.startsWith("data:");
      // PixelAPI often expects base64 without prefix if sending as string, or a URL
      const payload = isBase64 ? { image: imageUrl.split(",")[1] } : { image_url: imageUrl };

      const apiRes = await fetchWithTimeout(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      }, 60000);

      if (apiRes.ok) {
        const contentType = apiRes.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await apiRes.json();
          const resultUrl = data.url || data.imageUrl || data.image || data.result;
          if (resultUrl) {
            return res.json({ imageUrl: resultUrl });
          }
        } else if (contentType.includes("image")) {
          const arrayBuffer = await apiRes.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");
          return res.json({ imageUrl: `data:${contentType};base64,${base64}` });
        }
      }

      let errorMessage = `PixelAPI a échoué avec le statut ${apiRes.status}`;
      try {
        const errorData = await apiRes.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch (e) {
        // Not JSON or failed to parse
      }
      throw new Error(errorMessage);
    } catch (err: any) {
      console.error("Background removal error:", err);
      return res.status(500).json({ error: err.message || "Erreur lors de la suppression du background." });
    }
  });

  // Principal Chat Completion Route (Supports simulated SSE streaming for fallbacks too!)
  app.post("/api/chat", async (req, res) => {
    const { messages, searchWeb, searchSources } = req.body;
    
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
        res.write(`data: ${JSON.stringify({ type: "status", status: "..." })}\n\n`); // Handled by client translation if empty or status type
        const citations = await performWebSearch(lastUserMessage, searchSources);
        
        if (citations && citations.length > 0) {
          systemInstruction += `\n\nSearch results to help you answer:\n${JSON.stringify(citations)}`;
          res.write(`data: ${JSON.stringify({ type: "citations", citations })}\n\n`);
        }
      } catch (e) {
        console.error("Web search failed:", e);
      }
    }

    // Native Gemini models to try sequentially based on skill guidance
    const nativeGeminiModels = [
      { modelId: "gemini-3.5-flash", displayName: "Cephboy AI" },
      { modelId: "gemini-3.1-flash-lite", displayName: "Cephboy AI Lite" },
      { modelId: "gemini-3.1-pro-preview", displayName: "Cephboy AI Pro" },
    ];
    
    let success = false;
    
    for (const modelConfig of nativeGeminiModels) {
      try {
        res.write(`data: ${JSON.stringify({ type: "provider", provider: modelConfig.displayName })}\n\n`);
        const client = getGeminiClient();
        
        // Convert history to Gemini format
        const contents = messages.map((m: any) => ({
          role: m.role === "assistant" ? "model" as const : "user" as const,
          parts: [{ text: m.content }]
        }));

        const responseStream = await client.models.generateContentStream({
          model: modelConfig.modelId,
          contents: contents,
          config: {
            systemInstruction: systemInstruction,
          }
        });

        for await (const chunk of responseStream) {
          if (res.writableEnded) break;
          const text = chunk.text;
          if (text) {
            res.write(`data: ${JSON.stringify({ type: "content", content: text })}\n\n`);
          }
        }
        
        success = true;
        break;
      } catch (err: any) {
        console.error(`Native Gemini model ${modelConfig.modelId} failed:`, err.message || err);
        // Continue to next model or fallbacks
      }
    }

    // Fallbacks if Native Gemini fails
    if (!success) {
      console.warn("All native Gemini models failed. Attempting external third-party fallbacks...");
      const fallbackProviders = PROVIDERS.filter(p => p.type === "fallback");
      
      // Compile full prompt for non-conversational fallback APIs
      const fallbackPrompt = `${systemInstruction}\n\nHistorique de la conversation:\n` + 
        messages.map((m: any) => `${m.role === "assistant" ? "Assistant" : "Utilisateur"}: ${m.content}`).join("\n") + 
        `\nAssistant:`;
      
      for (const provider of fallbackProviders) {
        try {
          res.write(`data: ${JSON.stringify({ type: "provider", provider: `${provider.displayName} (Fallback)` })}\n\n`);
          const result = await attemptFallbackChat(fallbackPrompt, provider.name);
          
          // Since fallbacks do not stream natively easily, we simulate streaming of the full text block to the client
          const text = result.text;
          const words = text.split(" ");
          
          // Stream in chunks of words with short intervals for beautiful user experience
          const chunkSize = 4;
          for (let i = 0; i < words.length; i += chunkSize) {
            const chunkStr = words.slice(i, i + chunkSize).join(" ") + (i + chunkSize < words.length ? " " : "");
            res.write(`data: ${JSON.stringify({ type: "content", content: chunkStr })}\n\n`);
            await new Promise(resolve => setTimeout(resolve, 60));
          }
          
          success = true;
          break; // Stop fallbacks as we found a working one!
        } catch (fallbackError: any) {
          console.warn(`Provider ${provider.displayName} failed. Attempting next...`);
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

// 3. Start the Server (only if running locally)
async function startServer() {
  // Vite/Static middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Cephboy AI GPT server running on http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer().catch(err => {
    console.error("CRITICAL: Server failed to start:", err);
    process.exit(1);
  });
}
