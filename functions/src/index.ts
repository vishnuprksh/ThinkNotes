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

  const modelName = 'gemini-3-flash-preview';

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

  const conversation = messages.map((m: any) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));

  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemInstruction,
    });

    const chat = model.startChat({
      history: conversation,
    });

    const result = await chat.sendMessageStream(messages[messages.length - 1].content);

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
