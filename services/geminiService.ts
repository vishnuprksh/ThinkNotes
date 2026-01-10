
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Message } from "../types";

export const getCopilotResponseStream = async (
  messages: Message[],
  editorContent: string,
  dbSchema: string,
  currentVariables: string,
  currentWriterScript: string,
  currentReaderScript: string
) => {
  try {
    const response = await fetch('/api/copilot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        editorContent,
        dbSchema,
        currentVariables,
        currentWriterScript,
        currentReaderScript
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API call failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // Create a generator that yields text chunks primarily to match the expected interface if possible, 
    // or return a stream object that mimics what the UI expects.
    // The previous implementation returned a stream object from GoogleGenAI.
    // We need to return an object with a `stream` property that is an async iterable.

    const streamGenerator = async function* () {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkText = decoder.decode(value, { stream: true });
        // The original GoogleGenAI stream chunk has a specific structure: { text: () => string }
        yield { text: () => chunkText };
      }
    };

    return {
      stream: streamGenerator()
    };

  } catch (error) {
    console.error("thinkNotes API Error:", error);
    throw error;
  }
};
