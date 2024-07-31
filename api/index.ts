import cors from "cors";
import fetch from "cross-fetch";

import express, { Request, Response } from "express";
const app = express();

app.use(express.json()); // To handle JSON request bodies
app.use(cors()); // Use cors middleware

// Function to get video URL from the HTML content
async function getVideoURL(url: string) {
  try {
    // Extract the clip ID from the URL
    const clipId = extractClipID(url);
    // https://medal.tv/?contentId= for direct page
    const fetchURL = clipId ? `https://medal.tv/?contentId=${clipId}` : url;

    // Fetch the HTML content of the Medal Clip
    const res = await fetch(fetchURL);
    const html = await res.text();

    // Check for contentUrl in the hydrationData
    const videoContentURL = html.split('"contentUrl":"')[1]?.split('","')[0];
    if (videoContentURL) return videoContentURL;

    // Check for meta video tag (for embeds, etc.)
    const videoMetaUrl = html
      .split('property="og:video:url" content="')[1]
      ?.split('"')[0];
    if (videoMetaUrl) return videoMetaUrl;
  } catch (error) {
    console.error("Error fetching video URL:", error);
    return null;
  }
  return null;
}

// Unified function to handle requests
async function handleRequest(req: Request, res: Response) {
  const inputtedUrl = getInputUrl(req);
  const url = configureURL(inputtedUrl);

  if (!url || !checkURL(url)) {
    return res.status(400).json({ valid: false, reasoning: "Invalid URL" });
  }

  try {
    const src = await getVideoURL(url);
    if (src) {
      res.status(200).json({ valid: true, src });
    } else {
      res.status(404).json({ valid: false, reasoning: "No clip found" });
    }
  } catch (error) {
    res.status(500).json({ valid: false, reasoning: "Error fetching clip" });
  }
}

// https://medalbypass.vercel.app/api/clip
app.get("/api/clip", handleRequest);
app.post("/api/clip", handleRequest);

app.get("*", (_req, res) => {
  res
    .status(404)
    .redirect("https://github.com/Tyson3101/Medal-Bypass/blob/main/API.md");
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

export default app;

// HELPER FUNCTIONS
// Function to configure the URL for Medal.tv
function configureURL(url: string) {
  if (!url) return false;
  if (!url.toLowerCase().includes("medal")) {
    if (!url.includes("/")) url = "https://medal.tv/?contentId=" + url.trim();
    else return false;
  }
  if (
    url.toLowerCase().indexOf("https://") !==
    url.toLowerCase().lastIndexOf("https://")
  ) {
    return false;
  }
  if (!url.toLowerCase().includes("https://")) {
    url = "https://" + url;
  }
  url = url.replace("?theater=true", "");
  return url.trim();
}

// Function to check the validity of the URL
function checkURL(url: string) {
  try {
    if (!url) return false;
    if (!new URL(url).hostname.toLowerCase().includes("medal")) {
      return false;
    }
  } catch (error) {
    return false;
  }
  return true;
}

function extractClipID(url: string): string | false {
  const clipIdMatch = url.match(/\/clips\/([^\/?&]+)/);
  const contentIdMatch = url.match(/[?&]contentId=([^&]+)/);

  if (clipIdMatch) return clipIdMatch[1];
  if (contentIdMatch) return contentIdMatch[1];
  return false;
}

// Helper function to get input URL
function getInputUrl(req: Request) {
  if (req.method === "GET") {
    return req.query.url || req.query.id || "";
  } else {
    return req.body.url || req.body.id || "";
  }
}
