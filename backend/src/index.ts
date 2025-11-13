import express from "express";
import http from "http";
import { Server } from "socket.io";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { askLLM } from "./services/openai"; // LLM function

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// Paths
const RECORDINGS_DIR = path.join(__dirname, "../recordings");
const WHISPER_DIR = path.join(__dirname, "../whisper");

// Ensure folders exist
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR);
if (!fs.existsSync(WHISPER_DIR)) fs.mkdirSync(WHISPER_DIR);

interface ClientSession {
  ffmpeg: any | null;
  filePath: string | null;
}

const sessions: Record<string, ClientSession> = {};

io.on("connection", (socket) => {
  console.log("🟢 Client connected:", socket.id);

  sessions[socket.id] = { ffmpeg: null, filePath: null };

  // START RECORDING
  socket.on("start-audio", () => {
    console.log("🎤 START recording:", socket.id);

    const filePath = path.join(RECORDINGS_DIR, `record_${socket.id}.wav`);
    sessions[socket.id].filePath = filePath;

    const ffmpeg = spawn("ffmpeg", [
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "1",
      "-i", "pipe:0",
      "-acodec", "pcm_s16le",
      "-ar", "16000",
      filePath,
    ]);

    ffmpeg.stderr.on("data", (d) => console.log("FFmpeg:", d.toString()));

    ffmpeg.on("close", () => {
      console.log("🎵 Saved WAV:", filePath);

      socket.emit("wav-ready", { path: filePath });

      // ⬇️ Process with Whisper automatically
      runWhisperAndLLM(socket.id, filePath);
    });

    sessions[socket.id].ffmpeg = ffmpeg;
  });

  // AUDIO CHUNKS
  socket.on("audio-chunk", (chunk: ArrayBuffer) => {
    const session = sessions[socket.id];
    if (session.ffmpeg) {
      session.ffmpeg.stdin.write(Buffer.from(chunk));
    }
  });

  // STOP RECORDING
  socket.on("audio-stream-end", () => {
    console.log("🛑 STOP recording:", socket.id);
    const s = sessions[socket.id];
    if (s?.ffmpeg) s.ffmpeg.stdin.end();
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
    sessions[socket.id]?.ffmpeg?.stdin.end();
    delete sessions[socket.id];
  });
});

// ---------------------------------------------
// 🔥 WHISPER + LLM FUNCTION
// ---------------------------------------------
async function runWhisperAndLLM(socketId: string, filePath: string) {
  console.log("🧠 Running Whisper on:", filePath);

  const whisperPath = path.join(WHISPER_DIR, "main.exe");
  const modelPath = path.join(WHISPER_DIR, "models/ggml-base.en.bin");

  const whisper = spawn(whisperPath, [
    "-m", modelPath,
    "-f", filePath,
    "-t", "4",
    "--no-timestamps" // cleaner output
  ]);

  let output = "";

  whisper.stdout.on("data", (data) => {
    output += data.toString();
  });

  whisper.stderr.on("data", (data) => {
    console.log("Whisper:", data.toString());
  });

  whisper.on("close", async () => {
    console.log("🧠 Whisper finished!");

    // Extract final text
    const transcript = extractTranscript(output);
    console.log("📄 TRANSCRIPT:", transcript);

    io.to(socketId).emit("transcript", { text: transcript });

    // Call LLM
    const llmReply = await askLLM(transcript);
    console.log("🤖 LLM Reply:", llmReply);

    io.to(socketId).emit("llm-reply", { text: llmReply });
  });
}

// ---------------------------------------------
// 🔥 CLEAN TRANSCRIPT EXTRACTOR
// ---------------------------------------------
function extractTranscript(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("whisper_"))
    .filter((l) => !l.includes("error"))
    .filter((l) => !/^\[\d\d:/.test(l)) // remove [00:00:00]
    .join(" ")
    .trim();
}

server.listen(4000, () => {
  console.log("🚀 Backend running at http://localhost:4000");
});
