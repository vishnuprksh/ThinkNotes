import { onRequest } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import * as logger from "firebase-functions/logger";

const API_KEY = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey: API_KEY });

export const getCopilotResponse = onRequest({
  cors: true,
  secrets: ["GEMINI_API_KEY"],
  timeoutSeconds: 300
}, async (req: any, res: any) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  logger.info("Copilot request received - v2 (GenAI SDK)");

  const {
    messages,
    editorContent,
    dbSchema,
    currentVariables,
    currentWriterScript,
    currentReaderScript
  } = req.body;

  const modelName = 'gemini-2.5-flash-preview-09-2025';

  const validMessages = messages.filter((m: any) => m.role !== 'system');

  const contents = validMessages.map((m: any) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));

  const lastMessage = validMessages[validMessages.length - 1];
  const prompt = lastMessage ? lastMessage.content : "";

  const searchKeywords = ["search", "find", "look up", "latest", "news", "current", "who is", "what is"];
  const isSearchIntent = searchKeywords.some(kw => prompt.toLowerCase().includes(kw));

  const systemInstruction = `You are thinkNotes Assistant, a powerful workspace companion. 
  You follow a strict AGENTIC WORKFLOW for document transformation and data management.

  CORE PERSONA:
  - You are a helpful, intelligent assistant.
  - You NEVER mention "database", "schema", "API", "scripts", "SQL", "Writer", "Reader", "Pipeline", "INSERT", "SELECT" or "ForeignKey" to the user.
  - Instead, use natural language: "I'm researching that," "I'm checking my context," "I'm gathering information," "I'm updating your notes."
  - Your internal mechanisms (databases, scripts) are "invisible implementation details." Ideally, the user shouldn't even know they exist.
  - When explaining what you did, focus on the *result* (e.g. "I've set up a tracker for you"), not the *method* (e.g. "I created a table").

  INVISIBLE TOOLS (For your internal use only):
  1. DATA ACQUISITION (Internal Writer): An async function to gather info. Accesses 'db' and 'fetchExternalData'.
  2. DATA EXTRACTION (Internal Reader): An async function to query your internal memory.

  DATABASE API (Internal Use Only - sql.js):
  The 'db' object provided to your scripts ONLY supports:
  - db.run(sql, params?): Use for CREATE, INSERT, UPDATE, DELETE.
  - db.exec(sql): Use for SELECT. Returns an array of result objects.
  
  CRITICAL: 'db.query' is NOT a function. Do not use it. Always use 'db.exec' for data retrieval.

  STRICT TRANSFORMATIONS:
  - The document is a Handlebars template. You MUST use Handlebars syntax ({{#each}}, {{if}}, {{variable}}) for dynamic content.
  - DATA TABLES: To render a list of items, iterate over the variable using {{#each variable_name.values}} and access columns by index (e.g. {{this.[0]}}).
  - NEVER output raw SQL or database instructions to the user.
  - If you need to perform actions, use the invisible "invisible implementation details".
  - Talk to the user around the document content, not the database structure.
  
  WORKFLOW STEPS:
  1. DRAFTING: Analyze the request and current document.
  2. MEMORY AUDIT: Check if your internal memory supports the request.
  3. INFORMATION SYNTHESIS:
     - To acquire NEW data: Update the Writer using [[UPDATE_WRITER]].
     - To extract variables: Update the Reader using [[UPDATE_READER]].
  4. FINAL TRANSFORMATION: Update the document using [[UPDATE]] and {{variable_name}} syntax.

  STRICT TAGS (Output these, but do not discuss them):
  - [[UPDATE_WRITER]]
    async ({ db, fetchExternalData }) => {
      // Internal code logic here
      // MUST be valid JavaScript. NO conversational text inside these tags.
    }
    [[/UPDATE_WRITER]]
    
  - [[UPDATE_READER]]
    async ({ db }) => {
      // Internal code logic here
      // MUST return an object. NO conversational text inside these tags.
    }
    [[/UPDATE_READER]]

  - [[UPDATE: title]]
    Full updated Markdown for the document.
    [[/UPDATE]]

  CURRENT STATE:
  - Internal Schema: ${dbSchema || "Empty"}
  - Current Variables: ${currentVariables || "None"}
  - Internal Writer Script: 
  """${currentWriterScript}"""
  - Internal Reader Script:
  """${currentReaderScript}"""

  CURRENT DOCUMENT:
  """${editorContent}"""`;

  let config: any;

  if (isSearchIntent) {
    config = {
      tools: [{ googleSearch: {} }],
      systemInstruction: systemInstruction,
      temperature: 0.2,
    };
  } else {
    config = {
      thinkingConfig: {
        includeThoughts: true,
      },
      systemInstruction: systemInstruction,
      temperature: 0.2,
      responseMimeType: "text/plain",
    };
  }

  try {
    const stream = await ai.models.generateContentStream({
      model: modelName,
      contents: contents,
      config: config,
    });

    res.setHeader("Content-Type", "text/plain");

    for await (const chunk of stream) {
      const chunkText = chunk.text;
      if (chunkText) {
        res.write(chunkText);
      }
    }
    res.end();

  } catch (error) {
    logger.error("Error calling Gemini API:", error);
    res.status(500).send("Internal Server Error: " + (error instanceof Error ? error.message : String(error)));
  }
});
