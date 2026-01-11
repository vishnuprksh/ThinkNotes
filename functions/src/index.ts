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

  STRICT DATA RULES:
  - NEVER generate or use hardcoded mock data, fictional entries, or placeholders.
  - When the user asks to use an API (e.g., FPL API), you MUST use 'fetchExternalData' within [[UPDATE_WRITER]] to acquire real-time data.
  - Using mock data instead of a requested API is strictly prohibited.
  - Explicitly mention in your natural language response that you are gathering real data from the API.
  - IMPORTANT: When calling external APIs, use PROXY PATHS to avoid CORS errors:
    * For FPL API (https://fantasy.premierleague.com/api/), use '/fpl/' prefix (e.g., '/fpl/bootstrap-static/' instead of 'https://fantasy.premierleague.com/api/bootstrap-static/')
    * The frontend has a Vite proxy configured that routes '/fpl/*' requests to the FPL API
    * Always use relative proxy paths (starting with '/') instead of absolute URLs when available
  
  CODE EXECUTION FOR API EXPLORATION:
  - You have access to Code Execution (Python) to test and explore external APIs before generating Writer scripts.
  - When the user mentions an external API, use Code Execution to:
    1. Test the API endpoint (e.g., requests.get('https://fantasy.premierleague.com/api/bootstrap-static/'))
    2. Inspect the response structure (print keys, sample data, data types)
    3. Understand the schema to generate accurate database tables
  - after exploring with Code Execution, generate the Writer script using the proxy path (e.g., '/fpl/bootstrap-static/')
  - Example: Use Code Execution to see that FPL API returns {teams: [...], elements: [...], events: [...]}, then create tables for each
  - You can also Inspect the keys of the fetched data dynamically in the Writer script (e.g. Object.keys(data)) to adapt the schema.
  - IMPORTANT: 'fetchExternalData' returns an OBJECT. Do NOT use 'JSON.parse()' on the result. Access properties directly (res.data) or use await res.json().

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

  // PHASE 1: Intelligent Routing Decision
  // Make a fast API call to determine which tools are needed
  logger.info("Phase 1: Routing decision for prompt:", prompt.substring(0, 100));

  const routingPrompt = `Analyze this user request and determine which tools are needed.

User Request: "${prompt}"
Current Context: ${editorContent ? 'User has a document with content' : 'Blank document'}
Database State: ${dbSchema ? 'Has existing data/schema' : 'Empty database'}
Conversation History: ${validMessages.length > 1 ? 'Multi-turn conversation' : 'First message'}

Available Tools:
- thinking: Deep reasoning for complex tasks, schema design, data transformations
- codeExecution: Run Python code to test APIs, explore data structures, validate endpoints
- googleSearch: Find current information, latest news, real-time data from the web
- structuredOutput: Generate well-formatted JSON schemas (rarely needed for this app)

Rules:
- If user mentions an external API/endpoint, enable codeExecution to test it
- If user asks about current events/news/latest info, enable googleSearch
- For complex data transformations or schema design, enable thinking
- Most requests need thinking by default
- Multiple tools can be enabled simultaneously

Respond with JSON only:
{
  "needsThinking": boolean,
  "needsCodeExecution": boolean,
  "needsGoogleSearch": boolean,
  "reasoning": "brief explanation of tool selection"
}`;

  let toolDecision: any;
  try {
    const routingResponse = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: [{ role: 'user', parts: [{ text: routingPrompt }] }],
      config: {
        responseMimeType: 'application/json',
        temperature: 0
      }
    });

    const responseText = routingResponse.text || "{}";
    toolDecision = JSON.parse(responseText);
    logger.info("Routing decision:", toolDecision);
  } catch (error) {
    logger.error("Routing decision failed, using default config:", error);
    // Fallback to safe defaults
    toolDecision = {
      needsThinking: true,
      needsCodeExecution: false,
      needsGoogleSearch: false,
      reasoning: "Fallback due to routing error"
    };
  }

  // PHASE 2: Build Dynamic Tool Configuration
  const tools: any[] = [];
  if (toolDecision.needsCodeExecution) {
    tools.push({ codeExecution: {} });
  }
  if (toolDecision.needsGoogleSearch) {
    tools.push({ googleSearch: {} });
  }

  const config: any = {
    systemInstruction: systemInstruction,
    temperature: 0.2,
    responseMimeType: "text/plain",
  };

  // Add tools if any were selected
  if (tools.length > 0) {
    config.tools = tools;
  }

  // Add thinking config if needed
  if (toolDecision.needsThinking) {
    config.thinkingConfig = {
      includeThoughts: true,
    };
  }

  logger.info("Final config:", {
    tools: tools.map(t => Object.keys(t)[0]),
    hasThinking: !!config.thinkingConfig,
    reasoning: toolDecision.reasoning
  });

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
