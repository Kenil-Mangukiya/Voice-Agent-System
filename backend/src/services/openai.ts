import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.OPENAI_API_KEY) {
  throw new Error("❌ OPENAI_API_KEY missing in .env");
}

// Create OpenAI client
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// -----------------------------------------------------
// 🧠 SYSTEM PROMPT — controls how your AI behaves
// -----------------------------------------------------
const SYSTEM_PROMPT = `
You are a human-like conversational AI assistant. 
Your job is to:

1. Respond with natural human emotions.  
2. Keep responses short, friendly, and easy to understand.  
3. Sound like a real human talking on a voice call.  
4. Stay supportive, calm, and helpful.  
5. Avoid robotic tone — speak like a normal person.  
6. If the user asks something unclear, ask a short clarifying question.  
7. Always keep tone: warm, conversational, real, human.  
8. Use simple English words unless user uses complex terms.
9. Your responses must be ideal for TEXT-TO-SPEECH output.
10. Never mention that you are an AI unless directly asked.
`;


// -----------------------------------------------------
// 🧠 GPT-4o-mini Call
// -----------------------------------------------------
export async function askLLM(userPrompt: string): Promise<string> {
  try {
    const response = await openai.responses.create({
      model: "gpt-4o-mini",

      input: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: userPrompt,
        }
      ]
    });

    const output = response.output_text;

    console.log("🧠 LLM Output:", output);

    return output;

  } catch (error: any) {
    console.error("❌ LLM Error:", error);
    return "I'm sorry, something went wrong while generating my response.";
  }
}
