import express from "express";
import { Express, Request, Response } from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import cors from "cors";

// Load environment variables
dotenv.config();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app: Express = express();

// Most permissive CORS configuration
app.use(
  cors({
    origin: true, // Allow all origins
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "HEAD"],
    allowedHeaders: "*", // Allow all headers
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    credentials: true, // Allow credentials
    maxAge: 86400, // Cache preflight requests for 24 hours
    preflightContinue: true,
  })
);

// Additional CORS headers for extra safety
app.use((req: Request, res: Response, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET, PUT, POST, DELETE, OPTIONS, PATCH, HEAD"
  );
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Credentials", "true");

  // Handle OPTIONS method
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});

app.use(express.json());

// Basic route
app.get("/", (req: Request, res: Response) => {
  res.json({ message: "Hello from Express + TypeScript!" });
});

// OpenAI completion route with image generation
app.post("/api/completion", async (req: Request, res: Response) => {
  try {
    const { messages, generateImage = false } = req.body;

    // Get text completion first
    const completion = await openai.chat.completions.create({
      messages,
      model: "gpt-3.5-turbo",
    });

    const textResponse = completion.choices[0].message.content;

    // If image generation is requested
    if (generateImage) {
      try {
        const imageResponse = await openai.images.generate({
          model: "dall-e-3",
          prompt: textResponse || "",
          n: 1,
          size: "1024x1024",
        });

        res.json({
          message: textResponse,
          image: imageResponse.data[0].url,
          usage: completion.usage,
        });
      } catch (imageError) {
        console.error("Image generation error:", imageError);
        // If image generation fails, still return the text response
        res.json({
          message: textResponse,
          error: "Image generation failed",
          usage: completion.usage,
        });
      }
    } else {
      // Return just the text response if no image is requested
      res.json({
        message: textResponse,
        usage: completion.usage,
      });
    }
  } catch (error) {
    console.error("OpenAI API Error:", error);
    res.status(500).json({
      error: "Error processing your request",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Azure TTS route
app.post("/api/tts", async (req: Request, res: Response) => {
  try {
    const { text, voice = "en-US-JennyMultilingualNeural" } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(
      process.env.AZURE_SPEECH_KEY!,
      process.env.AZURE_SPEECH_REGION!
    );

    speechConfig.speechSynthesisVoiceName = voice;

    // Set headers for streaming audio
    res.set({
      "Content-Type": "audio/wav",
      "Transfer-Encoding": "chunked",
    });

    // Create synthesizer that writes directly to the response
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

    return new Promise<void>((resolve, reject) => {
      synthesizer.speakTextAsync(
        text,
        (result) => {
          if (result && result.audioData) {
            res.write(Buffer.from(result.audioData));
            res.end();
            synthesizer.close();
            resolve();
          } else {
            reject(new Error("No audio data generated"));
          }
        },
        (error) => {
          console.error("Speech synthesis error:", error);
          reject(error);
        }
      );
    });
  } catch (error) {
    console.error("TTS Error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Error processing your request",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
