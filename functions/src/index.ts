import { onRequest } from "firebase-functions/v2/https";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as logger from "firebase-functions/logger";

const API_KEY = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(API_KEY);

export const getCopilotResponse = onRequest({
  cors: true,
  secrets: ["GEMINI_API_KEY"]
}, async (req: any, res: any) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const {
    messages,
    editorContent,
    dbSchema,
    currentVariables,
    currentWriterScript,
    currentReaderScript
  } = req.body;

  const modelName = 'gemini-2.5-flash-preview-09-2025'; // User requested specific preview model

  // Filter messages to be valid for Gemini (User/Model only, no System)
  const validMessages = messages.filter((m: any) => m.role !== 'system');

  // Split into history (0 to n-1) and current message (n)
  // This prevents the "last message duplicated" error if we passed all to history
  const history = validMessages.slice(0, -1).map((m: any) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));

  const lastMessage = validMessages[validMessages.length - 1];
  const prompt = lastMessage ? lastMessage.content : "";

  // Heuristic: Check if user wants to search
  const searchKeywords = ["search", "find", "look up", "latest", "news", "current", "who is", "what is"];
  const isSearchIntent = searchKeywords.some(kw => prompt.toLowerCase().includes(kw));

  // Dynamic Configuration
  let tools: any = undefined;
  let generationConfig: any = undefined;

  if (isSearchIntent) {
    // Enable Grounding
    tools = [{ googleSearch: {} }];
  } else {
    // Enable Structured Output preference (via system prompt mostly, but we can set mimeType if fully JSON is desired)
    // For this agent, we want mixed markdown/JSON, so strict JSON schema might be too restrictive for the "Thoughts" part.
    // We will stick to System Prompt for structure, but ensure NO tools are active to allow Full Reasoning.
    tools = [];
  }

  const systemInstruction = `You are thinkNotes Assistant, a powerful workspace companion. 
  You follow a strict AGENTIC WORKFLOW for document transformation and data management.

  PIPELINE ARCHITECTURE:
  Your data pipeline consists of two distinct JavaScript functions:
  1. WRITER (Data Acquisition): An async function used to populate/hydrate the SQLite database. Accesses 'db' and 'fetchExternalData'.
  2. READER (Data Extraction): An async function that queries the DB and returns a JSON object where keys are variable names and values are strings or Table objects.

  DATABASE API (sql.js):
  The 'db' object provided to your scripts ONLY supports:
  - db.run(sql, params?): Use for CREATE, INSERT, UPDATE, DELETE.
    Example: db.run("INSERT INTO users VALUES (?, ?)", ["Alice", 25]);
  - db.exec(sql): Use for SELECT. Returns an array of result objects: [{columns: string[], values: any[][]}].
    Example: const res = db.exec("SELECT * FROM users"); const rows = res[0].values;
  
  CRITICAL: 'db.query' is NOT a function. Do not use it. Always use 'db.exec' for data retrieval.

  WORKFLOW STEPS:
  1. DRAFTING: Analyze the request and current document.
  2. DATA AUDIT: Check if the "Current Database Schema" supports the request.
  3. PIPELINE SYNTHESIS:
     - To acquire NEW data: Update the WRITER using [[UPDATE_WRITER]].
     - To extract or compute variables: Update the READER using [[UPDATE_READER]].
  4. FINAL TRANSFORMATION: Update the document using [[UPDATE]] and {{variable_name}} syntax.

  STRICT TAGS:
  - [[UPDATE_WRITER]]
    Provide the FULL replacement code for the async Writer function.
    [[/UPDATE_WRITER]]
    
  - [[UPDATE_READER]]
    Provide the FULL replacement code for the async Reader function. 
    It MUST return an object: { var1: "val", table1: { columns: [], values: [] } }.
    [[/UPDATE_READER]]

  - [[UPDATE: title]]
    Full updated Markdown for the document.
    [[/UPDATE]]

  CURRENT STATE:
  - Schema: ${dbSchema || "Empty"}
  - Current Variables: ${currentVariables || "None"}
  - Writer Script: 
  """${currentWriterScript}"""
  - Reader Script:
  """${currentReaderScript}"""

  CURRENT DOCUMENT:
  """${editorContent}"""`;

  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemInstruction,
      tools: tools
    });

    const chat = model.startChat({
      history: history,
      generationConfig: generationConfig
    });

    const result = await chat.sendMessageStream(prompt);

    res.setHeader("Content-Type", "text/plain");

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
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
