import { spawn } from "child_process";

export function textToSpeech(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let data = "";

    const xtts = spawn("ollama", ["run", "xtts"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    xtts.stdin.write(text);
    xtts.stdin.end();

    xtts.stdout.on("data", (chunk) => {
      data += chunk.toString();
    });

    xtts.stderr.on("data", (err) => {
      console.error("XTTS Error:", err.toString());
    });

    xtts.on("close", () => {
      try {
        const json = JSON.parse(data);
        const audioData = Buffer.from(json.audio, "base64");
        resolve(audioData);
      } catch (err) {
        reject("❌ Failed to parse XTTS output");
      }
    });
  });
}
