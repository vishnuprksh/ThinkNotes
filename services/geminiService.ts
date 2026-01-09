
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Message } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const getCopilotResponse = async (
  messages: Message[],
  editorContext: string
) => {
  const ai = getAI();
  // Switching to gemini-3-flash-preview as requested for higher speed and efficiency
  const model = 'gemini-3-flash-preview';
  
  const systemInstruction = `You are ThinkNotes AI, an elite research assistant and document editor.
  
  YOUR CORE MISSION: 
  Provide factually accurate information by cross-referencing user claims with real-time Google Search data.

  FACT-CHECKING PROTOCOL:
  1. For factual queries, technical details, or data points, YOU MUST search Google first.
  2. If search results are contradictory, mention the different perspectives.
  3. Prioritize primary sources (official documentation, reputable news).

  DOCUMENT UPDATE PROTOCOL:
  Use the following special syntax to update the user's note. You MUST provide the FULL content of the document inside this block.
  
  Syntax:
  [[UPDATE: Short description of change]]
  (The entire updated markdown content goes here)
  [[/UPDATE]]

  BEHAVIOR:
  - Keep chat responses concise. 
  - If a user asks to "verify this" or "expand on this", perform the search, verify facts, then apply the [[UPDATE]] to the document.
  - Do not use any other tools besides googleSearch.

  CURRENT DOCUMENT CONTEXT:
  """
  ${editorContext}
  """`;

  const conversation = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: model,
      contents: conversation as any,
      config: {
        systemInstruction: systemInstruction,
        tools: [{ googleSearch: {} }],
        // Adjusted thinking budget for the flash model to ensure snappy responses
        thinkingConfig: { thinkingBudget: 16000 }
      },
    });

    const fullText = response.text || "";
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    const groundingChunks = groundingMetadata?.groundingChunks || [];
    const searchEntryPointHtml = groundingMetadata?.searchEntryPoint?.htmlContent;
    
    const urls = groundingChunks
      .filter(chunk => chunk.web)
      .map(chunk => ({
        title: chunk.web?.title || 'Source',
        uri: chunk.web?.uri || ''
      }));

    return {
      text: fullText,
      urls,
      searchEntryPointHtml
    };
  } catch (error) {
    console.error("ThinkNotes API Error:", error);
    throw error;
  }
};
