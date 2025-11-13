import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:4000");

export default function VoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");

  const recordingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const inputRef = useRef<MediaStreamAudioSourceNode | null>(null);

  function convertFloat32ToInt16(float32Array: Float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  }

  const startRecording = async () => {
    setRecording(true);
    recordingRef.current = true;

    socket.emit("start-audio");

    audioContextRef.current = new AudioContext({ sampleRate: 48000 });
    await audioContextRef.current.resume();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const input = audioContextRef.current.createMediaStreamSource(stream);
    inputRef.current = input;

    const processor = audioContextRef.current.createScriptProcessor(2048, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (!recordingRef.current) return;

      const floatData = e.inputBuffer.getChannelData(0);
      const int16Data = convertFloat32ToInt16(floatData);

      socket.emit("audio-chunk", new Uint8Array(int16Data.buffer));
    };

    input.connect(processor);
    processor.connect(audioContextRef.current.destination);
  };

  const stopRecording = () => {
    recordingRef.current = false;
    setRecording(false);
    socket.emit("audio-stream-end");

    processorRef.current?.disconnect();
    inputRef.current?.disconnect();
    audioContextRef.current?.close();
  };

  useEffect(() => {
    socket.on("transcript", (data) => {
      console.log("📄 TEXT FROM WHISPER:", data.text);
      setTranscript(data.text);
    });
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>🎤 Whisper Voice Recorder</h2>

      {!recording ? (
        <button onClick={startRecording}>Start Recording</button>
      ) : (
        <button onClick={stopRecording}>Stop Recording</button>
      )}

      <h3>🧠 Transcript:</h3>
      <p>{transcript}</p>
    </div>
  );
}
