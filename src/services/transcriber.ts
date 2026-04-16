import { requestUrl } from "obsidian";

const MAX_CHUNK_SIZE = 24_000_000; // 24MB (Whisper limit is 25MB)

/**
 * Transcribes audio from a URL using OpenAI's Whisper API.
 * Downloads the audio, splits if needed, transcribes each chunk.
 */
export async function transcribeAudio(
  audioUrl: string,
  apiKey: string,
  model: string = "whisper-1"
): Promise<string> {
  // Download the audio file
  const audioResponse = await requestUrl({
    url: audioUrl,
    method: "GET",
    contentType: "audio/mpeg",
  });

  const audioData = audioResponse.arrayBuffer;

  if (audioData.byteLength <= MAX_CHUNK_SIZE) {
    return await transcribeChunk(audioData, apiKey, model, "audio.mp3");
  }

  // Split into chunks and transcribe each
  const chunks = splitAudio(audioData);
  const transcripts: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const transcript = await transcribeChunk(
      chunks[i],
      apiKey,
      model,
      `chunk-${i}.mp3`
    );
    transcripts.push(transcript);
  }

  return transcripts.join("\n\n");
}

async function transcribeChunk(
  data: ArrayBuffer,
  apiKey: string,
  model: string,
  filename: string
): Promise<string> {
  // Build multipart form data manually since requestUrl doesn't support FormData
  const boundary = `----DumpTranscribe${Date.now()}`;
  const encoder = new TextEncoder();

  const parts: ArrayBuffer[] = [];

  // File part
  const fileHeader = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`
  );
  parts.push(fileHeader.buffer);
  parts.push(data);
  parts.push(encoder.encode("\r\n").buffer);

  // Model part
  const modelPart = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`
  );
  parts.push(modelPart.buffer);

  // Response format
  const formatPart = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n`
  );
  parts.push(formatPart.buffer);

  // Closing boundary
  parts.push(encoder.encode(`--${boundary}--\r\n`).buffer);

  // Concatenate all parts
  const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    body.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }

  const response = await requestUrl({
    url: "https://api.openai.com/v1/audio/transcriptions",
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: body.buffer,
    throw: false,
  });

  if (response.status !== 200) {
    const error = response.json?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Whisper API error: ${error}`);
  }

  return response.text;
}

/**
 * Simple audio splitting by byte position.
 * Not ideal (may split mid-frame), but works for Whisper which is robust.
 */
function splitAudio(data: ArrayBuffer): ArrayBuffer[] {
  const chunks: ArrayBuffer[] = [];
  let offset = 0;

  while (offset < data.byteLength) {
    const end = Math.min(offset + MAX_CHUNK_SIZE, data.byteLength);
    chunks.push(data.slice(offset, end));
    offset = end;
  }

  return chunks;
}
