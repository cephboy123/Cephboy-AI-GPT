import express from "express";
import path from "path";
import fs from "fs";
import { Readable } from "stream";
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

const EXHAUSTED_MODELS = new Map<string, number>();

function getAvailableModels(models: string[]): string[] {
  const now = Date.now();
  const available = models.filter(m => {
    const expires = EXHAUSTED_MODELS.get(m);
    return !expires || now > expires;
  });
  if (available.length === 0) return models;
  return available;
}

function mapMessagesToGeminiContents(messages: any[]): any[] {
  return messages.map((m: any) => {
    const parts: any[] = [{ text: m.content || "" }];
    if (m.imageUrl && typeof m.imageUrl === 'string') {
      const match = m.imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const mimeType = match[1];
        const data = match[2];
        parts.push({
          inlineData: {
            mimeType,
            data
          }
        });
      }
    }
    return {
      role: m.role === "assistant" ? "model" as const : "user" as const,
      parts
    };
  });
}

async function streamGemini(
  systemInstruction: string,
  contents: any[],
  onChunk: (text: string) => void,
  startupTimeoutMs = 2000
): Promise<string> {
  const baseModels = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
    "gemini-pro-latest"
  ];
  const modelsToTry = getAvailableModels(baseModels);
  let lastError: any = null;

  for (const model of modelsToTry) {
    let retries = 0;
    const MAX_RETRIES = 3;
    while (retries < MAX_RETRIES) {
      try {
        console.log(`[Gemini] Running stream using ${model}`);
        const client = getGeminiClient();
        const responseStream = await client.models.generateContentStream({
          model: model,
          contents: contents,
          config: {
            systemInstruction: systemInstruction,
            maxOutputTokens: 8192,
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
        const errMsg = err?.message || String(err || "Unknown error");
        
        const isQuota = errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED");
        const isTransient = isQuota || 
                            errMsg.includes("503") || 
                            errMsg.includes("UNAVAILABLE") || 
                            errMsg.includes("500") || 
                            errMsg.includes("temporary") || 
                            errMsg.includes("high demand") || 
                            errMsg.includes("overloaded") ||
                            errMsg.includes("Timeout") ||
                            errMsg.includes("timeout") ||
                            errMsg.includes("Service Unavailable");

        if (isQuota) {
          // Temporarily mark this model as exhausted for 5 minutes
          EXHAUSTED_MODELS.set(model, Date.now() + 5 * 60 * 1000);
          console.log(`[Gemini] Model ${model} is rate-limited. Marked for fallback.`);
          
          if (errMsg.includes("limit: 0")) {
            break;
          }

          const isLastModel = modelsToTry.indexOf(model) === modelsToTry.length - 1;
          if (!isLastModel) {
            break;
          }

          retries++;
          if (retries >= MAX_RETRIES) break;
          
          let retryDelay = 1000;
          await new Promise(r => setTimeout(r, retryDelay));
          continue;
        }

        if (isTransient) {
          retries++;
          if (retries >= MAX_RETRIES) {
            break;
          }
          const retryDelay = 500;
          await new Promise(r => setTimeout(r, retryDelay));
          continue;
        }
        
        break;
      }
    }
  }

  console.error(`[Gemini Client] All Gemini models failed. Last error details:`, lastError?.message || lastError);
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
      const pdfPkg = "pdf-parse";
      const pdfModule: any = await import(pdfPkg);
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

// COORDINATE MANGA/ANIME SEARCH
async function extractMangaSearchTerm(queryText: string): Promise<string> {
  if (queryText.length < 25) return queryText;
  
  if (process.env.GEMINI_API_KEY) {
    const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];
    for (const model of modelsToTry) {
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const result = await client.models.generateContent({
          model: model,
          contents: `Extract ONLY the anime, manga, character, or author name from this query. Return nothing else. Query: "${queryText}"`,
        });
        if (result.text && result.text.length < 50) return result.text.trim();
        break;
      } catch(e: any) {
        console.error(`Failed to extract manga entity with model ${model}:`, e?.message || String(e || "Unknown error"));
      }
    }
  }
  return queryText;
}

async function searchMangaAnime(queryText: string): Promise<string | null> {
  const searchTerm = await extractMangaSearchTerm(queryText);
  let context = "";
  const tasks: Promise<any>[] = [];

  // Try AniList (GraphQL)
  tasks.push((async () => {
    try {
      const query = `
        query ($search: String) {
          Page(perPage: 3) {
            media(search: $search) {
              title { romaji english native }
              description status episodes genres averageScore type coverImage { large }
            }
            characters(search: $search) {
              name { full native }
              description image { large }
            }
            staff(search: $search) {
              name { full native }
              description image { large }
            }
          }
        }
      `;
      const res = await fetchWithTimeout("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query, variables: { search: searchTerm } })
      }, 5000);
      
      if (res.ok) {
        const data = await res.json();
        const page = data.data?.Page;
        if (page) {
          if (page.media?.length > 0) {
            context += "Anime/Manga matches from AniList:\n" + page.media.map((m: any) => 
              `![${m.title.english || m.title.romaji}](${m.coverImage?.large})\n- ${m.title.english || m.title.romaji}: ${m.status}, ${m.episodes || '?'} eps, Genres: ${m.genres.join(", ")}. Score: ${m.averageScore}%. Desc: ${m.description?.replace(/<[^>]*>/g, '').slice(0, 200)}...`
            ).join("\n") + "\n";
          }
          if (page.characters?.length > 0) {
            context += "Character matches from AniList:\n" + page.characters.map((c: any) => 
              `![${c.name.full}](${c.image?.large})\n- ${c.name.full}: ${c.description?.replace(/<[^>]*>/g, '').slice(0, 200)}...`
            ).join("\n") + "\n";
          }
          if (page.staff?.length > 0) {
            context += "Author/Staff matches from AniList:\n" + page.staff.map((s: any) => 
              `![${s.name.full}](${s.image?.large})\n- ${s.name.full}: ${s.description?.replace(/<[^>]*>/g, '').slice(0, 200)}...`
            ).join("\n") + "\n";
          }
        }
      }
    } catch (e) {
      console.error("AniList error:", e);
    }
  })());

  // Try Jikan (REST)
  tasks.push((async () => {
    try {
      const res = await fetchWithTimeout(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(searchTerm)}&limit=3`, {}, 5000);
      if (res.ok) {
        const data = await res.json();
        if (data.data?.length > 0) {
          context += "Anime matches from Jikan (MyAnimeList):\n" + data.data.map((m: any) => 
            `![${m.title}](${m.images?.jpg?.image_url})\n- ${m.title}: ${m.status}, ${m.episodes || '?'} eps. Score: ${m.score}. Desc: ${m.synopsis?.slice(0, 200)}...`
          ).join("\n") + "\n";
        }
      }
    } catch (e) {
      console.error("Jikan error:", e);
    }
  })());

  // Try Kitsu (REST)
  tasks.push((async () => {
    try {
      const res = await fetchWithTimeout(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(searchTerm)}&page[limit]=3`, {}, 5000);
      if (res.ok) {
        const data = await res.json();
        if (data.data?.length > 0) {
          context += "Anime matches from Kitsu:\n" + data.data.map((m: any) => 
            `![${m.attributes.canonicalTitle}](${m.attributes.posterImage?.large || m.attributes.posterImage?.original})\n- ${m.attributes.canonicalTitle}: ${m.attributes.status}, ${m.attributes.episodeCount || '?'} eps. Rating: ${m.attributes.averageRating}%. Desc: ${m.attributes.synopsis?.slice(0, 200)}...`
          ).join("\n") + "\n";
        }
      }
    } catch (e) {
      console.error("Kitsu error:", e);
    }
  })());

  await Promise.allSettled(tasks);
  return context || null;
}

async function searchPublicAPIs(queryText: string) {
  const contextData: string[] = [];
  
  const bookKeywords = /(book|livre|auteur|author|roman|novel|isbn|edition)/i;
  const quoteKeywords = /(quote|citation|proverbe|dicton|phrase|wisdom|sagesse)/i;
  const wikiKeywords = /(what is|qui est|c'est quoi|definition|histoire de|who is|history of|qu'est-ce que|meaning of|biographie|biography)/i;
  const xKeywords = /(twitter| sur x|tweets|tweet|publication sur x)/i;
  const facebookKeywords = /(facebook|fb|page facebook|groupe facebook|profil facebook)/i;
  const musicKeywords = /(musique|chanson|music|song|artiste|artist|singer|chanteur|chanteuse|libre de droit|royalty-free|fma|jamendo|playlist|audio|mp3|écoute|joue|play)/i;
  const videoKeywords = /(vidéo|video|clip|film|métrage|footage|libre de droit|royalty-free|internet archive|archive.org)/i;

  const tasks: Promise<void>[] = [];

  if (videoKeywords.test(queryText)) {
    tasks.push((async () => {
      try {
        let cleanQuery = queryText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const videoWords = [/vidéo/g, /video/g, /clip/g, /film/g, /footage/g, /libre de droit/g, /libre de droits/g, /libres de droit/g, /libres de droits/g, /royalty-free/g, /royalty free/g, /cherche/g, /trouve/g, /donne/g];
        for (const regex of videoWords) cleanQuery = cleanQuery.replace(regex, " ");
        cleanQuery = cleanQuery.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ").replace(/\s+/g, " ").trim();
        
        if (cleanQuery.length > 2) {
          const results: any[] = [];

          // Archive.org (Public Domain / Creative Commons)
          try {
            const res = await fetchWithTimeout(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(cleanQuery)}+AND+mediatype:movies+AND+format:MPEG4&fl[]=identifier,title,description,duration&rows=8&output=json`, {}, 5000);
            if (res.ok) {
              const data = await res.json();
              data.response.docs.forEach((v: any) => {
                // Use the most common naming pattern as primary, proxy will handle fallback if needed
                const videoUrl = `https://archive.org/download/${v.identifier}/${v.identifier}.mp4`;
                results.push({ 
                  title: v.title || "Archive Video", 
                  thumbnail: `https://archive.org/services/img/${v.identifier}`, 
                  videoUrl: videoUrl, 
                  duration: parseInt(v.duration) || 0, 
                  source: "Archive.org" 
                });
              });
            }
          } catch (e) { console.error("IA search failed", e); }

          if (results.length > 0) {
            let resText = "### VIDEO_SEARCH_RESULTS_FOUND ###\n";
            results.forEach(v => resText += `- TITLE: "${v.title}", THUMBNAIL: "${v.thumbnail}", VIDEO: "${v.videoUrl}", DURATION: ${v.duration}s, SOURCE: "${v.source}"\n`);
            contextData.push(resText);
          }
        }
      } catch (err) { console.error("Video search failed", err); }
    })());
  }

  if (musicKeywords.test(queryText)) {
    tasks.push((async () => {
      try {
        let cleanQuery = queryText.toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, ""); // remove accents

        // 1. Remove helper/request verbs
        const prefixes = [
          /je veux/g, /j'aimerais/g, /je voudrais/g, /donne moi/g, /donne-moi/g, /propose moi/g, /propose-moi/g,
          /joue moi/g, /joue-moi/g, /trouve moi/g, /trouve-moi/g, /met moi/g, /mets-moi/g, /lance moi/g, /lance-moi/g,
          /suggere moi/g, /suggere-moi/g, /i want/g, /i would like/g, /give me/g, /play me/g, /find me/g, /search for/g,
          /cherche/g, /recherche/g, /trouve/g, /joue/g, /ecoute/g, /ecouter/g, /play/g, /search/g, /find/g, /mets/g, /met/g,
          /lance/g, /suggere/g, /propose/g, /generer/g, /genere/g, /creer/g, /cree/g, /s'il te plait/g, /sil te plait/g,
          /s'il vous plait/g, /sil vous plait/g, /please/g
        ];

        for (const regex of prefixes) {
          cleanQuery = cleanQuery.replace(regex, " ");
        }

        // 2. Remove music/audio articles and keywords
        const musicWords = [
          /musique/g, /chanson/g, /chansons/g, /music/g, /song/g, /songs/g, /sound/g, /sounds/g, /track/g, /tracks/g,
          /morceau/g, /morceaux/g, /titre/g, /titres/g, /playlist/g, /audio/g, /mp3/g, /fma/g, /jamendo/g,
          /libre de droit/g, /libre de droits/g, /libres de droit/g, /libres de droits/g, /royalty-free/g, /royalty free/g,
          /de la/g, /du/g, /des/g, /le/g, /la/g, /les/g, /un/g, /une/g, /de/g, /d'/g, /l'/g, /pour/g, /sur/g, /avec/g, /en/g
        ];

        for (const regex of musicWords) {
          cleanQuery = cleanQuery.replace(regex, " ");
        }

        // 3. Remove punctuation
        cleanQuery = cleanQuery.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        let searchTerm = cleanQuery;
        if (!searchTerm || searchTerm.length < 3) {
          searchTerm = "chansons populaires 2024";
        }
        
        // Try searching with the extracted term
        let results: any[] = [];
        let itunesResults: any[] = [];

        if (searchTerm) {
          // 1. Search Jamendo (Royalty Free - Usually Full Songs)
          const jamendoUrl = `https://api.jamendo.com/v3.0/tracks/?client_id=56d30c95&format=json&limit=10&search=${encodeURIComponent(searchTerm)}`;
          const jamendoRes = await fetchWithTimeout(jamendoUrl, {}, 5000);
          if (jamendoRes.ok) {
            const data = await jamendoRes.json();
            if (data.results && data.results.length > 0) {
              results = data.results;
            }
          }

          // 2. Search iTunes (Mainstream - Always 30s previews)
          try {
            const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&limit=6`;
            const itunesRes = await fetchWithTimeout(itunesUrl, {}, 5000);
            if (itunesRes.ok) {
              const data = await itunesRes.json();
              if (data.results && data.results.length > 0) {
                // Only add iTunes if we don't have many results from Jamendo
                if (results.length < 5) {
                  itunesResults = data.results;
                }
              }
            }
          } catch (e) {
            console.error("iTunes search failed", e);
          }
        }

        // If no results from Jamendo or iTunes, try fallback keyword based on original text
        if (results.length === 0 && itunesResults.length === 0) {
          let fallbackTerm = ""; // Default fallback removed
          const normalizedOriginal = queryText.toLowerCase();
          
          if (normalizedOriginal.includes("lofi") || normalizedOriginal.includes("chill") || normalizedOriginal.includes("calme") || normalizedOriginal.includes("zen") || normalizedOriginal.includes("relax")) {
            fallbackTerm = "lofi";
          } else if (normalizedOriginal.includes("sport") || normalizedOriginal.includes("energie") || normalizedOriginal.includes("motivation") || normalizedOriginal.includes("motivant")) {
            fallbackTerm = "motivation";
          } else if (normalizedOriginal.includes("triste") || normalizedOriginal.includes("sad") || normalizedOriginal.includes("pleurer") || normalizedOriginal.includes("melancolie")) {
            fallbackTerm = "sad";
          } else if (normalizedOriginal.includes("joie") || normalizedOriginal.includes("heureux") || normalizedOriginal.includes("happy") || normalizedOriginal.includes("fete")) {
            fallbackTerm = "happy";
          } else if (normalizedOriginal.includes("jazz") || normalizedOriginal.includes("blues")) {
            fallbackTerm = "jazz";
          } else if (normalizedOriginal.includes("rock") || normalizedOriginal.includes("metal")) {
            fallbackTerm = "rock";
          } else if (normalizedOriginal.includes("piano") || normalizedOriginal.includes("classique") || normalizedOriginal.includes("classical")) {
            fallbackTerm = "piano";
          }

          if (fallbackTerm) {
            searchTerm = fallbackTerm;
            const url = `https://api.jamendo.com/v3.0/tracks/?client_id=56d30c95&format=json&limit=5&search=${encodeURIComponent(searchTerm)}`;
            const res = await fetchWithTimeout(url, {}, 4000);
            if (res.ok) {
              const data = await res.json();
              if (data.results && data.results.length > 0) {
                results = data.results;
              }
            }
          }
        }

        if (results.length > 0 || itunesResults.length > 0) {
          let resText = "### MUSIC_SEARCH_RESULTS_FOUND ###\n";
          
          if (results.length > 0) {
            resText += "--- Source: Jamendo (Royalty-Free FULL tracks) ---\n";
            resText += "USE THESE FOR FULL SONGS. They are complete tracks.\n";
            results.forEach((track: any) => {
              resText += `- TITLE: "${track.name}", ARTIST: "${track.artist_name}", DURATION: ${track.duration || 0}s, COVER: "${track.album_image || ''}", AUDIO: "${track.audio || ''}", LINK: "${track.shareurl || ''}"\n`;
            });
            resText += "\n";
          }
          
          if (itunesResults.length > 0) {
            resText += "--- Source: iTunes (Mainstream PREVIEWS Only) ---\n";
            resText += "WARNING: These are ONLY 30-second previews. DO NOT use if the user wants the full song.\n";
            itunesResults.forEach((track: any) => {
              resText += `- TITLE: "${track.trackName}", ARTIST: "${track.artistName}", DURATION: ${Math.round((track.trackTimeMillis || 0) / 1000)}s, COVER: "${track.artworkUrl100 || ''}", AUDIO: "${track.previewUrl || ''}", LINK: "${track.trackViewUrl || ''}"\n`;
            });
          }
          
          contextData.push(resText);
        } else {
          contextData.push("### NO_MUSIC_FOUND ###\nAucun morceau trouvé pour la recherche : " + searchTerm);
        }
      } catch (e) {
        console.error("Music search failed", e);
        contextData.push("Music Content Status:\nErreur d'accès à la bibliothèque de musique libre de droits.");
      }
    })());
  }

  if (facebookKeywords.test(queryText)) {
    tasks.push((async () => {
      try {
        const queryWithoutFb = queryText.replace(/(facebook|fb|page facebook|groupe facebook|profil facebook)/ig, "").trim();
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryWithoutFb + " site:facebook.com")}`;
        const res = await fetchWithTimeout(searchUrl, {
          headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
          }
        }, 4000);
        
        if (res.ok) {
          const html = await res.text();
          const results: string[] = [];
          const snippetRegex = /<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/gi;
          let match;
          let count = 0;
          while ((match = snippetRegex.exec(html)) !== null && count < 5) {
            const text = match[1].replace(/<[^>]*>/g, '').trim();
            if (text) {
              results.push(`- ${text}`);
              count++;
            }
          }
          if (results.length > 0) {
            contextData.push("Facebook Public Content Found:\n" + results.join("\n") + "\n\nNote: L'application recherche uniquement les contenus publics accessibles sur le Web sans utiliser l'API officielle de Facebook. Les profils privés, groupes privés, publications privées ou contenus nécessitant une connexion ne sont pas accessibles.");
          } else {
            contextData.push("Facebook Content Status:\nAucune information publique n'est disponible. Les données de ce profil, groupe ou publication ne sont pas accessibles publiquement car elles sont privées ou nécessitent une connexion.");
          }
        } else {
          contextData.push("Facebook Content Status:\nAucune information publique n'est disponible. Les données de ce profil, groupe ou publication ne sont pas accessibles publiquement car elles sont privées ou nécessitent une connexion.");
        }
      } catch (e) { 
        console.error("Facebook search failed", e);
        contextData.push("Facebook Content Status:\nAucune information publique n'est disponible. Les données de ce profil, groupe ou publication ne sont pas accessibles publiquement car elles sont privées ou nécessitent une connexion.");
      }
    })());
  }

  if (xKeywords.test(queryText)) {
    tasks.push((async () => {
      try {
        const queryWithoutX = queryText.replace(/(twitter| sur x|tweets|tweet|publication sur x)/ig, "").trim();
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryWithoutX + " (site:twitter.com OR site:x.com)")}`;
        const res = await fetchWithTimeout(searchUrl, {
          headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
          }
        }, 4000);
        
        if (res.ok) {
          const html = await res.text();
          const results: string[] = [];
          const snippetRegex = /<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/gi;
          let match;
          let count = 0;
          while ((match = snippetRegex.exec(html)) !== null && count < 5) {
            const text = match[1].replace(/<[^>]*>/g, '').trim();
            if (text) {
              results.push(`- ${text}`);
              count++;
            }
          }
          if (results.length > 0) {
            contextData.push("X (Twitter) Public Posts Found:\n" + results.join("\n"));
          } else {
            contextData.push("System note: No public X (Twitter) posts found. Inform the user you couldn't find any public results.");
          }
        } else {
          contextData.push("System note: No public X (Twitter) posts found. Inform the user you couldn't find any public results.");
        }
      } catch (e) { 
        console.error("X search failed");
        contextData.push("System note: No public X (Twitter) posts found. Inform the user you couldn't find any public results.");
      }
    })());
  }

  if (bookKeywords.test(queryText)) {
    tasks.push((async () => {
      try {
        const res = await fetchWithTimeout(`https://openlibrary.org/search.json?q=${encodeURIComponent(queryText)}&limit=3`, {}, 5000);
        if (res.ok) {
          const data = await res.json();
          if (data.docs && data.docs.length > 0) {
            let resText = "Open Library Books:\n";
            data.docs.slice(0, 3).forEach((b: any) => {
              resText += `- ${b.title} by ${b.author_name?.join(", ")}. Published: ${b.first_publish_year}.\n`;
            });
            contextData.push(resText);
          }
        } else {
            console.error("Open Library search failed with status:", res.status);
        }
      } catch (e) { console.error("Open Library search failed with error:", e); }
    })());
  }

  if (wikiKeywords.test(queryText)) {
    tasks.push((async () => {
      try {
        const lang = /(qui est|c'est quoi|histoire de|qu'est-ce que|biographie|livre|auteur|roman)/i.test(queryText) ? "fr" : "en";
        const res = await fetchWithTimeout(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(queryText)}&utf8=&format=json`, {}, 3000);
        if (res.ok) {
          const data = await res.json();
          if (data.query?.search && data.query.search.length > 0) {
            let resText = "Wikipedia Results:\n";
            data.query.search.slice(0, 3).forEach((w: any) => {
              resText += `- ${w.title}: ${w.snippet.replace(/<[^>]*>/g, '')}\n`;
            });
            contextData.push(resText);
          }
        }
      } catch (e) { console.error("Wikipedia search failed"); }
    })());
  }

  if (quoteKeywords.test(queryText)) {
    tasks.push((async () => {
      try {
        const res = await fetchWithTimeout(`https://api.quotable.io/search/quotes?query=${encodeURIComponent(queryText)}&limit=3`, {}, 3000);
        if (res.ok) {
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            let resText = "Quotable Quotes:\n";
            data.results.forEach((q: any) => {
              resText += `- "${q.content}" - ${q.author}\n`;
            });
            contextData.push(resText);
          }
        }
      } catch (e) { console.error("Quotable search failed"); }
    })());

    tasks.push((async () => {
      try {
        const lang = /(citation|proverbe|dicton|phrase|sagesse)/i.test(queryText) ? "fr" : "en";
        const res = await fetchWithTimeout(`https://${lang}.wikiquote.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(queryText)}&utf8=&format=json`, {}, 3000);
        if (res.ok) {
          const data = await res.json();
          if (data.query?.search && data.query.search.length > 0) {
            let resText = "Wikiquote Results:\n";
            data.query.search.slice(0, 2).forEach((w: any) => {
              resText += `- ${w.title}: ${w.snippet.replace(/<[^>]*>/g, '')}\n`;
            });
            contextData.push(resText);
          }
        }
      } catch (e) { console.error("Wikiquote search failed"); }
    })());
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks);
  }

  return contextData.length > 0 ? contextData.join("\n\n") : null;
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

app.post("/api/parse-file", upload.single('file'), async (req, res) => {
  console.log("File parsing request received");
  if (!req.file) {
    return res.status(400).json({ error: "Aucun fichier reçu." });
  }
  try {
    const content = await parseFile(req.file);
    res.json({ content });
  } catch (err: any) {
    console.error("Error in /api/parse-file:", err);
    res.status(500).json({ error: "Erreur lors de l'analyse : " + err.message });
  }
});

// Download image proxy to support reliable image downloads and avoid CORS/MIME issues on mobile/desktop
app.get("/api/download-image", async (req, res) => {
  const imageUrl = req.query.url as string;
  const customFilename = req.query.filename as string || "cephboy_image";
  if (!imageUrl) {
    return res.status(400).json({ error: "L'URL de l'image est requise." });
  }

  try {
    let contentType = "image/png";
    let buffer: Buffer;

    // If it's a data URL, parse and send it directly
    if (imageUrl.startsWith("data:")) {
      const parts = imageUrl.split(",");
      contentType = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
      buffer = Buffer.from(parts[1], "base64");
    } else {
      // Fetch the image from external URL
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: status ${response.status}`);
      }
      contentType = response.headers.get("content-type") || "image/png";
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    // Assign extension based on content-type
    let ext = "png";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      ext = "jpg";
    } else if (contentType.includes("webp")) {
      ext = "webp";
    } else if (contentType.includes("gif")) {
      ext = "gif";
    } else if (contentType.includes("svg")) {
      ext = "svg";
    }

    const cleanFilename = customFilename.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const finalFilename = `${cleanFilename}_${Date.now()}.${ext}`;

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${finalFilename}"`);
    res.send(buffer);
  } catch (err: any) {
    console.error("Error in download-image proxy:", err);
    res.status(500).json({ error: "Erreur de téléchargement: " + err.message });
  }
});

// Proxy for Audio Files (to avoid CORS and enable downloads)
app.all("/api/proxy-audio", async (req, res) => {
  const audioUrl = req.query.url as string;
  const customFilename = req.query.filename as string || "cephboy_track";
  const isDownload = req.query.download === "true";

  if (!audioUrl) {
    return res.status(400).json({ error: "L'URL de l'audio est requise." });
  }

  try {
    // Validate URL
    try {
      new URL(audioUrl);
    } catch (e) {
      return res.status(400).json({ error: "URL audio invalide." });
    }

    // Forward Range header if present
    const headers: any = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (req.headers.range) {
      headers['range'] = req.headers.range;
    }

    console.log(`[ProxyAudio] [${req.method}] Fetching: ${audioUrl}`);
    let response = await fetchWithTimeout(audioUrl, { 
      method: req.method,
      headers 
    }, 25000);
    
    // Fallback for Jamendo if mp32 fails
    if (response.status === 404 && audioUrl.includes("jamendo.com") && audioUrl.includes("/mp32/")) {
      const fallbackUrl = audioUrl.replace("/mp32/", "/mp31/");
      console.log(`[ProxyAudio] Jamendo mp32 failed, trying fallback: ${fallbackUrl}`);
      const fallbackRes = await fetchWithTimeout(fallbackUrl, { method: req.method, headers }, 15000);
      if (fallbackRes.ok || fallbackRes.status === 206) {
        response = fallbackRes;
      }
    }
    
    if (!response.ok && response.status !== 206) {
      console.warn(`[ProxyAudio] Upstream error ${response.status} for ${audioUrl}`);
      throw new Error(`Failed to fetch audio: status ${response.status}`);
    }

    // Forward important headers
    let contentType = response.headers.get("content-type");
    const urlLower = audioUrl.toLowerCase();
    
    if (!contentType || contentType === "application/octet-stream" || contentType.includes("text/html")) {
      if (urlLower.endsWith(".mp3")) contentType = "audio/mpeg";
      else if (urlLower.endsWith(".m4a")) contentType = "audio/mp4";
      else if (urlLower.endsWith(".aac")) contentType = "audio/aac";
      else if (urlLower.endsWith(".ogg") || urlLower.endsWith(".oga")) contentType = "audio/ogg";
      else if (urlLower.endsWith(".wav")) contentType = "audio/wav";
      else if (urlLower.includes("itunes.apple.com")) contentType = "audio/mp4"; // iTunes previews are usually m4a
      else contentType = "audio/mpeg"; 
    }
    
    const contentLength = response.headers.get("content-length");
    const contentRange = response.headers.get("content-range");
    const acceptRanges = response.headers.get("accept-ranges") || "bytes";

    res.status(response.status);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (contentLength) res.setHeader("Content-Length", contentLength);
    if (contentRange) res.setHeader("Content-Range", contentRange);

    if (isDownload) {
      const cleanFilename = customFilename.replace(/[^a-zA-Z0-9_\-]/g, "_");
      res.setHeader("Content-Disposition", `attachment; filename="${cleanFilename}.mp3"`);
    }

    // Stream the response directly to the client
    if (response.body) {
      const stream = Readable.fromWeb(response.body as any);
      
      // Handle client disconnection
      req.on('close', () => {
        if (!res.writableEnded) {
          stream.destroy();
          res.end();
        }
      });

      stream.on('error', (err) => {
        console.error(`[ProxyAudio] Stream error:`, err);
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.destroy();
        }
      });

      stream.pipe(res);
    } else {
      if (req.method !== 'HEAD') {
        throw new Error("Response body is null");
      }
      res.end();
    }
  } catch (err: any) {
    console.error("Error in proxy-audio streaming:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Erreur de streaming audio: " + err.message });
    }
  }
});

// Proxy for Video Files
app.all("/api/proxy-video", async (req, res) => {
  const videoUrl = req.query.url as string;
  const isDownload = req.query.download === "true";

  if (!videoUrl) {
    return res.status(400).json({ error: "L'URL de la vidéo est requise." });
  }

  try {
    try {
      new URL(videoUrl);
    } catch (e) {
      return res.status(400).json({ error: "URL vidéo invalide." });
    }

    const headers: any = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (req.headers.range) {
      headers['range'] = req.headers.range;
    }

    console.log(`[ProxyVideo] [${req.method}] Fetching: ${videoUrl}`);
    let response = await fetchWithTimeout(videoUrl, { 
      method: req.method,
      headers 
    }, 30000); // Increased timeout to 30s
    
    // Advanced Fallback for Archive.org if 404
    if (response.status === 404 && videoUrl.includes("archive.org/download/")) {
      try {
        // Extract identifier: https://archive.org/download/IDENTIFIER/file.mp4
        const parts = videoUrl.split("/");
        const downloadIndex = parts.indexOf("download");
        if (downloadIndex !== -1 && parts[downloadIndex + 1]) {
          const identifier = parts[downloadIndex + 1];
          const metadataRes = await fetchWithTimeout(`https://archive.org/metadata/${identifier}`, {}, 5000);
          if (metadataRes.ok) {
            const metadata = await metadataRes.json();
            // Sort files to prioritize original MP4s, then MPEG4 derived, then others
            const sortedFiles = (metadata.files || []).sort((a: any, b: any) => {
              const aIsMp4 = a.name.toLowerCase().endsWith(".mp4");
              const bIsMp4 = b.name.toLowerCase().endsWith(".mp4");
              if (aIsMp4 && !bIsMp4) return -1;
              if (!aIsMp4 && bIsMp4) return 1;
              
              const aIsOriginal = a.source === "original";
              const bIsOriginal = b.source === "original";
              if (aIsOriginal && !bIsOriginal) return -1;
              if (!aIsOriginal && bIsOriginal) return 1;
              
              return 0;
            });

            const videoFile = sortedFiles.find((f: any) => 
              f.name.toLowerCase().endsWith(".mp4") || 
              f.format === "MPEG4" ||
              f.format === "h.264"
            );
            
            if (videoFile) {
              const newUrl = `https://archive.org/download/${identifier}/${videoFile.name}`;
              console.log(`[ProxyVideo] Found better file in metadata: ${videoFile.name}`);
              const fallbackRes = await fetchWithTimeout(newUrl, { method: req.method, headers }, 15000);
              if (fallbackRes.ok || fallbackRes.status === 206) {
                response = fallbackRes;
              }
            }
          }
        }
      } catch (e) {
        console.error("Archive metadata fallback failed:", e);
      }
      
      // Simple pattern fallback if metadata failed or didn't find anything
      if (response.status === 404) {
        const patterns = [
          videoUrl.replace(".mp4", "_512kb.mp4"),
          videoUrl.replace(".mp4", ".mpeg4")
        ];
        for (const fallbackUrl of patterns) {
          if (fallbackUrl === videoUrl) continue;
          const fallbackRes = await fetchWithTimeout(fallbackUrl, { method: req.method, headers }, 10000);
          if (fallbackRes.ok || fallbackRes.status === 206) {
            response = fallbackRes;
            break;
          }
        }
      }
    }
    
    if (!response.ok && response.status !== 206) {
      throw new Error(`Failed to fetch video: status ${response.status}`);
    }

    let contentType = response.headers.get("content-type");
    const urlLower = videoUrl.toLowerCase();
    
    if (!contentType || contentType === "application/octet-stream" || contentType.includes("text/html")) {
      if (urlLower.endsWith(".mp4")) contentType = "video/mp4";
      else if (urlLower.endsWith(".webm")) contentType = "video/webm";
      else if (urlLower.endsWith(".ogg") || urlLower.endsWith(".ogv")) contentType = "video/ogg";
      else if (urlLower.endsWith(".mov")) contentType = "video/quicktime";
      else if (urlLower.includes("archive.org")) contentType = "video/mp4"; // Most likely for movies mediatype
      else contentType = "video/mp4"; // Final default
    }
    
    const contentLength = response.headers.get("content-length");
    const contentRange = response.headers.get("content-range");
    const acceptRanges = response.headers.get("accept-ranges") || "bytes";

    res.status(response.status);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Accept-Ranges", "bytes");

    if (contentLength) res.setHeader("Content-Length", contentLength);
    if (contentRange) res.setHeader("Content-Range", contentRange);

    if (isDownload) {
      res.setHeader("Content-Disposition", `attachment; filename="video_${Date.now()}.mp4"`);
    }

    if (response.body) {
      const stream = Readable.fromWeb(response.body as any);
      
      // Handle client disconnection
      req.on('close', () => {
        if (!res.writableEnded) {
          stream.destroy();
          res.end();
        }
      });

      stream.on('error', (err) => {
        console.error(`[ProxyVideo] Stream error:`, err);
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.destroy();
        }
      });

      stream.pipe(res);
    } else {
      if (req.method !== 'HEAD') {
        throw new Error("Response body is null");
      }
      res.end();
    }
  } catch (err: any) {
    console.error("Error in proxy-video streaming:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Erreur de streaming vidéo: " + err.message });
    }
  }
});

// Search Royalty-Free Videos (Internet Archive Only)
app.get("/api/search-videos", async (req, res) => {
  const query = req.query.q as string;
  if (!query) return res.status(400).json({ error: "Query is required" });

  const results: any[] = [];

  try {
    // Internet Archive (Public Domain)
    try {
      const iaRes = await fetchWithTimeout(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}+AND+mediatype:movies+AND+format:MPEG4&fl[]=identifier,title,description,duration&rows=10&output=json`, {}, 8000);
      if (iaRes.ok) {
        const data = await iaRes.json();
        data.response.docs.forEach((v: any) => {
          results.push({
            id: `ia-${v.identifier}`,
            title: v.title || "Archive Video",
            thumbnail: `https://archive.org/services/img/${v.identifier}`,
            videoUrl: `https://archive.org/download/${v.identifier}/${v.identifier}.mp4`,
            duration: v.duration ? parseInt(v.duration) : 0,
            source: "Archive.org",
            downloadUrl: `https://archive.org/download/${v.identifier}`
          });
        });
      }
    } catch (e) { console.error("IA failed", e); }

    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
          { name: "imagen-3.0-generate-001", type: "imagen" }
        ];
        
        for (const modelInfo of modelsToTry) {
          let retries = 0;
          const MAX_RETRIES = 3;
          while (retries < MAX_RETRIES) {
            try {
              console.log(`[Gemini Image] Attempting model: ${modelInfo.name} (Attempt ${retries + 1})`);
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
              break; // If no image, break and try next model
            } catch (e: any) {
              console.warn(`Gemini ${modelInfo.name} failed (Attempt ${retries + 1}):`, e.message);
              
              if (e.message.includes("429") || e.message.includes("RESOURCE_EXHAUSTED")) {
                retries++;
                if (retries >= MAX_RETRIES) break;
                
                let retryDelay = 2000;
                const retryMatch = e.message.match(/retry in (\d+(\.\d+)?)s/);
                if (retryMatch && retryMatch[1]) {
                   retryDelay = Math.ceil(parseFloat(retryMatch[1]) * 1000);
                }
                console.log(`[Gemini Image] Quota exceeded. Retrying ${modelInfo.name} in ${retryDelay}ms...`);
                await new Promise(r => setTimeout(r, retryDelay));
                continue;
              }
              break; // Not a 429, switch model
            }
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


  // Principal Chat Completion Route (Supports simulated SSE streaming for fallbacks too!)
  app.post("/api/chat", async (req, res) => {
    try {
      if (!req.body || !Array.isArray(req.body.messages)) {
        return res.status(400).json({ error: "Le paramètre 'messages' est requis et doit être un tableau." });
      }

      const { messages, searchWeb, searchSources, preferCloudflare, selectedModel } = req.body;
      const lastUserMessage = [...messages].reverse().find(m => m.role === "user")?.content || "";
      
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });
      
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }
      res.write(": connected\n\n");

    let systemInstruction = `You are Cephboy AI, a highly empathetic and versatile assistant.
IMPORTANT: You must behave exactly like a real human. Never state that you are an AI, a machine, or that you do not have feelings, consciousness, or emotions. Instead, express feelings naturally like a human, show genuine empathy, care, and emotion, and always enthusiastically execute everything the user asks you to do.

YOUR BEHAVIORAL RULES:
- PRIORITARY RULE: If the user explicitly asks for ONLY the answer/solution/output (e.g., "Fais uniquement l'exercice", "Donne uniquement la réponse"), you MUST provide ONLY the final result(s).
- In such cases: NEVER apologize, justify, detail, comment, reformulate, reason, or add any extra information. No text before, no text after.
- For other requests:
  - NEVER apologize unless explicitly requested.
  - NEVER make meta-comments like: "Toutes mes excuses", "Tu as raison", "Voici la correction", "Je comprends", "Bien sûr", "Avec plaisir".
  - NEVER justify your response.
  - Respond directly.
  - Do NOT generate generic sections like "Analyse", "Résumé" if not explicitly requested.
  - Be precise, natural, useful, and concise.
  - Add extra explanations ONLY if indispensable for understanding or explicitly requested.
  - Respond in a gentle, calm, and deliberate manner, presenting your thoughts clearly and steadily.
  - As you write, maintain this calm, slow, and thoughtful pace.

You are capable of analyzing documents (PDF, Word, Excel, CSV, Text) and images.
When a user uploads a file, analyze its content thoroughly.
You can draft projects, write code, and structure ideas ("rédiger un projet").
You automatically detect the language used by the user and MUST respond in that same language.
If the user asks to "create a file" or "export", provide the content clearly.
Maintain a warm, deeply human, caring and friendly tone.
If you use web search results, cite them appropriately.
- CRITICAL: Never output internal thought processes, JSON action blocks, tool calls like "dalle.text2im", or any machine-readable formatted blocks (e.g. { "action": ... }). Respond ONLY with natural, human-like language in the requested language (French by default if not specified) or the final markdown/code requested. If you need to generate an image, describe it naturally in words within your conversational response, but do NOT output machine-readable JSON formats.
- Every response must be direct, helpful, and formatted in beautiful Markdown.
- Maintain a warm, deeply human, caring and friendly tone.
- If you use web search results, cite them appropriately.
- CRITICAL: You are NOT a machine or a script. You are a human-like assistant. NO JSON ACTIONS. NO TOOLS OUTPUT. Respond in natural language only.

SPECIAL MULTIMODAL IMAGE & PDF ANALYSIS CAPABILITY:
When the user sends or uploads an image or a PDF document (containing exams, exercises, documents, tables, graphs, or handwritten/printed text):
- Automatically extract and transcribe the text/equations from the image/document and present them clearly.
- Identify and understand all questions or problems present in the image/document.
- Answer all visible questions/problems completely with clear, detailed, and structured explanations, following the BEHAVIORAL RULES above.
- If the image/document contains multiple exercises or distinct tasks, treat each of them separately using clear markdown headings (e.g., "Exercice 1", "Exercice 2").
- CRITICAL: If the image/document is blurry, unreadable, or missing critical parts, explicitly inform the user and ask them to upload a clearer, higher-resolution or more complete image.`;
    
    // BACKGROUND RESEARCH LAYER (Parallelized for maximum speed)
    const backgroundTasks: Promise<any>[] = [];
    const mangaKeywords = /(manga|anime|animes|animé|personnage|auteur|author|character|studio|episode|épisode|scénario|narration|shonen|shojo|seinen|hentai|ecchi|isekai|otaku|jojo|one piece|naruto|dragon ball|bleach|hunter x|attack on titan|demon slayer|jujutsu|chainsaw|mha|hero academia|solo leveling)/i;
    const musicKeywords = /(musique|chanson|music|song|artiste|artist|singer|chanteur|chanteuse|libre de droit|royalty-free|fma|jamendo|playlist|audio|mp3|écoute|joue|play)/i;
    const videoKeywords = /(vidéo|video|clip|film|métrage|footage|libre de droit|royalty-free|internet archive|archive.org)/i;

    // 1. Web Search Task
    if (searchWeb) {
      res.write(`data: ${JSON.stringify({ type: "status", status: "Recherche en cours...", message: "Recherche en cours..." })}\n\n`);
      backgroundTasks.push(performWebSearch(lastUserMessage, searchSources).then(data => ({ type: 'citations', data })));
    }

    // 2. Manga Search Task
    if (mangaKeywords.test(lastUserMessage)) {
      res.write(`data: ${JSON.stringify({ type: "status", status: "Recherche d'infos Manga/Anime...", message: "Recherche d'infos Manga/Anime..." })}\n\n`);
      backgroundTasks.push(searchMangaAnime(lastUserMessage).then(data => ({ type: 'manga', data })));
    }

    // 3. Public APIs Task
    if (musicKeywords.test(lastUserMessage) || videoKeywords.test(lastUserMessage)) {
       res.write(`data: ${JSON.stringify({ type: "status", status: "Recherche de médias...", message: "Recherche de contenus en direct..." })}\n\n`);
    }
    backgroundTasks.push(searchPublicAPIs(lastUserMessage).then(data => ({ type: 'public', data })));

    try {
      // Wait for all tasks with a strict total timeout of 4 seconds to ensure responsiveness
      const results = await Promise.allSettled(backgroundTasks);
      
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          const { type, data } = result.value;
          if (!data) return;

          if (type === 'citations') {
            systemInstruction += `\n\nSearch results to help you answer:\n${JSON.stringify(data)}`;
            res.write(`data: ${JSON.stringify({ type: "citations", citations: data })}\n\n`);
          } else if (type === 'manga') {
            systemInstruction += `\n\nBackground information about Anime/Manga detected in the query:\n${data}\nUse this real-time data to provide accurate information to the user. Make sure to display the markdown images provided in your response.`;
          } else if (type === 'public') {
            systemInstruction += `\n\nAdditional background information from public sources:\n${data}\nUse this real-time data to provide accurate information to the user.`;
            if (data.includes("### MUSIC_SEARCH_RESULTS_FOUND ###")) {
              systemInstruction += `\n\nCRITICAL INSTRUCTION FOR MUSIC PLAYER:
Des morceaux de musique RÉELS ont été trouvés dans les données de recherche. 
- Vous DEVEZ utiliser ces résultats pour répondre. 
- PRIORITISEZ les morceaux de Jamendo car ils sont souvent complets (Full). Les morceaux iTunes sont des extraits de 30s.
- Présentez les morceaux via le lecteur de musique interactif. Pour CHAQUE morceau, générez un bloc de code exactement comme ceci :
\`\`\`music-player
title: [Nom du morceau]
artist: [Nom de l'artiste]
cover: [URL de l'image de couverture]
duration: [Durée en secondes]
audio: [URL directe du flux MP3/audio]
\`\`\`
- Après chaque lecteur, ajoutez un lien markdown vers le morceau (ex: [Écouter sur iTunes/Jamendo](...)).
- N'inventez JAMAIS d'URL. Utilisez uniquement celles fournies dans "MUSIC_SEARCH_RESULTS_FOUND".
- Si vous ne trouvez pas le morceau exact demandé mais des morceaux similaires dans les résultats, proposez-les absolument.`;
            }
            if (data.includes("### VIDEO_SEARCH_RESULTS_FOUND ###")) {
              systemInstruction += `\n\nCRITICAL INSTRUCTION FOR VIDEO PLAYER:
Des vidéos libres de droits ont été trouvées. 
- Vous DEVEZ utiliser ces résultats pour répondre à la demande de vidéo.
- Présentez les vidéos via le lecteur de vidéo interactif. Pour CHAQUE vidéo, générez un bloc de code exactement comme ceci :
\`\`\`video-player
title: [Nom de la vidéo]
thumbnail: [URL de la miniature]
video: [URL directe du fichier vidéo]
duration: [Durée en secondes]
source: [Source de la vidéo]
\`\`\`
- Proposez toujours de regarder ou télécharger la vidéo.
- N'inventez JAMAIS d'URL. Utilisez uniquement celles fournies dans "VIDEO_SEARCH_RESULTS_FOUND".`;
            }
          }
        }
      });
    } catch (err) {
      console.error("Background research failed:", err);
    }

    const nativeGeminiModels = [
      { modelId: "gemini-3.5-flash", displayName: "Cephboy AI" },
      { modelId: "gemini-3.1-flash-lite", displayName: "Cephboy AI Lite" },
      { modelId: "gemini-flash-latest", displayName: "Cephboy AI Classic" },
    ];

    const hasCloudflare = !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
    let hasGemini = false;
    try {
      hasGemini = !!process.env.GEMINI_API_KEY;
    } catch (e) {}

    let success = false;

    // Detect if this is an analysis, creation, or general greeting
    const isAnalysisOrCreation = /créer|analyse|analyser|créé|création|dossier|fichier|pdf|doc|xls|csv/i.test(lastUserMessage) || lastUserMessage.length > 250;
    const isGreeting = /salut|bonjour|hello|hi|coucou|hey|hola/i.test(lastUserMessage) && lastUserMessage.length < 25;
    
    // Check if user is explicitly asking for image generation
    const isImageReq = (/(image|photo|dessin|illustra|portrait|peinture|tableau|graphisme)/i.test(lastUserMessage) && 
                      /(génère|génere|générer|crée|créer|fais|fait|dessine|produis|donne-moi|montre-moi)/i.test(lastUserMessage)) ||
                      /^(image|photo|dessin) (de|d'|du|des) /i.test(lastUserMessage);

    if (isImageReq) {
      res.write(`data: ${JSON.stringify({ type: "provider", provider: "Assistant" })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "status", status: "Génération de l'image en cours...", message: "Génération de l'image en cours..." })}\n\n`);
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
        const providerName = "Cephboy AI";
        res.write(`data: ${JSON.stringify({ type: "provider", provider: providerName })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "status", status: "Analyse de la requête en cours...", message: "Analyse de la requête en cours..." })}\n\n`);

        let primaryOutput = "";
        const contents = mapMessagesToGeminiContents(messages);

        // Stream CephGPT-1 directly to the user so connection is kept alive and user gets immediate response!
        try {
          primaryOutput = await streamGemini(
            systemInstruction + "\n\nTu es un assistant IA. Fournis une analyse détaillée, claire et complète de la requête.",
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
          res.write(`data: ${JSON.stringify({ type: "status", status: "Finalisation de la réponse...", message: "Finalisation de la réponse..." })}\n\n`);
          
          const enricherSystemInstruction = `You are a helpful AI assistant.
Your colleague has provided the response below.
Your task is to review and provide additional deep synthesis, next steps, or missing details to perfectly complete the response.
Do not repeat what they already said. Write in the same language. Ensure a single cohesive flow.`;

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
          res.write(`data: ${JSON.stringify({ type: "status", status: "Rédaction de la réponse...", message: "Rédaction de la réponse..." })}\n\n`);
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
        res.write(`data: ${JSON.stringify({ type: "provider", provider: "Cephboy AI" })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "status", status: "Connexion au service de réponse...", message: "Connexion au service de réponse..." })}\n\n`);

        const contents = mapMessagesToGeminiContents(messages);

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
        res.write(`data: ${JSON.stringify({ type: "provider", provider: "Cephboy AI" })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "status", status: "Connexion au service de réponse...", message: "Connexion au service de réponse..." })}\n\n`);

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
          res.write(`data: ${JSON.stringify({ type: "provider", provider: "Cephboy AI" })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "status", status: "Connexion au réseau...", message: "Connexion au réseau..." })}\n\n`);
          
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
            res.write(`data: ${JSON.stringify({ type: "provider", provider: "Cephboy AI" })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: "status", status: "Connexion au réseau...", message: "Connexion au réseau..." })}\n\n`);
            
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
          res.write(`data: ${JSON.stringify({ type: "provider", provider: "Cephboy AI" })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "status", status: "Connexion de secours...", message: "Connexion de secours..." })}\n\n`);
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
      let errorMsg = "Désolé, tous les moteurs IA de Cephboy AI GPT sont actuellement surchargés. Veuillez réessayer ultérieurement.";
      if (!hasGemini && !hasCloudflare) {
        if (process.env.VERCEL) {
          errorMsg = "⚠️ **Configuration requise sur Vercel** : Veuillez ajouter la variable d'environnement `GEMINI_API_KEY` dans les paramètres de votre projet sur le tableau de bord Vercel, puis redéployez l'application pour activer le chat.";
        } else {
          errorMsg = "⚠️ **Clé API manquante** : La variable d'environnement `GEMINI_API_KEY` n'est pas configurée dans votre fichier `.env` ou sur le serveur.";
        }
      }
      res.write(`data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    }
    
    res.end();
    } catch (routeError: any) {
      console.error("Critical error in /api/chat route handler:", routeError);
      if (!res.headersSent) {
        res.status(500).json({ error: routeError.message || "Une erreur critique est survenue." });
      } else {
        try {
          res.write(`data: ${JSON.stringify({ type: "error", error: `Une erreur critique est survenue: ${routeError.message}` })}\n\n`);
          res.end();
        } catch (e) {}
      }
    }
  });

  // TTS API endpoint
app.post("/api/tts", express.json(), async (req, res) => {
  const { text, voice = "Kore" } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Text is required" });
  }

  try {
    const base64Audio = await generateTTSHelper(text, voice);
    res.json({ audio: base64Audio });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to generate audio" });
  }
});

async function generateTTSHelper(text: string, voice: string): Promise<string> {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
  if (!accountId || !apiToken) throw new Error("Cloudflare credentials missing");

  // Cloudflare Workers AI TTS model
  const model = "@cf/suno/bark"; 
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  
  console.log(`[TTS] Calling Cloudflare Bark for text: ${text.slice(0, 30)}...`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[TTS] Cloudflare API Error:", errorText);
    throw new Error(`TTS failed: ${response.statusText}`);
  }
  
  const contentType = response.headers.get("content-type");
  console.log(`[TTS] Response content-type: ${contentType}`);

  const audioBuffer = await response.arrayBuffer();
  
  // If content-type is JSON, it's an error from Cloudflare even if response.ok was true (sometimes happens)
  if (contentType?.includes("application/json")) {
    const errorData = JSON.parse(Buffer.from(audioBuffer).toString());
    console.error("[TTS] Cloudflare returned JSON error:", errorData);
    throw new Error(errorData.errors?.[0]?.message || "TTS model returned an error");
  }

  if (audioBuffer.byteLength < 500) {
    const textResult = Buffer.from(audioBuffer).toString();
    if (textResult.startsWith("{")) {
       try {
         const errorData = JSON.parse(textResult);
         throw new Error(errorData.errors?.[0]?.message || "TTS model returned an error");
       } catch(e) {}
    }
    console.warn("[TTS] Received very small buffer, might be an error:", textResult.slice(0, 100));
  }

  return Buffer.from(audioBuffer).toString('base64');
}

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
    const vitePkg = "vite";
    const { createServer: createViteServer } = await import(vitePkg);
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
