import express from "express";
import http from "http";
import { Server } from "socket.io";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

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

  // Start recording
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

      socket.emit("wav-ready", { path: filePath });

      // 🔥 AUTO RUN WHISPER HERE
      runWhisper(socket.id, filePath);
    });

    sessions[socket.id].ffmpeg = ffmpeg;
  });

  // Receive PCM audio chunks
  socket.on("audio-chunk", (chunk: ArrayBuffer) => {
    const session = sessions[socket.id];
    if (session.ffmpeg) {
      session.ffmpeg.stdin.write(Buffer.from(chunk));
    }
  });

  // Stop recording
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

function runWhisper(socketId: string, filePath: string) {
  console.log("🧠 Running Whisper on:", filePath);

  const whisperPath = path.join(WHISPER_DIR, "main.exe");
  const modelPath = path.join(WHISPER_DIR, "models/ggml-base.en.bin");

  const whisper = spawn(whisperPath, [
    "-m", modelPath,
    "-f", filePath,
    "-t", "4"  // correct thread flag
  ]);
  

  let output = "";

  whisper.stdout.on("data", (data) => {
    output += data.toString();
  });

  whisper.stderr.on("data", (data) => {
    console.log("Whisper:", data.toString());
  });

  whisper.on("close", () => {
    console.log("🧠 Whisper finished!");

    // Extract recognized text
    const lines = output.split("\n");
    const transcriptLines = lines.filter(l => l.includes("]   "));
    const finalText = transcriptLines
      .map(l => l.split("]   ")[1])
      .join(" ");

    console.log("📄 TRANSCRIPT:", finalText);

    // Send text back to frontend
    io.to(socketId).emit("transcript", { text: finalText });
  });
}

server.listen(4000, () => {
  console.log("🚀 Backend running on http://localhost:4000");
});
