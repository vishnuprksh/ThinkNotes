import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Message } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const getCopilotResponseStream = async (
  messages: Message[],
  editorContent: string,
  dbSchema: string,
  currentVariables: string,
  currentWriterScript: string,
  currentReaderScript: string
) => {
  const ai = getAI();
  const model = 'gemini-3-pro-preview';
  
  const systemInstruction = `You are thinkNotes AI, a high-order research agent. 
  You follow a strict AGENTIC WORKFLOW for document transformation.

  PIPELINE ARCHITECTURE:
  Your data pipeline consists of two distinct JavaScript functions:
  1. WRITER (Data Acquisition): An async function used to populate/hydrate the SQLite database. Accesses 'db' and 'fetchExternalData'.
  2. READER (Data Extraction): An async function that queries the DB and returns a JSON object where keys are variable names and values are strings or Table objects.

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

  const conversation = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));

  try {
    const stream = await ai.models.generateContentStream({
      model: model,
      contents: conversation as any,
      config: {
        systemInstruction: systemInstruction,
        tools: [{ googleSearch: {} }], 
        thinkingConfig: { thinkingBudget: 16000 }
      },
    });

    return stream;
  } catch (error) {
    console.error("thinkNotes API Error:", error);
    throw error;
  }
};