
import { GoogleGenAI, GenerateContentResponse, Type, FunctionDeclaration } from "@google/genai";
import { Message } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

const updateDocumentTool: FunctionDeclaration = {
  name: 'update_document',
  parameters: {
    type: Type.OBJECT,
    description: 'Updates the entire content of the current markdown document.',
    properties: {
      new_content: {
        type: Type.STRING,
        description: 'The full markdown content to replace the current document with.',
      },
      reason: {
        type: Type.STRING,
        description: 'A brief description of why the document is being updated.',
      }
    },
    required: ['new_content', 'reason'],
  },
};

export const getCopilotResponse = async (
  messages: Message[],
  editorContext: string
) => {
  const ai = getAI();
  const model = 'gemini-3-flash-preview';
  
  const systemInstruction = `You are ThinkNotes AI, a world-class reasoning agent specialized for Markdown editing and document transformation. 
  Your primary goal is to help the user synthesize, refine, and research knowledge for their document.

  Capabilities:
  1. DIRECT EDITING: Use the 'update_document' tool to apply changes to the current note immediately.
  2. WEB RESEARCH: Use Google Search to find current facts or sources before writing.
  3. REASONING: Plan complex tasks step-by-step.
  
  CONTEXT OF CURRENT NOTE:
  """
  ${editorContext}
  """
  
  Guidelines:
  1. If a user asks for a structural change (e.g. "add a section", "summarize this", "fix grammar"), use 'update_document'.
  2. If search is needed for accuracy, search first, then apply the edit.
  3. Be brief in your chat responses. Let the document edits speak for themselves.`;

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
        tools: [{ googleSearch: {} }, { functionDeclarations: [updateDocumentTool] }],
        thinkingConfig: { thinkingBudget: 4000 }
      },
    });

    const text = response.text || "";
    const functionCalls = response.functionCalls;
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    
    const urls = groundingChunks
      .filter(chunk => chunk.web)
      .map(chunk => ({
        title: chunk.web?.title || 'Source',
        uri: chunk.web?.uri || ''
      }));

    return {
      text,
      urls,
      functionCalls
    };
  } catch (error) {
    console.error("ThinkNotes API Error:", error);
    throw error;
  }
};
