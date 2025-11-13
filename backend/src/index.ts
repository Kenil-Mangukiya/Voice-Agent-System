import express from "express";
import http from "http";
import { Server } from "socket.io";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { askLLM } from "./services/openai";
import { textToSpeech } from "./services/tts";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

const RECORDINGS_DIR = path.join(__dirname, "../recordings");
const WHISPER_DIR = path.join(__dirname, "../whisper");

// Create folders if missing
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

  // 1️⃣ CLIENT STARTS AUDIO STREAM
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
      console.log("🎵 WAV saved:", filePath);

      // Whisper Auto-Run
      runWhisper(socket, filePath);
    });

    sessions[socket.id].ffmpeg = ffmpeg;
  });

  // 2️⃣ RECEIVE RAW AUDIO CHUNKS
  socket.on("audio-chunk", (chunk: ArrayBuffer) => {
    const session = sessions[socket.id];
    if (session.ffmpeg) {
      session.ffmpeg.stdin.write(Buffer.from(chunk));
    }
  });

  // 3️⃣ STOP STREAM
  socket.on("audio-stream-end", () => {
    console.log("🛑 STOP recording:", socket.id);
    sessions[socket.id].ffmpeg?.stdin.end();
  });

  socket.on("disconnect", () => {
    console.log("🔴 Client left:", socket.id);
    sessions[socket.id]?.ffmpeg?.stdin.end();
    delete sessions[socket.id];
  });
});

// -----------------------------------------------------
// 🔥 RUN WHISPER & PROCESS SPEECH → TEXT → LLM → TTS
// -----------------------------------------------------

function runWhisper(socket: any, filePath: string) {
  console.log("🧠 Running Whisper:", filePath);

  const whisperPath = path.join(WHISPER_DIR, "main.exe");
  const modelPath = path.join(WHISPER_DIR, "models/ggml-base.en.bin");

  const whisper = spawn(whisperPath, [
    "-m", modelPath,
    "-f", filePath,
    "-t", "4",
    "-osrt",
  ]);

  let rawOutput = "";

  whisper.stdout.on("data", (data) => {
    rawOutput += data.toString();
  });

  whisper.stderr.on("data", (data) => {
    console.log("Whisper:", data.toString());
  });

  whisper.on("close", async () => {
    console.log("🧠 Whisper Finished!");

    // Extract lines like:
    // [00:00:00.000 --> 00:00:02.000]   Hello world
    const lines = rawOutput.split("\n");
    const transcriptLines = lines.filter((l) => l.includes("]   "));

    const transcript = transcriptLines
      .map((l) => l.split("]   ")[1])
      .join(" ")
      .trim();

    console.log("📄 TRANSCRIPT:", transcript);

    if (!transcript || transcript.length < 1) {
      console.log("⚠ Empty transcript");
      socket.emit("transcript", { text: "" });
      return;
    }

    // Send transcript to frontend
    socket.emit("transcript", { text: transcript });

    // Ask LLM for response
    console.log("🤖 Asking LLM...");
    const reply = await askLLM(transcript);
    console.log("💬 LLM Reply:", reply);

    socket.emit("llm-text", { text: reply });

    // Convert LLM text → Speech via XTTS
    console.log("🎙 Generating TTS...");
    const audioBuffer = await textToSpeech(reply);

    // Send audio to frontend
    socket.emit("tts-audio", audioBuffer);
    console.log("🔊 TTS Sent to client");
  });
}

server.listen(4000, () =>
  console.log("🚀 Backend running at http://localhost:4000")
);
